// =============================
// 🚀 Moggumung WA Backend (Render Optimized v3)
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
const { execSync } = require("child_process");
const path = require("path");

const app = express();

// =============================
// ⚙️ Middleware & CORS
// =============================
app.use(
  cors({
    origin: [
      "https://chat.moggumung.id",
      "https://mgmwa.onrender.com",
      "http://localhost:5500",
    ],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.use(express.json());

// =============================
// 🧠 Server + Socket.io
// =============================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://chat.moggumung.id",
      "https://mgmwa.onrender.com",
      "http://localhost:5500",
    ],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  },
  transports: ["polling"],
  allowEIO3: true,
  pingTimeout: 30000,
  pingInterval: 10000,
});

// =============================
// 🔌 Socket Events
// =============================
io.on("connection", (socket) => {
  console.log("🔌 Dashboard connected:", socket.id);
  socket.emit("serverStatus", { connected: true, time: new Date() });
  socket.emit("welcome", { message: "Hello dashboard, Socket connected!" });

  const heartbeat = setInterval(() => {
    socket.emit("heartbeat", { time: new Date().toISOString() });
  }, 5000);

  socket.on("disconnect", (reason) => {
    console.log(`❌ Dashboard disconnected (${reason})`);
    clearInterval(heartbeat);
  });
});

// =============================
// ⚙️ Chromium Path Detector
// =============================
async function detectChromiumPath() {
  try {
    const cached = "/opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome";
    if (fs.existsSync(cached)) {
      console.log("✅ Chromium ditemukan:", cached);
      return cached;
    }

    console.warn("⚠️ Chromium belum ada, install via Puppeteer...");
    execSync("npx puppeteer browsers install chrome", { stdio: "inherit" });

    if (fs.existsSync(cached)) {
      console.log("✅ Chromium berhasil diinstall:", cached);
      return cached;
    }

    throw new Error("❌ Chromium gagal ditemukan");
  } catch (err) {
    console.error("detectChromiumPath() gagal:", err.message);
    throw err;
  }
}

// Preload Chromium agar siap sebelum WA client dibuat
(async () => {
  try {
    await detectChromiumPath();
    console.log("🧭 Chromium preload OK");
  } catch (e) {
    console.error("❌ Chromium preload gagal:", e.message);
  }
})();

// =============================
// 💬 WhatsApp Clients
// =============================
let clients = {};
const reconnectDelay = 15000;

// =============================
// 📱 CREATE CLIENT
// =============================
async function createClient(id, attempt = 1) {
  console.log(`🧩 Membuat client baru: ${id} (attempt ${attempt})`);

  let chromiumPath;
  try {
    chromiumPath = await detectChromiumPath();
  } catch {
    console.error("❌ Tidak bisa menemukan Chrome");
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
        "--disable-extensions",
        "--disable-features=site-per-process",
        "--single-process",
        "--no-zygote",
        "--window-size=1920,1080",
        "--headless=new", // ✅ pakai mode baru headless
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

  client.on("authenticated", () => {
    console.log(`🔐 ${id} authenticated`);
  });

  client.on("auth_failure", () => {
    console.warn(`⚠️ ${id} authentication failed`);
    io.emit("status", { id, status: "auth_failed" });
  });

  client.on("disconnected", (reason) => {
    console.log(`⚠️ ${id} disconnected (${reason})`);
    clients[id].status = "disconnected";
    io.emit("status", { id, status: "disconnected" });

    setTimeout(() => {
      console.log(`🔁 Reconnecting ${id}...`);
      createClient(id, attempt + 1);
    }, reconnectDelay);
  });

  client.on("message", (msg) => {
    io.emit("message", { id, from: msg.from, body: msg.body });
  });

  try {
    await client.initialize();
  } catch (err) {
    console.error(`❌ Error init ${id}: ${err.message}`);
    if (err.message.includes("Target closed") && attempt < 3) {
      console.log("🔁 Retry init setelah crash kecil...");
      setTimeout(() => createClient(id, attempt + 1), 10000);
    }
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

// Status List
app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
    last_seen: clients[id].last_seen,
  }));
  res.json(list);
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

// Logout & Delete
app.get("/logout/:id", async (req, res) => {
  const id = req.params.id;
  if (!clients[id]) return res.status(404).json({ error: "Client not found" });

  try {
    await clients[id].client.logout();
    clients[id].status = "logged_out";
    io.emit("status", { id, status: "logged_out" });
    res.json({ message: `${id} logged out` });
  } catch (err) {
    res.status(500).json({ error: "Logout failed" });
  }
});

app.delete("/delete/:id", async (req, res) => {
  const id = req.params.id;
  if (!clients[id]) return res.status(404).json({ error: "Client not found" });

  try {
    await clients[id].client.destroy();
    delete clients[id];
    const authPath = `.wwebjs_auth/session-${id}`;
    if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });

    io.emit("status", { id, status: "deleted" });
    res.json({ message: `${id} deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

// Healthcheck
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Root
app.get("/", (req, res) => {
  res.send("✅ Moggumung WA Backend Active (Render Optimized v3)");
});

// =============================
// 🕒 KEEPALIVE
// =============================
const KEEPALIVE_URL = "https://mgmwa.onrender.com";
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
