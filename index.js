// ========================
// Moggumung WA Server v5
// ========================
import express from "express";
import http from "http";
import cors from "cors";
import fs from "fs";
import { execSync } from "child_process";
import { Server } from "socket.io";
import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode";

// ==== App setup ====
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==== Fix: CORS untuk frontend dashboard ====
app.use(
  cors({
    origin: ["https://chat.moggumung.id", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// ==== Manual header tambahan (backup) ====
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "https://chat.moggumung.id");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

// ==== Socket.IO dengan CORS ====
const io = new Server(server, {
  cors: {
    origin: ["https://chat.moggumung.id", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ==== Chromium Path untuk Render ====
async function detectChromiumPath() {
  const chromePath =
    "/opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome";
  try {
    if (fs.existsSync(chromePath)) {
      console.log("✅ Chromium ditemukan:", chromePath);
      return chromePath;
    } else {
      console.log("⚙️ Menginstall Chromium via Puppeteer...");
      execSync("npx puppeteer browsers install chrome", { stdio: "inherit" });
      if (fs.existsSync(chromePath)) {
        console.log("✅ Chromium terinstall:", chromePath);
        return chromePath;
      } else {
        throw new Error("Chromium tidak ditemukan setelah instalasi");
      }
    }
  } catch (err) {
    console.error("❌ detectChromiumPath gagal:", err.message);
    throw err;
  }
}

// ==== WhatsApp Clients ====
const clients = {};

io.on("connection", (socket) => {
  console.log("🟢 Socket client connected:", socket.id);

  socket.on("create-session", async (sessionId) => {
    console.log(`⚙️ Membuat session baru: ${sessionId}`);

    if (clients[sessionId]) {
      socket.emit("status", "Session sudah aktif");
      return;
    }

    try {
      const chromePath = await detectChromiumPath();

      const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: {
          headless: true,
          executablePath: chromePath,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
          ],
        },
      });

      clients[sessionId] = client;

      client.on("qr", async (qr) => {
        const qrData = await qrcode.toDataURL(qr);
        console.log(`📱 QR Code dikirim untuk ${sessionId}`);
        socket.emit("qr", { id: sessionId, src: qrData });
      });

      client.on("ready", () => {
        console.log(`✅ WhatsApp ${sessionId} siap digunakan`);
        socket.emit("ready", sessionId);
      });

      client.on("disconnected", () => {
        console.log(`⚠️ WhatsApp ${sessionId} terputus`);
        socket.emit("disconnected", sessionId);
        delete clients[sessionId];
      });

      await client.initialize();
      console.log(`🚀 Client ${sessionId} initialized`);
    } catch (e) {
      console.error("❌ Error create-session:", e.message);
      socket.emit("error", `Gagal membuat session: ${e.message}`);
    }
  });
});

// ==== Root route ====
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Moggumung WA Server v5 aktif" });
});

// ==== Start Server setelah Chromium preload ====
(async () => {
  try {
    await detectChromiumPath();
    console.log("🧭 Chromium preload OK");
  } catch (e) {
    console.error("⚠️ Gagal preload Chromium:", e.message);
  }

  const PORT = process.env.PORT || 10000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
  });
})();
