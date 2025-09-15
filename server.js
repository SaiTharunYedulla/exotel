// server.js
import { WebSocketServer } from "ws";
import wav from "wav";
import { File } from "node:buffer";
import OpenAI from "openai";
import { Buffer } from "node:buffer";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// PCM → WAV converter
async function pcmToWavBuffer(pcmBuffer) {
  return new Promise((resolve, reject) => {
    const writer = new wav.Writer({
      sampleRate: 8000,
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

// WAV → μ-law (8kHz) converter in pure Node.js
function wavToMulawBuffer(wavBuffer) {
  const reader = new wav.Reader();
  const chunks = [];

  return new Promise((resolve, reject) => {
    reader.on("format", (format) => {
      reader.on("data", (chunk) => {
        for (let i = 0; i < chunk.length; i += 2) {
          const sample = chunk.readInt16LE(i);
          // μ-law companding
          const mulawByte = linearToMuLaw(sample);
          chunks.push(mulawByte);
        }
      });

      reader.on("end", () => resolve(Buffer.from(chunks)));
    });

    reader.on("error", reject);
    reader.end(wavBuffer);
  });
}

// Linear PCM → μ-law formula
function linearToMuLaw(sample) {
  const MU = 255;
  const MAX = 32768;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > MAX) sample = MAX;
  const magnitude = Math.log1p((MU * sample) / MAX) / Math.log1p(MU);
  return ~(sign | Math.floor(magnitude * 127)) & 0xff;
}

// WebSocket server
const wss = new WebSocketServer({ port: 8080 });
console.log("🚀 WebSocket server running on ws://localhost:8080");

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
      const chunk = Buffer.from(data.media.payload, "base64");
      bufferChunks.push(chunk);

      const elapsed = Date.now() - lastSendTime;
      if (elapsed > 3000) {
        const pcmBuffer = Buffer.concat(bufferChunks);
        bufferChunks = [];
        lastSendTime = Date.now();

        try {
          const wavBuffer = await pcmToWavBuffer(pcmBuffer);
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
            // 2️⃣ ChatGPT response (English only)
            const gptResp = await openai.chat.completions.create({
              model: "gpt-3.5-turbo",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a helpful assistant. Always respond in English only.",
                },
                { role: "user", content: callerText },
              ],
            });

            const aiText = gptResp.choices[0].message.content;
            console.log("🤖 AI Response:", aiText);

            // 3️⃣ Generate TTS
            const ttsResp = await openai.audio.speech.create({
              model: "gpt-4o-mini-tts",
              voice: "alloy",
              input: aiText,
              format: "wav",
            });

            const ttsWavBuffer = Buffer.from(await ttsResp.arrayBuffer());

            // 4️⃣ Convert WAV → μ-law
            const mulawBuffer = await wavToMulawBuffer(ttsWavBuffer);

            // 5️⃣ Send back to Exotel
            socket.send(
              JSON.stringify({
                event: "media",
                streamSid: data.streamSid,
                media: { payload: mulawBuffer.toString("base64") },
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
