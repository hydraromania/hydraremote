const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4420;
const PWA_DIR = path.join(__dirname, '..', 'pwa');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sesiuni și Chei Temporare în memorie
const sessions = new Map();
const tempKeys = new Map();

// Curățare chei expirate periodic (la fiecare 60s)
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of tempKeys.entries()) {
    if (data.expiresAt && data.expiresAt < now) {
      tempKeys.delete(key);
    }
  }
}, 60000);

// Endpoint-uri API sesiune
app.post('/api/session/create', (req, res) => {
  const { machineId, apiKey } = req.body;
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    sessionId,
    machineId,
    apiKey,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  res.json({ success: true, sessionId });
});

app.post('/api/session/update', (req, res) => {
  const { sessionId, tunnelUrl, localIp } = req.body;
  if (!sessionId || !sessions.has(sessionId)) {
    // Dacă nu există, creăm sau acceptăm pentru flexibilitate
    sessions.set(sessionId || crypto.randomUUID(), {
      tunnelUrl,
      localIp,
      updatedAt: Date.now()
    });
  } else {
    const s = sessions.get(sessionId);
    s.tunnelUrl = tunnelUrl || s.tunnelUrl;
    s.localIp = localIp || s.localIp;
    s.updatedAt = Date.now();
  }
  res.json({ success: true });
});

// Endpoint-uri temp-key (QR Scan și conectare rapidă PWA)
app.post('/api/temp-key/create', (req, res) => {
  const { apiKey, tunnelUrl, localIp } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing apiKey' });
  }

  // Generăm o cheie temporară unică de 6-8 caractere sau uuid
  const tempKey = 'hydra_' + crypto.randomBytes(4).toString('hex');
  tempKeys.set(tempKey, {
    apiKey,
    tunnelUrl: tunnelUrl || '',
    localIp: localIp || '',
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000 // valabil 10 minute
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

// Fallback SPA pe index.html (pentru rute precum /login etc.)
app.get('*', (req, res) => {
  res.sendFile(path.join(PWA_DIR, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[HydraREMOTE] Server running on http://0.0.0.0:${PORT}`);
  console.log(`[HydraREMOTE] Serving PWA from: ${PWA_DIR}`);
});
