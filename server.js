import { WebSocketServer } from "ws";
import fs from "fs";
import { Readable } from "stream";
import wav from "wav";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`✅ WebSocket server running on ws://localhost:${PORT}`);

// PCM → WAV helper
function pcmToWavBuffer(pcmBuffer, sampleRate = 8000) {
  const writer = new wav.Writer({
    sampleRate,
    channels: 1,
    bitDepth: 16,
  });

  const stream = new Readable();
  stream.push(pcmBuffer);
  stream.push(null);

  const chunks = [];
  writer.on("data", (chunk) => chunks.push(chunk));
  stream.pipe(writer);

  return new Promise((resolve) => {
    writer.on("finish", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

wss.on("connection", (socket) => {
  console.log("📞 New Exotel call connected!");

  let callId = "unknown";
  let bufferChunks = [];
  let lastSendTime = Date.now();

  socket.on("message", async (rawMsg) => {
    let data;
    try {
      data = JSON.parse(rawMsg.toString());
    } catch {
      return; // ignore bad messages
    }

    if (data.event === "start") {
      callId = data.start?.callSid || "unknown";
      console.log("▶️ Call started:", callId);
    }

    if (data.event === "media") {
      // base64 PCM → Buffer
      const chunk = Buffer.from(data.media.payload, "base64");
      bufferChunks.push(chunk);

      const elapsed = Date.now() - lastSendTime;
      if (elapsed > 3000) {
        // 3s worth of audio
        const pcmBuffer = Buffer.concat(bufferChunks);
        bufferChunks = [];
        lastSendTime = Date.now();

        try {
          // Convert PCM → WAV
          const wavBuffer = await pcmToWavBuffer(pcmBuffer);

          // 1. Transcribe with Whisper
          const sttResp = await openai.audio.transcriptions.create({
            file: new Readable({
              read() {
                this.push(wavBuffer);
                this.push(null);
              },
            }),
            model: "gpt-4o-transcribe",
          });

          const callerText = sttResp.text.trim();
          console.log(`👤 Caller (${callId}):`, callerText);

          if (callerText) {
            // 2. ChatGPT response
            const gptResp = await openai.chat.completions.create({
              model: "gpt-3.5-turbo",
              messages: [{ role: "user", content: callerText }],
            });

            const aiText = gptResp.choices[0].message.content;
            console.log(`🤖 AI Response: ${aiText}`);

            // 3. Convert response → TTS
            const ttsResp = await openai.audio.speech.create({
              model: "gpt-4o-mini-tts",
              voice: "alloy",
              input: aiText,
            });

            const aiAudio = Buffer.from(await ttsResp.arrayBuffer());
            const aiBase64 = aiAudio.toString("base64");

            // 4. Send back audio to Exotel
            socket.send(
              JSON.stringify({
                event: "media",
                streamSid: data.streamSid,
                media: { payload: aiBase64 },
              })
            );
          }
        } catch (err) {
          console.error("❌ Error processing audio:", err);
        }
      }
    }

    if (data.event === "stop") {
      console.log("⏹️ Call stopped:", callId);
    }
  });

  socket.on("close", () => {
    console.log(`☎️ Call ended: ${callId}`);
  });
});
