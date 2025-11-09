// =============================
// 🚀 Moggumung WA Backend (Final Stable Render Version)
// Auto Chrome Detect + Auto Reconnect + KeepAlive Ping
// =============================
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer"); // ✅ hanya sekali deklarasi

const app = express();

// =============================
// ⚙️ Middleware & CORS
// =============================
app.use(
  cors({
    origin: ["https://chat.moggumung.id"],
    methods: ["GET", "POST", "DELETE"],
    credentials: true,
  })
);
app.use(express.json());

// =============================
// 🧠 HTTP + WebSocket Server
// =============================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://chat.moggumung.id"],
    methods: ["GET", "POST", "DELETE"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// =============================
// 💬 Clients Storage
// =============================
let clients = {};
const reconnectDelay = 10000;

// =============================
// 🔌 Dashboard Connection
// =============================
io.on("connection", (socket) => {
  console.log("🔌 Dashboard connected via Socket.io");
  socket.emit("serverStatus", { connected: true, time: new Date() });

  const heartbeat = setInterval(() => {
    socket.emit("heartbeat", { time: new Date().toISOString() });
  }, 5000);

  socket.on("disconnect", (reason) => {
    console.log(`❌ Dashboard disconnected (${reason})`);
    clearInterval(heartbeat);
  });
});

// =============================
// 🧩 Smart Chromium Detector + Auto Downloader
// =============================
// =============================
// 🧩 Stable Puppeteer Path Fix for Render
// =============================
async function detectChromiumPath() {
  const path = require("path");
  const { execSync } = require("child_process");

  // Tempat stabil di container Render
  const baseDir = "/tmp/chromium-cache";
  const chromeRoot = path.join(baseDir, "chrome");

  // Pastikan folder ada
  if (!fs.existsSync(baseDir)) {
    console.log("📁 Membuat folder cache Puppeteer di:", baseDir);
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // Coba gunakan bawaan Puppeteer dulu
  try {
    const chromePath = puppeteer.executablePath();
    if (fs.existsSync(chromePath)) {
      console.log("🧭 Chromium bawaan Puppeteer ditemukan:", chromePath);
      return chromePath;
    } else {
      console.warn("⚠️ Puppeteer internal path tidak valid:", chromePath);
    }
  } catch (err) {
    console.warn("⚠️ puppeteer.executablePath() gagal:", err.message);
  }

  // Download otomatis bila belum ada
  console.log("⬇️ Memastikan Chromium sudah ada di", baseDir);
  try {
    execSync(`npx puppeteer browsers install chrome --path ${baseDir}`, {
      stdio: "inherit",
    });
  } catch (err) {
    console.error("❌ Gagal mendownload Chromium otomatis:", err.message);
  }

  // Ambil versi terbaru dari cache
  try {
    const dirs = fs.readdirSync(chromeRoot, { withFileTypes: true });
    const latest = dirs.sort((a, b) => (a.name > b.name ? -1 : 1))[0];
    const chromeCandidate = path.join(chromeRoot, latest.name, "chrome-linux64", "chrome");
    if (fs.existsSync(chromeCandidate)) {
      console.log("✅ Chromium ditemukan:", chromeCandidate);
      return chromeCandidate;
    }
  } catch (err) {
    console.error("❌ Gagal membaca folder cache:", err.message);
  }

  throw new Error("❌ Chromium tidak ditemukan setelah percobaan install.");
}



// =============================
// 📱 Create WhatsApp Client
// =============================
async function createClient(id) {
  console.log(`🧩 Membuat client baru: ${id}`);

  let chromiumPath;
  try {
    chromiumPath = await detectChromiumPath();
  } catch (err) {
    console.error(`❌ Tidak bisa menemukan Chrome untuk ${id}:`, err.message);
    return; // stop kalau Chrome gagal
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id }),
    puppeteer: {
      headless: true,
      executablePath: chromiumPath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
      ],
    },
  });


  clients[id] = { client, status: "connecting", last_seen: new Date() };

  client.on("qr", async (qr) => {
    const qrImage = await qrcode.toDataURL(qr);
    io.emit("qr", { id, qr: qrImage });
    console.log(`📲 QR untuk ${id} dikirim ke dashboard`);
  });

  client.on("ready", () => {
    clients[id].status = "connected";
    clients[id].last_seen = new Date();
    io.emit("status", { id, status: "connected" });
    console.log(`✅ ${id} connected`);
  });

  client.on("disconnected", (reason) => {
    console.log(`⚠️ ${id} disconnected (${reason})`);
    clients[id].status = "disconnected";
    io.emit("status", { id, status: "disconnected" });

    // 🔁 Auto reconnect
    setTimeout(() => {
      console.log(`🔄 Reconnecting client ${id}...`);
      createClient(id);
    }, reconnectDelay);
  });

  client.on("message", (msg) => {
    clients[id].last_seen = new Date();
    io.emit("message", { id, from: msg.from, body: msg.body });
  });

  try {
    await client.initialize();
  } catch (err) {
    console.error(`❌ Error initializing client ${id}:`, err.message);
  }
}

// =============================
// 🌐 API Routes
// =============================

// Add Number
app.get("/add-number/:id", async (req, res) => {
  const id = req.params.id;
  if (clients[id] && clients[id].status === "connected") {
    return res.json({ message: "Client already connected" });
  }

  createClient(id);
  res.json({ message: `Client ${id} sedang login...` });
});

// Send Message
app.post("/send", async (req, res) => {
  const { id, to, message } = req.body;
  if (!clients[id]) return res.status(400).json({ error: "Client not found" });

  try {
    await clients[id].client.sendMessage(`${to}@c.us`, message);
    clients[id].last_seen = new Date();
    res.json({ status: "sent", to, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Send failed" });
  }
});

// Status List
app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
    last_seen: clients[id].last_seen,
  }));
  res.json(list);
});

// Root
app.get("/", (req, res) => {
  res.send("✅ Moggumung WA Backend Active (Render Stable Version)");
});

// =============================
// 🚪 Logout Device
// =============================
app.get("/logout/:id", async (req, res) => {
  const id = req.params.id;
  if (!clients[id]) return res.status(404).json({ error: "Client not found" });

  try {
    await clients[id].client.logout();
    clients[id].status = "logged_out";
    io.emit("status", { id, status: "logged_out" });
    console.log(`🚪 ${id} logged out`);
    res.json({ message: `${id} logged out successfully` });
  } catch (err) {
    console.error("❌ Logout failed:", err.message);
    res.status(500).json({ error: "Logout failed" });
  }
});

// =============================
// 🗑️ Delete Device (Clear Session)
// =============================
app.delete("/delete/:id", async (req, res) => {
  const id = req.params.id;
  if (!clients[id]) return res.status(404).json({ error: "Client not found" });

  try {
    await clients[id].client.destroy();
    delete clients[id];

    const sessionPath = path.join(__dirname, `.wwebjs_auth/session-${id}`);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`🗑️ Session folder deleted for ${id}`);
    }

    io.emit("status", { id, status: "deleted" });
    res.json({ message: `${id} session deleted successfully` });
  } catch (err) {
    console.error("❌ Delete failed:", err.message);
    res.status(500).json({ error: "Delete failed" });
  }
});

// =============================
// 🕒 KeepAlive Ping
// =============================
const KEEPALIVE_URL = process.env.KEEPALIVE_URL || "https://mgmwa.onrender.com";
setInterval(async () => {
  try {
    await axios.get(KEEPALIVE_URL);
    console.log("💓 KeepAlive ping sent to", KEEPALIVE_URL);
  } catch (err) {
    console.error("⚠️ KeepAlive failed:", err.message);
  }
}, 5 * 60 * 1000);

// =============================
// 🚀 Start Server
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 WA Backend aktif di port ${PORT}`);
  console.log(`🌐 Accessible via ${KEEPALIVE_URL}`);
});
