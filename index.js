const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // kamu bisa ganti dengan domain Hostinger nanti
    methods: ["GET", "POST"]
  }
});

let clients = {}; // semua sesi WA aktif disimpan di sini

// API: Tambah nomor baru (login QR)
app.get("/add-number/:id", async (req, res) => {
  const id = req.params.id;

  if (clients[id]) return res.send({ message: "Client already exists" });

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id }),
  });

  clients[id] = { client, status: "connecting" };

  client.on("qr", async (qr) => {
    const qrImage = await qrcode.toDataURL(qr);
    io.emit("qr", { id, qr: qrImage });
    console.log(`QR untuk ${id} dikirim ke dashboard`);
  });

  client.on("ready", () => {
    clients[id].status = "connected";
    io.emit("status", { id, status: "connected" });
    console.log(`✅ ${id} connected`);
  });

  client.on("disconnected", () => {
    clients[id].status = "disconnected";
    io.emit("status", { id, status: "disconnected" });
  });

  client.on("message", (msg) => {
    io.emit("message", { id, from: msg.from, body: msg.body });
  });

  client.initialize();
  res.send({ message: `Client ${id} sedang login` });
});

// API: Kirim pesan
app.post("/send", async (req, res) => {
  const { id, to, message } = req.body;
  if (!clients[id]) return res.status(400).send({ error: "Client not found" });
  try {
    await clients[id].client.sendMessage(`${to}@c.us`, message);
    res.send({ status: "sent", to, message });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Send failed" });
  }
});

// API: Ambil daftar status
app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
  }));
  res.send(list);
});

server.listen(process.env.PORT || 10000, () =>
  console.log("🚀 WA Backend aktif di port 10000")
);
