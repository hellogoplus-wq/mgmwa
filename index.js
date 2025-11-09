// =============================
// 🚀 Moggumung WA Backend (Final Fixed)
// Compatible with Render + Hostinger dashboard
// =============================

const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

// ✅ CORS Setup - Allow Hostinger dashboard access
app.use(
  cors({
    origin: ["https://chat.moggumung.id"], // domain frontend kamu
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());

// ✅ Create HTTP + WebSocket Server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://chat.moggumung.id"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  path: "/socket.io/",
  transports: ["websocket", "polling"], // support fallback
  allowEIO3: true, // backward compatibility
  pingTimeout: 30000, // timeout sebelum disconnect
  pingInterval: 10000, // heartbeat tiap 10 detik
});

// =============================
// 💬 WhatsApp Clients Storage
// =============================
let clients = {};

// =============================
// 🔌 Dashboard Connection
// =============================
io.on("connection", (socket) => {
  console.log("🔌 Dashboard connected via Socket.io");

  socket.emit("serverStatus", { connected: true, time: new Date() });

  socket.on("disconnect", (reason) => {
    console.log(`❌ Dashboard disconnected (${reason})`);
  });

  // kirim heartbeat tiap 5 detik ke dashboard
  const heartbeat = setInterval(() => {
    socket.emit("heartbeat", { time: new Date().toISOString() });
  }, 5000);

  socket.on("disconnect", () => clearInterval(heartbeat));
});

// =============================
// 📱 Add WhatsApp Session
// =============================
app.get("/add-number/:id", async (req, res) => {
  const id = req.params.id;
  if (clients[id]) return res.send({ message: "Client already exists" });

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id }),
    puppeteer: {
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
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
    io.emit("status", {
      id,
      status: "connected",
      last_seen: clients[id].last_seen,
    });
    console.log(`✅ ${id} connected`);
  });

  client.on("disconnected", (reason) => {
    clients[id].status = "disconnected";
    clients[id].last_seen = new Date();
    io.emit("status", {
      id,
      status: "disconnected",
      last_seen: clients[id].last_seen,
    });
    console.log(`⚠️ ${id} disconnected (${reason})`);
  });

  client.on("message", (msg) => {
    clients[id].last_seen = new Date();
    io.emit("message", { id, from: msg.from, body: msg.body });
  });

  try {
    await client.initialize();
    res.send({ message: `Client ${id} sedang login` });
  } catch (err) {
    console.error("❌ Error initializing WA client:", err);
    res.status(500).send({ error: "Failed to initialize client" });
  }
});

// =============================
// ✉️ Send Message
// =============================
app.post("/send", async (req, res) => {
  const { id, to, message } = req.body;
  if (!clients[id]) return res.status(400).send({ error: "Client not found" });

  try {
    await clients[id].client.sendMessage(`${to}@c.us`, message);
    clients[id].last_seen = new Date();
    res.send({ status: "sent", to, message });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Send failed" });
  }
});

// =============================
// 📊 Device Status Endpoint
// =============================
app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
    last_seen: clients[id].last_seen,
  }));
  res.send(list);
});

// =============================
// 🧪 Test Route
// =============================
app.get("/", (req, res) => {
  res.send("✅ Moggumung WA Backend Active");
});

// =============================
// 🚀 Start Server
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 WA Backend aktif di port ${PORT}`);
  console.log(`🌐 Accessible via https://mgmwa.onrender.com`);
});
