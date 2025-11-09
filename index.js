// =============================
// 🚀 Moggumung WA Backend (Render-Ready Stable Version)
// With Auto-Reconnect + KeepAlive + Chrome Path Fix
// =============================
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const axios = require("axios");
const puppeteer = require("puppeteer"); // ✅ pakai full puppeteer, bukan core

const app = express();

// =============================
// ⚙️ Middleware & CORS Setup
// =============================
app.use(
  cors({
    origin: ["https://chat.moggumung.id"],
    methods: ["GET", "POST"],
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
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// =============================
// 💬 Clients Map
// =============================
let clients = {};
const reconnectDelay = 10000; // 10 detik

// =============================
// 🔌 Dashboard Socket Connection
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
// 📱 Create / Reconnect WhatsApp Session
// =============================
const chromiumPath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "/usr/bin/google-chrome-stable";

async function createClient(id) {
  console.log(`🧩 Membuat client baru: ${id}`);

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
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    },
  });

  clients[id] = { client, status: "connecting", last_seen: new Date() };

  // 🔳 QR Code event
  client.on("qr", async (qr) => {
    const qrImage = await qrcode.toDataURL(qr);
    io.emit("qr", { id, qr: qrImage });
    console.log(`📲 QR untuk ${id} dikirim ke dashboard`);
  });

  // ✅ Ready event
  client.on("ready", () => {
    clients[id].status = "connected";
    clients[id].last_seen = new Date();
    io.emit("status", { id, status: "connected" });
    console.log(`✅ ${id} connected`);
  });

  // ⚠️ Disconnected event
  client.on("disconnected", (reason) => {
    console.log(`⚠️ ${id} disconnected (${reason})`);
    clients[id].status = "disconnected";
    io.emit("status", { id, status: "disconnected" });

    // 🔁 Auto reconnect
    setTimeout(() => {
      console.log(`🔄 Mencoba reconnect client ${id}...`);
      createClient(id);
    }, reconnectDelay);
  });

  // 💬 Pesan diterima
  client.on("message", (msg) => {
    clients[id].last_seen = new Date();
    io.emit("message", { id, from: msg.from, body: msg.body });
  });

  // 🚀 Inisialisasi WA Client
  try {
    await client.initialize();
  } catch (err) {
    console.error(`❌ Error initializing client ${id}:`, err.message);
  }
}

// =============================
// 🧠 Route: Add New Number
// =============================
app.get("/add-number/:id", async (req, res) => {
  const id = req.params.id;

  if (clients[id] && clients[id].status === "connected") {
    return res.json({ message: "Client already connected" });
  }

  createClient(id);
  res.json({ message: `Client ${id} sedang login...` });
});

// =============================
// ✉️ Route: Send Message
// =============================
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

// =============================
// 📊 Route: Status
// =============================
app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
    last_seen: clients[id].last_seen,
  }));
  res.json(list);
});

// =============================
// 🧪 Route: Healthcheck
// =============================
app.get("/", (req, res) => {
  res.send("✅ Moggumung WA Backend Active (Auto-Reconnect + Render Chrome Fix)");
});

// =============================
// 🕒 KeepAlive Ping (Prevent Render Sleep)
// =============================
const KEEPALIVE_URL = "https://mgmwa.onrender.com";
setInterval(async () => {
  try {
    await axios.get(KEEPALIVE_URL);
    console.log("💓 KeepAlive ping sent to", KEEPALIVE_URL);
  } catch (err) {
    console.error("⚠️ KeepAlive failed:", err.message);
  }
}, 5 * 60 * 1000); // tiap 5 menit

// =============================
// 🚀 Start Server
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 WA Backend aktif di port ${PORT}`);
  console.log(`🌐 Accessible via ${KEEPALIVE_URL}`);
});
