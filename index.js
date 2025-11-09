const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const app = express();
const port = process.env.PORT || 10000;

const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on("qr", (qr) => {
  console.log("QR RECEIVED");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

client.initialize();

app.get("/", (req, res) => {
  res.send("WA Backend is running 🚀");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
