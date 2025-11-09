import express from 'express';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const app = express();
app.use(express.json());

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "multi-device-01" })
});

client.on('qr', qr => {
  console.log('QR RECEIVED', qr);
});

client.on('ready', () => {
  console.log('WhatsApp is ready!');
});

client.initialize();

app.get('/', (req, res) => res.send('WA Backend Active'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
