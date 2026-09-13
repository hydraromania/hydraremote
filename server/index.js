const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4420;
const PWA_DIR = path.join(__dirname, '..', 'pwa');
const DATA_FILE = path.join(__dirname, 'devices_db.json');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Baze de date în memorie cu salvare pe disc
const sessions = new Map();
const tempKeys = new Map();
let savedDevices = new Map();

// Încărcare dispozitive salvate pe disc
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const item of raw) {
      savedDevices.set(item.id, item);
    }
  }
} catch (e) {
  console.error('[HydraREMOTE] Eroare la citirea bazei de date a dispozitivelor:', e.message);
}

function persistDevices() {
  try {
    const arr = Array.from(savedDevices.values());
    fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('[HydraREMOTE] Eroare la salvarea dispozitivelor:', e.message);
  }
}

// Curățare chei temporare expirate periodic
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of tempKeys.entries()) {
    if (data.expiresAt && data.expiresAt < now) {
      tempKeys.delete(key);
    }
  }
}, 60000);

// Endpoint-uri API sesiune & Heartbeat de la terminale
app.post('/api/session/create', (req, res) => {
  const { machineId, apiKey, hostname, platform, userEmail } = req.body;
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  sessions.set(sessionId, {
    sessionId,
    machineId,
    apiKey,
    userEmail: userEmail ? userEmail.trim().toLowerCase() : null,
    createdAt: now,
    updatedAt: now
  });

  const devId = apiKey || sessionId;
  savedDevices.set(devId, {
    id: devId,
    sessionId,
    apiKey,
    userEmail: userEmail ? userEmail.trim().toLowerCase() : null,
    name: hostname || machineId || 'Computer Necunoscut',
    platform: platform || process.platform,
    tunnelUrl: '',
    localIp: '',
    lastSeen: now,
    createdAt: savedDevices.get(devId)?.createdAt || now
  });
  persistDevices();

  res.json({ success: true, sessionId });
});

app.post('/api/session/update', (req, res) => {
  const { sessionId, apiKey, tunnelUrl, localIp, hostname, platform, userEmail } = req.body;
  const now = Date.now();
  const cleanEmail = userEmail ? userEmail.trim().toLowerCase() : null;

  let targetSessionId = sessionId;
  if (!targetSessionId || !sessions.has(targetSessionId)) {
    targetSessionId = targetSessionId || crypto.randomUUID();
    sessions.set(targetSessionId, {
      sessionId: targetSessionId,
      apiKey,
      userEmail: cleanEmail,
      tunnelUrl,
      localIp,
      updatedAt: now
    });
  } else {
    const s = sessions.get(targetSessionId);
    s.tunnelUrl = tunnelUrl || s.tunnelUrl;
    s.localIp = localIp || s.localIp;
    if (cleanEmail) s.userEmail = cleanEmail;
    s.updatedAt = now;
  }

  // Actualizare dispozitiv pentru monitorizare Online/Offline
  const devId = apiKey || targetSessionId;
  const existing = savedDevices.get(devId) || {};
  savedDevices.set(devId, {
    id: devId,
    sessionId: targetSessionId,
    apiKey: apiKey || existing.apiKey || '',
    userEmail: cleanEmail || existing.userEmail || null,
    name: hostname || existing.name || 'Terminal PC',
    platform: platform || existing.platform || 'windows',
    tunnelUrl: tunnelUrl || existing.tunnelUrl || '',
    localIp: localIp || existing.localIp || '',
    lastSeen: now,
    createdAt: existing.createdAt || now
  });
  persistDevices();

  res.json({ success: true });
});

// Endpoint Monitorizare Dispozitive (filtrat pe cont Google sau cheie permanentă)
app.get('/api/devices', (req, res) => {
  const { apiKey, email } = req.query;
  const now = Date.now();
  const ONLINE_THRESHOLD_MS = 45 * 1000; // 45 secunde prag online

  let list = Array.from(savedDevices.values());

  // Dacă este specificat contul de email (Google)
  if (email) {
    const filterEmail = email.trim().toLowerCase();
    list = list.filter(d => d.userEmail && d.userEmail === filterEmail);
  } else if (apiKey) {
    list = list.filter(d => !d.apiKey || d.apiKey === apiKey || d.apiKey.startsWith(apiKey.substring(0, 10)));
  }

  const result = list.map(d => ({
    id: d.id,
    sessionId: d.sessionId,
    name: d.name,
    platform: d.platform,
    tunnelUrl: d.tunnelUrl,
    localIp: d.localIp,
    lastSeen: d.lastSeen,
    userEmail: d.userEmail || null,
    isOnline: (now - d.lastSeen) < ONLINE_THRESHOLD_MS,
    apiKey: d.apiKey
  }));

  res.json({ success: true, devices: result });
});

// Asociază un dispozitiv cu un cont Google din interfață
app.post('/api/devices/claim', (req, res) => {
  const { deviceId, email } = req.body;
  if (!deviceId || !email) {
    return res.status(400).json({ error: 'Missing deviceId or email' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (savedDevices.has(deviceId)) {
    const dev = savedDevices.get(deviceId);
    dev.userEmail = cleanEmail;
    savedDevices.set(deviceId, dev);
    persistDevices();
    return res.json({ success: true, device: dev });
  }

  res.status(404).json({ error: 'Device not found' });
});

// Endpoint-uri temp-key (QR Scan și conectare rapidă PWA)
app.post('/api/temp-key/create', (req, res) => {
  const { apiKey, tunnelUrl, localIp } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing apiKey' });
  }

  const tempKey = 'hydra_' + crypto.randomBytes(4).toString('hex');
  tempKeys.set(tempKey, {
    apiKey,
    tunnelUrl: tunnelUrl || '',
    localIp: localIp || '',
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  res.json({ success: true, tempKey });
});

app.post('/api/temp-key/verify', (req, res) => {
  const { tempKey } = req.body;
  if (!tempKey || !tempKeys.has(tempKey)) {
    return res.status(404).json({ error: 'Invalid or expired temporary key' });
  }

  const data = tempKeys.get(tempKey);
  res.json({
    success: true,
    apiKey: data.apiKey,
    tunnelUrl: data.tunnelUrl,
    localIp: data.localIp
  });
});

app.post('/api/temp-key/remove', (req, res) => {
  const { tempKey } = req.body;
  if (tempKey) {
    tempKeys.delete(tempKey);
  }
  res.json({ success: true });
});

// WebRTC TURN credentials
app.get('/api/webrtc/turn-credentials', (req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'HydraREMOTE Server', time: new Date().toISOString() });
});

// Servire fișiere statice PWA
app.use(express.static(PWA_DIR));

// Rute dedicate UI
app.get('/devices', (req, res) => {
  res.sendFile(path.join(PWA_DIR, 'devices.html'));
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(PWA_DIR, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[HydraREMOTE] Server running on http://0.0.0.0:${PORT}`);
  console.log(`[HydraREMOTE] Serving PWA from: ${PWA_DIR}`);
});
