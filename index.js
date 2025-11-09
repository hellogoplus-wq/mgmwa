const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

// ✅ Perbaikan CORS — pastikan dashboard Hostinger diizinkan
app.use(
  cors({
    origin: ["https://chat.moggumung.id"], // domain frontend kamu
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());

// Buat HTTP + Socket.IO server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://chat.moggumung.id"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Objek penyimpanan semua sesi WA aktif
let clients = {};

// 🩵 Event: Dashboard pertama kali connect ke backend
io.on("connection", (socket) => {
  console.log("🔌 Dashboard connected via Socket.io");
  socket.emit("serverStatus", { connected: true, time: new Date() });

  socket.on("disconnect", () => {
    console.log("❌ Dashboard disconnected");
  });
});

// 🫀 Kirim heartbeat tiap 5 detik ke semua dashboard (untuk panel monitor)
setInterval(() => {
  io.emit("heartbeat", { time: new Date().toISOString() });
}, 5000);

// ✅ Route: Tambah nomor baru (login QR)
app.get("/add-number/:id", async (req, res) => {
  const id = req.params.id;

  if (clients[id]) return res.send({ message: "Client already exists" });

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id }),
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
    io.emit("status", { id, status: "connected", last_seen: clients[id].last_seen });
    console.log(`✅ ${id} connected`);
  });

  client.on("disconnected", () => {
    clients[id].status = "disconnected";
    clients[id].last_seen = new Date();
    io.emit("status", { id, status: "disconnected", last_seen: clients[id].last_seen });
    console.log(`⚠️ ${id} disconnected`);
  });

  client.on("message", (msg) => {
    clients[id].last_seen = new Date();
    io.emit("message", { id, from: msg.from, body: msg.body });
  });

  client.initialize();
  res.send({ message: `Client ${id} sedang login` });
});

// ✅ Route: Kirim pesan
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

// ✅ Route: Ambil daftar status semua device
app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
    last_seen: clients[id].last_seen,
  }));
  res.send(list);
});

// ✅ Route tes backend
app.get("/", (req, res) => {
  res.send("✅ Moggumung WA Backend Active");
});

// Jalankan server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 WA Backend aktif di port ${PORT}`);
});
