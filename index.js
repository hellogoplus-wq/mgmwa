// ========================
// 🚀 Moggumung WA Server v6 (Hybrid Render-Stable)
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

// ==== App setup ====
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==== CORS untuk dashboard ====
app.use(
  cors({
    origin: ["https://chat.moggumung.id", "https://mgmwa.onrender.com", "http://localhost:3000"],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ==== Socket.IO ====
const io = new Server(server, {
  cors: {
    origin: ["https://chat.moggumung.id", "https://mgmwa.onrender.com", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ==== Chromium Path Detection ====
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

  console.warn("⚠️ Chromium system tidak ditemukan, mencoba install Puppeteer...");
  try {
    execSync("npx puppeteer browsers install chrome", { stdio: "inherit" });
    const path =
      "/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome";
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

// ==== WA Clients Map ====
const clients = {};

// ==== SOCKET.IO HANDLER ====
io.on("connection", (socket) => {
  console.log("🟢 Socket client connected:", socket.id);

  // === Event: Buat session baru (dashboard modern) ===
  socket.on("create-session", async (sessionId) => {
    console.log(`⚙️ Membuat session baru: ${sessionId}`);
    createClient(sessionId, socket);
  });
});

// ==== FUNCTION: CREATE CLIENT ====
async function createClient(sessionId, socket = null) {
  if (clients[sessionId]) {
    console.log(`ℹ️ Client ${sessionId} sudah aktif`);
    if (socket) socket.emit("status", { id: sessionId, status: "already_connected" });
    return;
  }

  try {
    const chromePath = await detectChromiumPath();

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionId }),
      puppeteer: {
  headless: true,
  executablePath: chromiumPath,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-software-rasterizer",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-infobars",
    "--mute-audio",
    "--no-zygote",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=site-per-process,TranslateUI,BlinkGenPropertyTrees",
    "--ignore-certificate-errors",
    "--window-size=1024,768",
  ],
},
    });

    clients[sessionId] = { client, status: "connecting", last_seen: new Date() };

    // === QR Code Event ===
    client.on("qr", async (qr) => {
      const qrData = await qrcode.toDataURL(qr);
      console.log(`📲 QR Code dikirim untuk ${sessionId}`);
      io.emit("qr", { id: sessionId, src: qrData }); // kirim ke semua dashboard
      if (socket) socket.emit("qr", { id: sessionId, src: qrData });
    });

    // === Ready Event ===
    client.on("ready", () => {
      console.log(`✅ WhatsApp ${sessionId} siap digunakan`);
      clients[sessionId].status = "connected";
      clients[sessionId].last_seen = new Date();
      io.emit("status", { id: sessionId, status: "connected" });
    });

    // === Disconnect Event ===
    client.on("disconnected", () => {
      console.log(`⚠️ WhatsApp ${sessionId} terputus`);
      clients[sessionId].status = "disconnected";
      clients[sessionId].last_seen = new Date();
      io.emit("status", { id: sessionId, status: "disconnected" });
      delete clients[sessionId];
    });

    await client.initialize();
await new Promise((r) => setTimeout(r, 3000));
console.log(`🚀 Client ${id} initialized and ready for QR.`);
  } catch (e) {
    console.error(`❌ Error create-client (${sessionId}):`, e.message);
    if (socket) socket.emit("error", `Gagal membuat session: ${e.message}`);
  }
}

// =============================
// 🌐 ROUTES (Hybrid Support)
// =============================

// --- Kompatibel dengan dashboard Tailwind lama ---
app.get("/add-number/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID tidak valid" });

  console.log(`⚙️ [Legacy] Menambahkan session baru: ${id}`);
  if (clients[id]) {
    return res.json({ message: "Client sudah aktif", id });
  }

  createClient(id);
  res.json({ message: `Client ${id} sedang login...`, id });
});

// --- List status semua session ---
app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
    last_seen: clients[id].last_seen,
  }));
  res.json(list);
});

// --- Health check ---
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    clients: Object.keys(clients).length,
    time: new Date().toISOString(),
  });
});

// ==== Root route ====
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Moggumung WA Server v6 Hybrid aktif ✅" });
});

// ==== Start server ====
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
