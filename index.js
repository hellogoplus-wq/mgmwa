// =============================
// 🚀 Moggumung WA Backend v9 (Render-Stable)
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
const puppeteer = require("puppeteer");

const app = express();

// =============================
// ⚙️ Middleware & CORS (Render Compatible)
// =============================
const allowedOrigins = [
  "https://chat.moggumung.id",
  "https://mgmwa.onrender.com",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// =============================
// 🌐 HTTP + WebSocket Server
// =============================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// =============================
// 💾 Clients Storage
// =============================
let clients = {};
const reconnectDelay = 10000;

// =============================
// 🔌 Socket.io Connection
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
// 🧭 Chromium Path Detector (Render compatible)
// =============================
async function detectChromiumPath() {
  try {
    let chromiumPath;

    // Render env stores temp files in /tmp
    const tmpPath = "/tmp/chromium-cache";
    if (!fs.existsSync(tmpPath)) {
      console.log("📁 Membuat folder cache Puppeteer di:", tmpPath);
      fs.mkdirSync(tmpPath, { recursive: true });
    }

    // Try puppeteer.executablePath() first
    try {
      chromiumPath = puppeteer.executablePath();
      if (fs.existsSync(chromiumPath)) {
        console.log("✅ Chromium ditemukan:", chromiumPath);
        return chromiumPath;
      }
    } catch (err) {
      console.warn("⚠️ puppeteer.executablePath() gagal:", err.message);
    }

    // Try searching local chromium folders
    const localChrome = path.join(tmpPath, "chrome");
    if (fs.existsSync(localChrome)) {
      const dirs = fs.readdirSync(localChrome);
      if (dirs.length > 0) {
        const latest = path.join(
          localChrome,
          dirs[0],
          "chrome-linux64",
          "chrome"
        );
        if (fs.existsSync(latest)) {
          console.log("✅ Chromium ditemukan (local cache):", latest);
          return latest;
        }
      }
    }

    console.log("⬇️ Mencoba download Chromium otomatis ke", tmpPath);
    const { execSync } = require("child_process");
    execSync("npx puppeteer browsers install chrome", { stdio: "inherit" });

    // Check again
    if (fs.existsSync(localChrome)) {
      const dirs = fs.readdirSync(localChrome);
      if (dirs.length > 0) {
        const latest = path.join(
          localChrome,
          dirs[0],
          "chrome-linux64",
          "chrome"
        );
        if (fs.existsSync(latest)) {
          console.log("✅ Chromium berhasil diinstall:", latest);
          return latest;
        }
      }
    }

    throw new Error("❌ Chromium tidak ditemukan setelah percobaan install.");
  } catch (err) {
    console.error("❌ Gagal deteksi Chromium:", err.message);
    throw err;
  }
}

// =============================
// 🤖 Create WhatsApp Client
// =============================
async function createClient(id) {
  console.log(`🧩 Membuat client baru: ${id}`);
  const chromiumPath = await detectChromiumPath();

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
// 🌐 API ROUTES
// =============================

// Add Number (generate QR)
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

// Status
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

// Delete Device
app.delete("/delete/:id", async (req, res) => {
  const id = req.params.id;
  if (!clients[id]) return res.status(404).json({ error: "Client not found" });

  try {
    await clients[id].client.destroy();
    delete clients[id];
    const sessionPath = path.join(__dirname, `.wwebjs_auth/session-${id}`);
    if (fs.existsSync(sessionPath))
      fs.rmSync(sessionPath, { recursive: true, force: true });

    io.emit("status", { id, status: "deleted" });
    console.log(`🗑️ Session ${id} deleted`);
    res.json({ message: `${id} session deleted successfully` });
  } catch (err) {
    console.error("❌ Delete failed:", err.message);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Root
app.get("/", (req, res) => {
  res.send("✅ Moggumung WA Backend Active (Render-Stable v9)");
});

// =============================
// 🕒 KeepAlive
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
