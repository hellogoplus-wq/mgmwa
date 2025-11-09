// =============================
// 🚀 Moggumung WA Backend v18 (Render-Stable, Auto Recovery, Auth Fix)
// =============================
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

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

// =============================
// 🧠 HTTP + Socket.io Setup
// =============================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://chat.moggumung.id",
      "https://mgmwa.onrender.com",
      "http://localhost:5500",
    ],
    credentials: true,
  },
  transports: ["polling"], // ✅ Render Free Tier compatible
  allowEIO3: true,
  pingTimeout: 30000,
  pingInterval: 10000,
});

// =============================
// 🔌 SOCKET.IO CONNECTION
// =============================
io.on("connection", (socket) => {
  console.log("🔌 Dashboard connected:", socket.id);

  socket.emit("serverStatus", { connected: true, time: new Date() });
  socket.emit("welcome", { message: "Hello dashboard, Socket connected!" });

  const heartbeat = setInterval(() => {
    socket.emit("heartbeat", { time: new Date().toISOString() });
  }, 5000);

  socket.on("pingServer", () => {
    socket.emit("pongClient", { time: new Date().toISOString() });
  });

  socket.on("disconnect", (reason) => {
    console.log(`❌ Dashboard disconnected (${reason})`);
    clearInterval(heartbeat);
  });
});

// =============================
// 🧩 Chromium Detection (Render Safe)
// =============================
function detectChromiumPath() {
  try {
    const possiblePaths = [
      "/opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        console.log("✅ Chromium ditemukan:", p);
        return p;
      }
    }

    console.warn("⚠️ Chromium belum ada, mencoba install via Puppeteer...");
    execSync("npx puppeteer browsers install chrome", { stdio: "inherit" });

    const fallback =
      "/opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome";
    if (fs.existsSync(fallback)) {
      console.log("✅ Chromium berhasil diinstall:", fallback);
      return fallback;
    } else throw new Error("❌ Chromium tidak ditemukan setelah install");
  } catch (err) {
    console.error("❌ detectChromiumPath() gagal:", err.message);
    throw err;
  }
}

// =============================
// 💬 Clients Map
// =============================
let clients = {};
const reconnectDelay = 10000;

// =============================
// 📱 CREATE CLIENT (WA Session)
// =============================
async function createClient(id) {
  console.log(`🧩 Membuat client baru: ${id}`);
  fs.mkdirSync(".wwebjs_auth", { recursive: true });

  let chromiumPath;
  try {
    chromiumPath = detectChromiumPath();
  } catch {
    console.error(`❌ Tidak bisa menemukan Chrome untuk ${id}`);
    return;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id }),
    puppeteer: {
      headless: "new", // ✅ Fix QR login popup
      executablePath: chromiumPath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-web-security",
        "--disable-features=site-per-process",
        "--ignore-certificate-errors",
        "--single-process",
        "--no-zygote",
        "--window-size=1920,1080",
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
    console.log(`✅ ${id} siap digunakan`);
  });

  client.on("authenticated", () => {
    console.log(`🔐 ${id} berhasil terautentikasi`);
    io.emit("status", { id, status: "authenticated" });
  });

  client.on("auth_failure", (msg) => {
    console.error(`❌ Auth gagal (${id}):`, msg);
    io.emit("status", { id, status: "auth_failure" });
    setTimeout(() => {
      console.log(`🔁 Restarting ${id} setelah auth failure`);
      createClient(id);
    }, 10000);
  });

  client.on("disconnected", (reason) => {
    console.warn(`⚠️ ${id} disconnected (${reason})`);
    clients[id].status = "disconnected";
    io.emit("status", { id, status: "disconnected" });

    // Restart otomatis
    setTimeout(() => {
      try {
        client.destroy();
      } catch {}
      console.log(`🔁 Reconnecting ${id}...`);
      createClient(id);
    }, reconnectDelay);
  });

  client.on("message", (msg) => {
    io.emit("message", { id, from: msg.from, body: msg.body });
  });

  // 🧭 Watchdog: restart jika stuck > 60 detik
  setTimeout(() => {
    if (clients[id]?.status === "connecting") {
      console.warn(`⏱️ ${id} masih connecting >60s, restart...`);
      try {
        client.destroy();
      } catch {}
      delete clients[id];
      createClient(id);
    }
  }, 60000);

  try {
    await client.initialize();
  } catch (err) {
    console.error(`❌ Gagal init client ${id}:`, err.message);
  }
}

// =============================
// 🌐 ROUTES
// =============================
app.get("/add-number/:id", async (req, res) => {
  const id = req.params.id;
  if (clients[id] && clients[id].status === "connected")
    return res.json({ message: "Client already connected" });

  createClient(id);
  res.json({ message: `Client ${id} sedang login...` });
});

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

app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
    last_seen: clients[id].last_seen,
  }));
  res.json(list);
});

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

app.delete("/delete/:id", async (req, res) => {
  const id = req.params.id;
  if (!clients[id]) return res.status(404).json({ error: "Client not found" });

  try {
    await clients[id].client.destroy();
    delete clients[id];
    const authPath = `.wwebjs_auth/session-${id}`;
    if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });

    io.emit("status", { id, status: "deleted" });
    console.log(`🗑️ Session ${id} deleted`);
    res.json({ message: `${id} deleted successfully` });
  } catch (err) {
    console.error("❌ Delete failed:", err.message);
    res.status(500).json({ error: "Delete failed" });
  }
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    clients: Object.keys(clients).length,
    socketClients: io.engine.clientsCount,
    time: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.send("✅ Moggumung WA Backend v18 aktif dan stabil di Render 🚀");
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
