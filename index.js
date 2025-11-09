const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());

let clients = {}; // menyimpan semua nomor aktif

// API: Tambah nomor baru (login QR)
app.get("/add-number/:id", async (req, res) => {
  const id = req.params.id;
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id }),
  });

  clients[id] = { client, status: "loading" };

  client.on("qr", async (qr) => {
    const qrImg = await qrcode.toDataURL(qr);
    io.emit("qr", { id, qr: qrImg });
  });

  client.on("ready", () => {
    clients[id].status = "connected";
    io.emit("status", { id, status: "connected" });
  });

  client.on("message", (msg) => {
    io.emit("message", { from: msg.from, body: msg.body, id });
  });

  client.initialize();

  res.send({ message: "QR code will be emitted via socket.io" });
});

// API: Kirim pesan
app.post("/send", async (req, res) => {
  const { id, to, message } = req.body;
  if (!clients[id]) return res.status(400).send({ error: "Client not found" });

  try {
    await clients[id].client.sendMessage(`${to}@c.us`, message);
    res.send({ status: "sent", id, to, message });
  } catch (err) {
    res.status(500).send({ error: "Failed to send" });
  }
});

// API: Ambil status semua nomor
app.get("/status", (req, res) => {
  const list = Object.keys(clients).map((id) => ({
    id,
    status: clients[id].status,
  }));
  res.send(list);
});

server.listen(process.env.PORT || 10000, () =>
  console.log("🚀 Server running...")
);
