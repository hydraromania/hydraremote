# Ghid de Instalare și Configurare HydraREMOTE

Toate componentele au fost pregătite și rebranduite complet pe desktop: `C:\Users\Burghardt Norbert\Desktop\HydraREMOTE`.

---

## 1. Structura Fișierelor

- **`server/`**: Serverul Node.js de Rendezvous, Session Management și servire SPA PWA (port intern `4420`).
- **`pwa/`**: Interfața Web & PWA pentru telefon / browser mobil, rebranduită cu denumirea HydraREMOTE și setată să apeleze `https://remote.hydraromania.ro`.
- **`cli/`**: Pachetul CLI & Daemon local (`hydraremote`) ce rulează pe calculatorul gazdă și expune terminalul / sesiunea către PWA.
- **`templates/`**:
  - `hydraremote.tpl` & `hydraremote.stpl`: Șabloane Nginx Reverse Proxy pentru HestiaCP (cu suport complet WebSocket & SSL).
  - `hydraremote.sh`: Script post-generare HestiaCP.
  - `hydraremote.service`: Serviciul systemd pentru rulare continuă în background pe server.

---

## 2. Deploy pe Server (`vmi1000.hydraromania.ro`)

### A. Urcarea Fișierelor
Directoarele `server/`, `pwa/` și `templates/` se copiază pe server în folderul:
`/home/hydra/hydraremote/`

Comandă rapidă (din terminal sau rsync/scp):
```bash
scp -r server pwa templates hydra@vmi1000.hydraromania.ro:/home/hydra/hydraremote/
```

### B. Instalare Dependențe pe Server
Pe serverul VPS:
```bash
cd /home/hydra/hydraremote/server
npm install --omit=dev
```

### C. Activare Serviciu Systemd pe Server
```bash
sudo cp /home/hydra/hydraremote/templates/hydraremote.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hydraremote
sudo systemctl status hydraremote
```

### D. Activare Template în HestiaCP
1. Copiază șabloanele Nginx în HestiaCP:
```bash
sudo cp /home/hydra/hydraremote/templates/hydraremote.* /usr/local/hestia/data/templates/web/nginx/
```
2. În panoul HestiaCP (web UI):
   - Mergi la domeniul `remote.hydraromania.ro` (sau `router.hydraromania.ro`).
   - Apasă **Edit Domain** -> **Advanced Options**.
   - La **Web Template NGINX**, selectează: **`hydraremote`**.
   - Salvează. (Nginx va redirecționa traficul securizat HTTPS și WebSocket direct către `127.0.0.1:4420`).

---

## 3. Instalare & Utilizare CLI Local (`hydraremote`)

Pe calculatorul pe care vrei să ai acces la terminal:

1. Din folderul `cli/`:
```bash
npm install -g .
```
2. Pornire server remote:
```bash
hydraremote start
```
3. Sau meniul interactiv / afișare QR code:
```bash
hydraremote
```

4. Deschide pe telefon `https://remote.hydraromania.ro/login`, scanează codul QR sau folosește cheia afișată, și ești conectat direct la terminalul PC-ului tău.
