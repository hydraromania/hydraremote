const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4420;
const PWA_DIR = path.join(__dirname, '..', 'pwa');
const DATA_FILE = path.join(__dirname, 'devices_db.json');
const CONFIG_FILE = path.join(__dirname, 'oauth_config.json');

// Client ID Google configurabil
let GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (cfg.googleClientId) GOOGLE_CLIENT_ID = cfg.googleClientId;
  }
} catch (e) {}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

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
  console.error('[HydraREMOTE] Eroare la citirea bazei de date:', e.message);
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

// Endpoint verificare token Google (OAuth ID Token)
app.post('/api/auth/google', async (req, res) => {
  const { credential, clientId } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Missing credential token' });
  }

  try {
    const activeClientId = clientId || GOOGLE_CLIENT_ID;
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: activeClientId || undefined
    });
    const payload = ticket.getPayload();
    const email = payload.email.toLowerCase();

    // Dacă a fost trimis un Client ID valid și nu îl aveam salvat
    if (clientId && clientId !== GOOGLE_CLIENT_ID) {
      GOOGLE_CLIENT_ID = clientId;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ googleClientId: clientId }, null, 2));
    }

    res.json({
      success: true,
      email,
      name: payload.name,
      picture: payload.picture
    });
  } catch (err) {
    console.error('[OAuth] Token validation failed:', err.message);
    res.status(401).json({ error: 'Invalid Google token: ' + err.message });
  }
});

// Endpoint pentru setare / citire Google Client ID
app.get('/api/auth/config', (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID || ''
  });
});

app.post('/api/auth/config', (req, res) => {
  const { googleClientId } = req.body;
  if (googleClientId) {
    GOOGLE_CLIENT_ID = googleClientId.trim();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID }, null, 2));
    return res.json({ success: true, googleClientId: GOOGLE_CLIENT_ID });
  }
  res.status(400).json({ error: 'Missing googleClientId' });
});

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

// Endpoint Monitorizare Dispozitive (strict verificat pe Google Auth token sau cheie permanenta criptata)

// Asociaza un PC dupa cheia sa secreta (sk-...) direct la contul utilizatorului autentificat
app.post('/api/devices/claim', async (req, res) => {
  const { apiKey, googleToken, customName } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing apiKey' });
  }

  let userEmail = null;
  if (googleToken) {
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: googleToken,
        audience: GOOGLE_CLIENT_ID || undefined
      });
      userEmail = ticket.getPayload().email.toLowerCase();
    } catch (err) {
      return res.status(401).json({ error: 'Token Google invalid sau expirat' });
    }
  }

  if (!userEmail) {
    return res.status(401).json({ error: 'Trebuie sa fii autentificat cu Google pentru a adauga un PC' });
  }

  const cleanKey = apiKey.trim();
  const now = Date.now();
  
  // Cautam daca dispozitivul exista deja in baza de date
  let dev = savedDevices.get(cleanKey);
  if (!dev) {
    for (const [id, item] of savedDevices.entries()) {
      if (item.apiKey === cleanKey) {
        dev = item;
        break;
      }
    }
  }

  if (dev) {
    dev.userEmail = userEmail;
    if (customName && customName.trim()) dev.name = customName.trim();
    savedDevices.set(dev.id, dev);
  } else {
    // Creem inregistrarea PC-ului chiar daca nu a trimis inca heartbeat
    const devId = cleanKey;
    dev = {
      id: devId,
      sessionId: crypto.randomUUID(),
      apiKey: cleanKey,
      userEmail: userEmail,
      name: (customName && customName.trim()) || 'PC Adaugat Manual',
      platform: 'unknown',
      tunnelUrl: '',
      localIp: '',
      lastSeen: 0,
      createdAt: now
    };
    savedDevices.set(devId, dev);
  }

  persistDevices();
  console.log();
  res.json({ success: true, device: dev });
});

app.get('/api/devices', async (req, res) => {
  const { apiKey, googleToken } = req.query;
  const now = Date.now();
  const ONLINE_THRESHOLD_MS = 45 * 1000;

  let authenticatedEmail = null;

  // Verificare token Google criptografic
  if (googleToken) {
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: googleToken,
        audience: GOOGLE_CLIENT_ID || undefined
      });
      authenticatedEmail = ticket.getPayload().email.toLowerCase();
    } catch (e) {
      return res.status(401).json({ error: 'Token Google invalid sau expirat. Te rugam sa te reautentifici.' });
    }
  }

  // Fără token Google valid și fără apiKey valid -> Acces interzis
  if (!authenticatedEmail && !apiKey) {
    return res.status(401).json({ error: 'Neautorizat. Autentifica-te cu Google sau furnizeaza token-ul dispozitivului.' });
  }

  let list = Array.from(savedDevices.values());

  if (authenticatedEmail) {
    list = list.filter(d => d.userEmail && d.userEmail === authenticatedEmail);
  } else if (apiKey) {
    list = list.filter(d => d.apiKey === apiKey);
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
