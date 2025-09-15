// server.js
import { WebSocketServer } from "ws";
import wav from "wav";
import { File } from "node:buffer";
import OpenAI from "openai";
import { Buffer } from "node:buffer";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Convert PCM Buffer → WAV Buffer
async function pcmToWavBuffer(pcmBuffer) {
  return new Promise((resolve, reject) => {
    const writer = new wav.Writer({
      sampleRate: 8000, // match your PCM rate
      channels: 1,
      bitDepth: 16,
    });

    const chunks = [];
    writer.on("data", (chunk) => chunks.push(chunk));
    writer.on("finish", () => resolve(Buffer.concat(chunks)));
    writer.on("error", reject);

    writer.write(pcmBuffer);
    writer.end();
  });
}

// Create WebSocket server
const wss = new WebSocketServer({ port: 8080 });
console.log("WebSocket server running on ws://localhost:8080");

wss.on("connection", (socket) => {
  console.log("✅ Client connected");
  let bufferChunks = [];
  let lastSendTime = Date.now();

  socket.on("message", async (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData);
    } catch (err) {
      console.error("Invalid JSON:", err);
      return;
    }

    if (data.event === "media") {
      // base64 PCM → Buffer
      const chunk = Buffer.from(data.media.payload, "base64");
      bufferChunks.push(chunk);

      const elapsed = Date.now() - lastSendTime;
      if (elapsed > 3000) {
        // 3s of audio
        const pcmBuffer = Buffer.concat(bufferChunks);
        bufferChunks = [];
        lastSendTime = Date.now();

        try {
          // Convert PCM → WAV
          const wavBuffer = await pcmToWavBuffer(pcmBuffer);

          // Wrap into a File object
          const wavFile = new File([wavBuffer], "audio.wav", {
            type: "audio/wav",
          });

          // 1️⃣ Transcribe with Whisper
          const sttResp = await openai.audio.transcriptions.create({
            file: wavFile,
            model: "gpt-4o-transcribe",
          });

          const callerText = sttResp.text.trim();
          console.log("👤 Caller:", callerText);

          if (callerText) {
            // 2️⃣ ChatGPT response
            const gptResp = await openai.chat.completions.create({
              model: "gpt-3.5-turbo",
              messages: [{ role: "user", content: callerText }],
            });

            const aiText = gptResp.choices[0].message.content;
            console.log("🤖 AI Response:", aiText);

            // 3️⃣ Convert response → TTS
            const ttsResp = await openai.audio.speech.create({
              model: "gpt-4o-mini-tts",
              voice: "alloy",
              input: aiText,
            });

            const aiAudio = Buffer.from(await ttsResp.arrayBuffer());
            const aiBase64 = aiAudio.toString("base64");

            // 4️⃣ Send audio back to client
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
  });

  socket.on("close", () => {
    console.log("❌ Client disconnected");
  });
});
