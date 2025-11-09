// ========================
// Moggumung WA Server v5
// ========================
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const axios = require("axios");
const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");


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
function detectChromiumPath() {
  const knownPaths = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser-stable",
    "/usr/bin/google-chrome-stable",
  ];

  for (const p of knownPaths) {
    if (fs.existsSync(p)) {
      console.log("✅ Chromium system ditemukan:", p);
      return p;
    }
  }

  console.warn("⚠️ Chromium system tidak ditemukan, fallback ke Puppeteer install...");
  try {
    execSync("npx puppeteer browsers install chrome", { stdio: "inherit" });
    const path = "/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome";
    if (fs.existsSync(path)) {
      console.log("✅ Chromium fallback berhasil:", path);
      return path;
    } else {
      throw new Error("Chromium tidak ditemukan setelah install");
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
  authStrategy: new LocalAuth({ clientId: id }),
  puppeteer: {
    headless: true,
    executablePath: detectChromiumPath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-software-rasterizer",
      "--single-process",
      "--no-zygote",
      "--window-size=1920,1080",
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
