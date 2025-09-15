import { WebSocketServer } from "ws";
import { Readable } from "stream";
import wav from "wav";
import OpenAI from "openai";
import { File } from "node:buffer"; // 👈 add this

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 👈 important import

// inside your 3s buffer handler:
try {
  // Convert PCM → WAV
  const wavBuffer = await pcmToWavBuffer(pcmBuffer);

  // ✅ Create File object in memory
  const wavFile = new File([wavBuffer], "audio.wav", { type: "audio/wav" });

  // 1. Transcribe with Whisper
  const sttResp = await openai.audio.transcriptions.create({
    file: wavFile,
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

      // ✅ Wrap into a File object
      const wavFile = new File([wavBuffer], "audio.wav", { type: "audio/wav" });

      // 1. Transcribe with Whisper
      const sttResp = await openai.audio.transcriptions.create({
        file: wavFile,
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
