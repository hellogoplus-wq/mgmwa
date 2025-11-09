// =============================
// 🚀 Moggumung WA Backend (Final Render Version)
// Stable for Render + Socket.io + Auto-Reconnect + CORS Fix
// =============================
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const axios = require("axios");
const fs = require("fs");
const puppeteer = require("puppeteer");

const app = express();

// =============================
// ⚙️ CORS & Middleware
// =============================
app.use(
  cors({
    origin: [
      "https://chat.moggumung.id",
      "https://mgmwa.onrender.com",
      "http://localhost:5500",
      "http://127.0.0.1:5500"
    ],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// ✅ Global CORS handler (for OPTIONS preflight)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin);
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

// =============================
// 🧠 HTTP + SOCKET SERVER (RENDER FIXED VERSION)
// =============================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://chat.moggumung.id",
      "https://mgmwa.onrender.com",
      "http://localhost:5500",
      "http://127.0.0.1:5500"
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ✅ Tambahkan endpoint manual untuk Socket.io handshake
app.get("/socket.io/", (req, res) => {
  res.send("🧠 Socket.io endpoint is alive");
});

// =============================
// 💬 Clients Map
// =============================
let clients = {};
const reconnectDelay = 10000;

// =============================
// 🔌 SOCKET CONNECTION HANDLER
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
// 🧩 DETECT CHROMIUM PATH (Render-safe)
// =============================
async function detectChromiumPath() {
  try {
    const path = puppeteer.executablePath();
    if (fs.existsSync(path)) {
      console.log("✅ Chromium ditemukan:", path);
      return path;
    } else {
      console.warn("⚠️ Path tidak valid, mencoba fallback manual...");
      const fallback = "/tmp/chromium-cache/chrome/linux-127.0.6533.88/chrome-linux64/chrome";
      if (fs.existsSync(fallback)) {
        console.log("✅ Fallback Chromium ditemukan:", fallback);
        return fallback;
      } else {
        console.error("❌ Tidak ada Chromium ditemukan.");
        throw new Error("Chromium not found");
      }
    }
  } catch (err) {
    console.error("⚠️ puppeteer.executablePath() gagal:", err.message);
    throw err;
  }
}

// =============================
// 📱 CREATE CLIENT
// =============================
async function createClient(id) {
  console.log(`🧩 Membuat client baru: ${id}`);

  let chromiumPath;
  try {
    chromiumPath = await detectChromiumPath();
  } catch {
    console.error(`❌ Tidak bisa menemukan Chrome untuk ${id}`);
    return;
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
    setTimeout(() => createClient(id), reconnectDelay);
  });

  client.on("message", (msg) => {
    io.emit("message", { id, from: msg.from, body: msg.body });
  });

  try {
    await client.initialize();
  } catch (err) {
    console.error(`❌ Error initializing client ${id}:`, err.message);
  }
}

// =============================
// 🌐 ROUTES
// =============================

// Add Number
app.get("/add-number/:id", async (req, res) => {
  const id = req.params.id;
  if (clients[id] && clients[id].status === "connected")
    return res.json({ message: "Client already connected" });

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

// Get Status
app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
    last_seen: clients[id].last_seen,
  }));
  res.json(list);
});

// Logout
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

// Delete
app.delete("/delete/:id", async (req, res) => {
  const id = req.params.id;
  if (!clients[id]) return res.status(404).json({ error: "Client not found" });

  try {
    await clients[id].client.destroy();
    delete clients[id];
    const path = `.wwebjs_auth/session-${id}`;
    if (fs.existsSync(path)) fs.rmSync(path, { recursive: true, force: true });

    io.emit("status", { id, status: "deleted" });
    console.log(`🗑️ Session ${id} deleted`);
    res.json({ message: `${id} deleted successfully` });
  } catch (err) {
    console.error("❌ Delete failed:", err.message);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Healthcheck
app.get("/", (req, res) => {
  res.send("✅ Moggumung WA Backend Active (Render-Stable Version)");
});

// =============================
// 🕒 KEEPALIVE
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
// 🚀 START SERVER
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 WA Backend aktif di port ${PORT}`);
  console.log(`🌐 Accessible via ${KEEPALIVE_URL}`);
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});
