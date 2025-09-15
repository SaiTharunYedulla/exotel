import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`✅ WebSocket server running on ws://localhost:${PORT}`);

// Generate a simple beep-like PCM buffer for demo
function generateBeepPCM(durationMs = 500, frequency = 440) {
  const sampleRate = 8000; // 8kHz for Exotel
  const samples = Math.floor((durationMs / 1000) * sampleRate);
  const buffer = Buffer.alloc(samples * 2); // 16-bit PCM

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const amplitude = Math.floor(Math.sin(2 * Math.PI * frequency * t) * 32767);
    buffer.writeInt16LE(amplitude, i * 2);
  }

  return buffer;
}

// Pre-generate a fixed PCM for the fixed phrase
const fixedResponsePCM = generateBeepPCM(1000); // 1-second beep
const fixedResponseBase64 = fixedResponsePCM.toString("base64");

wss.on("connection", (socket) => {
  console.log("📞 New Exotel call connected!");

  let callId = "unknown";

  socket.on("message", async (rawMsg) => {
    let data;
    try {
      data = JSON.parse(rawMsg.toString());
    } catch (e) {
      console.error("❌ Non-JSON message:", rawMsg.toString());
      return;
    }

    if (data.event === "connected") {
      console.log("✅ Call connected:", data);
    }

    if (data.event === "start") {
      callId = data.start?.callSid || "unknown";
      console.log("▶️ Call started:", callId);
    }

    if (data.event === "media") {
      console.log("🎧 Received caller audio chunk (ignored for demo)");

      // Send back fixed response
      socket.send(
        JSON.stringify({
          event: "media",
          streamSid: data.streamSid,
          media: { payload: fixedResponseBase64 },
        })
      );

      console.log(
        `🤖 Sent fixed response to ${callId}: "I am fine, how are you?"`
      );
    }

    if (data.event === "stop") {
      console.log("⏹️ Call stopped:", callId);
    }
  });

  socket.on("close", () => {
    console.log(`☎️ Call ended: ${callId}`);
  });
});
