require('dotenv').config();
const path      = require('path');
const express   = require('express');
const bodyParser= require('body-parser');
const WebSocket = require('ws');
const mongoose  = require('mongoose');

const app        = express();
const PORT_HTTP  = process.env.PORT || 3000; // Render utilise process.env.PORT
const MONGODB_URI= process.env.MONGODB_URI;

// 1. Connexion à MongoDB Atlas
mongoose.connect(MONGODB_URI)
.then(() => console.log('[MongoDB] Connecté à Atlas'))
.catch(err => console.error('[MongoDB] Erreur de connexion', err));

// 2. Schémas
const configSchema = new mongoose.Schema({
  _id: { type: String, default: 'settings' },
  ledDuration: { type: Number, default: 5000 }
});
const statsSchema = new mongoose.Schema({
  _id: { type: String, default: 'counters' },
  scans: { type: Number, default: 0 },
  reconnects: { type: Number, default: 0 },
  heartbeats: { type: Number, default: 0 },
  ledOnCount: { type: Number, default: 0 },
  ledOffCount: { type: Number, default: 0 },
  lastScan: { type: Date, default: null },
  uptimeStart: { type: Date, default: Date.now }
});

const Config = mongoose.model('Config', configSchema);
const Stats  = mongoose.model('Stats', statsSchema);

// Initialisation des documents s'ils n'existent pas
async function initDb() {
  await Config.findByIdAndUpdate('settings', {}, { upsert: true });
  await Stats .findByIdAndUpdate('counters', {}, { upsert: true });
}
initDb();

// 8. Démarrage du serveur HTTP
const server = app.listen(PORT_HTTP, () => {
  console.log(`HTTP & PWA sur http://localhost:${PORT_HTTP}`);
});

// 3. WebSocket server intégré au serveur HTTP
let espSocket = null;
const wss = new WebSocket.Server({ server, path: '/ws' });
wss.on('connection', ws => {
  espSocket = ws;
  Stats.findByIdAndUpdate('counters', { $inc: { reconnects: 1 } }).exec();
  console.log('[WS] ESP32 connecté');

  ws.on('message', msg => {
    const obj = JSON.parse(msg);
    switch(obj.event) {
      case 'heartbeat':
        Stats.findByIdAndUpdate('counters', { $inc: { heartbeats: 1 } }).exec();
        break;
      case 'led_on':
        Stats.findByIdAndUpdate('counters', { $inc: { ledOnCount: 1 } }).exec();
        break;
      case 'led_off':
        Stats.findByIdAndUpdate('counters', { $inc: { ledOffCount: 1 } }).exec();
        break;
    }
  });

  ws.on('close', () => {
    console.log('[WS] ESP32 déconnecté');
    espSocket = null;
  });
});
console.log(`[WS] WebSocket intégré au serveur HTTP sur le même port`);

// 4. Middleware & statics
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../web-led-control')));

// 5. Endpoint scan (QR)
app.post('/api/scan', async (req, res) => {
  const cfg = await Config.findById('settings').lean();
  const duration = cfg.ledDuration;

  await Stats.findByIdAndUpdate('counters', {
    $inc: { scans: 1 },
    $set: { lastScan: new Date() }
  }).exec();

  if (!espSocket || espSocket.readyState !== WebSocket.OPEN) {
    return res.status(503).json({ error: 'ESP non connecté' });
  }

  const msg = JSON.stringify({ action: 'on', duration });
  espSocket.send(msg);
  console.log('[API] envoyé à ESP →', msg);

  const stats = await Stats.findById('counters').lean();
  res.json({ status: 'ok', stats });
});

// 6. Stats & config
app.get('/api/stats', async (req, res) => {
  const stats = await Stats.findById('counters').lean();
  const config = await Config.findById('settings').lean();
  res.json({ 
    ...stats, 
    uptime: Date.now() - stats.uptimeStart,
    ledDuration: config ? config.ledDuration : 5000
  });
});
app.post('/api/config', async (req, res) => {
  const { ledDuration } = req.body;
  if (typeof ledDuration !== 'number' || ledDuration <= 0) {
    return res.status(400).json({ error: 'ledDuration invalide' });
  }
  await Config.findByIdAndUpdate('settings', { ledDuration }).exec();
  res.json({ status: 'ok', ledDuration });
});

// 7. Routes spécifiques avant le fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../web-led-control/dashboard.html'));
});

app.get('/scan.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../web-led-control/scan.html'));
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../web-led-control/dashboard.html'));
});

// 7. Fallback PWA pour les autres routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '../web-led-control/dashboard.html'));
});
