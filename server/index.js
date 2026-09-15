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

// ==========================================
// 1. SISTEM PROTECȚIE BRUTE-FORCE & RATE LIMIT
// ==========================================
const failedAttempts = new Map(); // ip -> { count, blockedUntil }
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minute blocat

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function antiBruteForce(req, res, next) {
  const ip = getClientIp(req);
  const record = failedAttempts.get(ip);
  const now = Date.now();

  if (record && record.blockedUntil && record.blockedUntil > now) {
    const remainingSec = Math.ceil((record.blockedUntil - now) / 1000);
    return res.status(429).json({
      error: `IP blocat temporar din cauza tentativelor repetate eșuate. Reîncearcă în ${remainingSec} secunde.`
    });
  }
  next();
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
    console.warn(`[SECURITY ALERT] IP ${ip} a fost BLOCAT pentru 15 minute (brute-force detectat)`);
  }
  failedAttempts.set(ip, record);
}

function resetFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

// ==========================================
// 2. BAZE DE DATE & STĂRI ÎN MEMORIE
// ==========================================
const sessions = new Map();
const tempKeys = new Map();
const connectionRequests = new Map(); // requestId -> { devId, requesterEmail, status, createdAt, expiresAt }
let savedDevices = new Map();

// Încărcare dispozitive
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const item of raw) {
      if (!Array.isArray(item.allowedEmails)) {
        item.allowedEmails = item.userEmail ? [item.userEmail] : [];
      }
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

// Curățare chei & cereri expirate
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of tempKeys.entries()) {
    if (data.expiresAt && data.expiresAt < now) tempKeys.delete(key);
  }
  for (const [id, req] of connectionRequests.entries()) {
    if (req.expiresAt && req.expiresAt < now) connectionRequests.delete(id);
  }
}, 30000);

// ==========================================
// 3. AUTENTIFICARE GOOGLE OAUTH
// ==========================================
async function verifyGoogleToken(token) {
  if (!token) return null;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID || undefined
    });
    return ticket.getPayload();
  } catch (e) {
    return null;
  }
}

app.post('/api/auth/google', antiBruteForce, async (req, res) => {
  const { credential, clientId } = req.body;
  const ip = getClientIp(req);

  if (!credential) {
    recordFailedAttempt(ip);
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

    if (clientId && clientId !== GOOGLE_CLIENT_ID) {
      GOOGLE_CLIENT_ID = clientId;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ googleClientId: clientId }, null, 2));
    }

    resetFailedAttempts(ip);
    res.json({
      success: true,
      email,
      name: payload.name,
      picture: payload.picture
    });
  } catch (err) {
    recordFailedAttempt(ip);
    res.status(401).json({ error: 'Invalid Google token: ' + err.message });
  }
});

app.get('/api/auth/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || '' });
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

// ==========================================
// 4. SESIUNI & HEARTBEAT DE LA TERMINALE
// ==========================================
app.post('/api/session/create', (req, res) => {
  const { machineId, apiKey, hostname, platform, userEmail } = req.body;
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  const devId = apiKey || sessionId;
  const existing = savedDevices.get(devId) || {};

  const effectiveEmail = userEmail ? userEmail.trim().toLowerCase() : (existing.userEmail || null);
  const effectiveName = existing.name || hostname || machineId || 'Computer Necunoscut';
  const effectiveAllowed = existing.allowedEmails || (effectiveEmail ? [effectiveEmail] : []);

  sessions.set(sessionId, {
    sessionId,
    machineId,
    apiKey,
    userEmail: effectiveEmail,
    createdAt: now,
    updatedAt: now
  });

  savedDevices.set(devId, {
    id: devId,
    sessionId,
    apiKey,
    userEmail: effectiveEmail,
    allowedEmails: effectiveAllowed,
    name: effectiveName,
    platform: platform || existing.platform || process.platform,
    tunnelUrl: existing.tunnelUrl || '',
    localIp: existing.localIp || '',
    lastSeen: now,
    createdAt: existing.createdAt || now
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

  const devId = apiKey || targetSessionId;
  const existing = savedDevices.get(devId) || {};
  const effectiveEmail = cleanEmail || existing.userEmail || null;
  const effectiveAllowed = existing.allowedEmails || (effectiveEmail ? [effectiveEmail] : []);

  savedDevices.set(devId, {
    id: devId,
    sessionId: targetSessionId,
    apiKey: apiKey || existing.apiKey || '',
    userEmail: effectiveEmail,
    allowedEmails: effectiveAllowed,
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

// ==========================================
// 5. GESTIUNE CONEXIUNE & APROBARE ACCES
// ==========================================

// Endpoint pentru cerere de conectare cu verificare de autorizare
app.post('/api/connect', antiBruteForce, async (req, res) => {
  const { apiKey, token, googleToken, requestId } = req.body;
  const key = apiKey || token;
  const ip = getClientIp(req);

  if (!key) {
    recordFailedAttempt(ip);
    return res.status(400).json({ success: false, error: 'Cheia sau tokenul este obligatoriu' });
  }

  // Caută dispozitivul
  let targetDev = null;
  for (const [devId, dev] of savedDevices.entries()) {
    if (dev.apiKey === key || devId === key || dev.id === key) {
      targetDev = dev;
      break;
    }
  }

  if (!targetDev) {
    recordFailedAttempt(ip);
    return res.status(404).json({ success: false, error: 'Dispozitivul nu a fost găsit sau cheia este incorectă' });
  }

  // Verificare email autentificat
  let requesterEmail = null;
  if (googleToken) {
    const payload = await verifyGoogleToken(googleToken);
    if (payload) requesterEmail = payload.email.toLowerCase();
  }

  // Verificăm dacă emailul este aprobat direct (Owner sau Whitelist)
  const isOwner = targetDev.userEmail && requesterEmail && targetDev.userEmail === requesterEmail;
  const isAllowed = targetDev.allowedEmails && requesterEmail && targetDev.allowedEmails.includes(requesterEmail);

  if (isOwner || isAllowed) {
    resetFailedAttempts(ip);
    return res.json({
      success: true,
      status: 'approved',
      apiKey: targetDev.apiKey || key,
      tunnelUrl: targetDev.tunnelUrl || '',
      localIp: targetDev.localIp || '',
      name: targetDev.name || 'Terminal PC'
    });
  }

  // Dacă există deja o cerere de aprobare
  if (requestId && connectionRequests.has(requestId)) {
    const connReq = connectionRequests.get(requestId);
    if (connReq.status === 'approved') {
      resetFailedAttempts(ip);
      return res.json({
        success: true,
        status: 'approved',
        apiKey: targetDev.apiKey || key,
        tunnelUrl: targetDev.tunnelUrl || '',
        localIp: targetDev.localIp || '',
        name: targetDev.name || 'Terminal PC'
      });
    } else if (connReq.status === 'rejected') {
      return res.status(403).json({ success: false, status: 'rejected', error: 'Conexiunea a fost refuzată de către utilizatorul de pe PC.' });
    } else {
      return res.json({ success: true, status: 'pending', requestId, message: 'Se așteaptă aprobarea de pe ecranul PC-ului...' });
    }
  }

  // Dacă nu este în whitelist, generăm cerere de aprobare pe PC
  const newReqId = 'req_' + crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  connectionRequests.set(newReqId, {
    requestId: newReqId,
    devId: targetDev.id,
    apiKey: targetDev.apiKey,
    requesterEmail: requesterEmail || 'Utilizator Anonim/Extern',
    ip,
    status: 'pending',
    createdAt: now,
    expiresAt: now + 45 * 1000 // 45 secunde timeout
  });

  return res.json({
    success: true,
    status: 'pending_approval',
    requestId: newReqId,
    message: `Adresa ${requesterEmail || 'ta'} necesită aprobarea utilizatorului de pe PC. Notificare trimisă...`
  });
});

// PC-ul gazdă interoghează cererile în așteptare
app.get('/api/session/pending-requests', (req, res) => {
  const { apiKey } = req.query;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });

  const now = Date.now();
  const pending = [];
  for (const [id, item] of connectionRequests.entries()) {
    if (item.apiKey === apiKey && item.status === 'pending' && item.expiresAt > now) {
      pending.push(item);
    }
  }

  res.json({ success: true, requests: pending });
});

// Răspunsul utilizatorului de la PC (Acceptă / Refuză)
app.post('/api/session/respond-request', (req, res) => {
  const { requestId, apiKey, action } = req.body; // action: 'approve' | 'reject'
  if (!requestId || !connectionRequests.has(requestId)) {
    return res.status(404).json({ error: 'Cererea nu a fost găsită sau a expirat' });
  }

  const reqItem = connectionRequests.get(requestId);
  if (reqItem.apiKey !== apiKey) {
    return res.status(403).json({ error: 'Cheie neautorizată' });
  }

  if (action === 'approve') {
    reqItem.status = 'approved';
    // Adaugă automat emailul în whitelist dacă a fost aprobat
    const dev = savedDevices.get(reqItem.devId);
    if (dev && reqItem.requesterEmail && reqItem.requesterEmail.includes('@')) {
      if (!Array.isArray(dev.allowedEmails)) dev.allowedEmails = [];
      if (!dev.allowedEmails.includes(reqItem.requesterEmail)) {
        dev.allowedEmails.push(reqItem.requesterEmail);
        savedDevices.set(dev.id, dev);
        persistDevices();
      }
    }
  } else {
    reqItem.status = 'rejected';
  }

  connectionRequests.set(requestId, reqItem);
  res.json({ success: true, status: reqItem.status });
});

// ==========================================
// 6. GESTIUNE DISPOZITIVE & WHITELIST
// ==========================================

// Modifică lista de emailuri autorizate
app.post('/api/devices/whitelist', antiBruteForce, async (req, res) => {
  const { apiKey, googleToken, allowedEmails } = req.body;
  const ip = getClientIp(req);

  if (!apiKey || !googleToken) {
    recordFailedAttempt(ip);
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const payload = await verifyGoogleToken(googleToken);
  if (!payload) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Autentificare Google invalidă' });
  }

  const userEmail = payload.email.toLowerCase();
  const dev = savedDevices.get(apiKey);

  if (!dev) {
    return res.status(404).json({ error: 'Dispozitivul nu a fost găsit' });
  }

  if (dev.userEmail && dev.userEmail !== userEmail) {
    return res.status(403).json({ error: 'Doar proprietarul dispozitivului poate modifica permisiunile de acces.' });
  }

  if (Array.isArray(allowedEmails)) {
    dev.allowedEmails = allowedEmails.map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
    if (dev.userEmail && !dev.allowedEmails.includes(dev.userEmail)) {
      dev.allowedEmails.unshift(dev.userEmail);
    }
    savedDevices.set(dev.id, dev);
    persistDevices();
  }

  res.json({ success: true, allowedEmails: dev.allowedEmails });
});

// Redenumește un dispozitiv existent
app.post('/api/devices/rename', antiBruteForce, async (req, res) => {
  const { apiKey, id, googleToken, newName } = req.body;
  const targetId = apiKey || id;

  if (!targetId || !googleToken || !newName || !newName.trim()) {
    return res.status(400).json({ error: 'Parametri incompleti' });
  }

  const payload = await verifyGoogleToken(googleToken);
  if (!payload) {
    return res.status(401).json({ error: 'Token Google invalid sau expirat' });
  }

  const userEmail = payload.email.toLowerCase();
  let dev = savedDevices.get(targetId);
  if (!dev) {
    for (const [k, d] of savedDevices.entries()) {
      if (d.apiKey === targetId || d.sessionId === targetId || d.id === targetId) {
        dev = d;
        break;
      }
    }
  }

  if (!dev) {
    return res.status(404).json({ error: 'Dispozitivul nu a fost gasit' });
  }

  if (dev.userEmail && dev.userEmail !== userEmail) {
    return res.status(403).json({ error: 'Doar proprietarul poate redenumi acest PC' });
  }

  dev.name = newName.trim();
  savedDevices.set(dev.id, dev);
  persistDevices();

  res.json({ success: true, name: dev.name });
});

// Șterge un dispozitiv din lista salvată
app.post('/api/devices/delete', antiBruteForce, async (req, res) => {
  const { apiKey, id, googleToken } = req.body;
  const targetId = apiKey || id;

  if (!targetId || !googleToken) {
    return res.status(400).json({ error: 'Parametri incompleti' });
  }

  const payload = await verifyGoogleToken(googleToken);
  if (!payload) {
    return res.status(401).json({ error: 'Token Google invalid sau expirat' });
  }

  const userEmail = payload.email.toLowerCase();
  let foundKey = null;
  let dev = savedDevices.get(targetId);

  if (dev) {
    foundKey = targetId;
  } else {
    for (const [k, d] of savedDevices.entries()) {
      if (d.apiKey === targetId || d.sessionId === targetId || d.id === targetId) {
        dev = d;
        foundKey = k;
        break;
      }
    }
  }

  if (!dev) {
    return res.status(404).json({ error: 'Dispozitivul nu a fost gasit' });
  }

  if (dev.userEmail && dev.userEmail !== userEmail) {
    return res.status(403).json({ error: 'Doar proprietarul poate sterge acest PC' });
  }

  if (foundKey) savedDevices.delete(foundKey);
  savedDevices.delete(dev.id);
  if (dev.apiKey) savedDevices.delete(dev.apiKey);
  persistDevices();

  res.json({ success: true });
});

// Asociază PC la cont Google
app.post('/api/devices/claim', antiBruteForce, async (req, res) => {
  const { apiKey, googleToken, customName } = req.body;
  const ip = getClientIp(req);

  if (!apiKey) {
    recordFailedAttempt(ip);
    return res.status(400).json({ error: 'Missing apiKey' });
  }

  const payload = await verifyGoogleToken(googleToken);
  if (!payload) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Trebuie sa fii autentificat cu Google pentru a adauga un PC' });
  }

  const userEmail = payload.email.toLowerCase();
  const cleanKey = apiKey.trim();
  const now = Date.now();

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
    if (!Array.isArray(dev.allowedEmails)) dev.allowedEmails = [userEmail];
    else if (!dev.allowedEmails.includes(userEmail)) dev.allowedEmails.push(userEmail);
    if (customName && customName.trim()) dev.name = customName.trim();
    savedDevices.set(dev.id, dev);
  } else {
    const devId = cleanKey;
    dev = {
      id: devId,
      sessionId: crypto.randomUUID(),
      apiKey: cleanKey,
      userEmail: userEmail,
      allowedEmails: [userEmail],
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
  res.json({ success: true, device: dev });
});

app.get('/api/devices', async (req, res) => {
  const { apiKey, googleToken } = req.query;
  const now = Date.now();
  const ONLINE_THRESHOLD_MS = 300 * 1000;

  let authenticatedEmail = null;
  if (googleToken) {
    const payload = await verifyGoogleToken(googleToken);
    if (payload) authenticatedEmail = payload.email.toLowerCase();
  }

  // Acces exclusiv prin Google OAuth token verificat criptografic
  if (!authenticatedEmail) {
    return res.status(401).json({ error: 'Acces interzis. Conectarea se realizeaza exclusiv prin cont Google autorizat.' });
  }

  let list = Array.from(savedDevices.values());

  if (authenticatedEmail) {
    // Afișează dispozitivele deținute SAU unde emailul este în whitelist
    list = list.filter(d => 
      (d.userEmail && d.userEmail === authenticatedEmail) ||
      (Array.isArray(d.allowedEmails) && d.allowedEmails.includes(authenticatedEmail))
    );
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
    allowedEmails: d.allowedEmails || (d.userEmail ? [d.userEmail] : []),
    isOnline: (now - d.lastSeen) < ONLINE_THRESHOLD_MS,
    apiKey: d.apiKey
  }));

  res.json({ success: true, devices: result });
});

// ==========================================
// 7. TEMP KEYS (QR SCAN)
// ==========================================
app.post('/api/temp-key/create', (req, res) => {
  const { apiKey, tunnelUrl, localIp } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });

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
  if (tempKey) tempKeys.delete(tempKey);
  res.json({ success: true });
});

app.get('/api/webrtc/turn-credentials', (req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'HydraREMOTE Server', time: new Date().toISOString() });
});

// Rădăcina / servește direct managerul de dispozitive (devices.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(PWA_DIR, 'devices.html'));
});

// Alias /devices către rădăcină
app.get('/devices', (req, res) => {
  res.redirect('/');
});

// Pagina de conectare terminal (Next.js PWA)
app.get('/login', (req, res) => {
  res.sendFile(path.join(PWA_DIR, 'index.html'));
});

// Servire fișiere statice PWA (css, js, assets)
app.use(express.static(PWA_DIR));

// Fallback către managerul de dispozitive
app.get('*', (req, res) => {
  res.sendFile(path.join(PWA_DIR, 'devices.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[HydraREMOTE] Server running on http://0.0.0.0:${PORT}`);
  console.log(`[HydraREMOTE] Serving PWA from: ${PWA_DIR}`);
});
