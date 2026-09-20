
    const API_BASE = window.location.origin;
    let activeGoogleClientId = '';

    function getAuth() {
      const googleToken = localStorage.getItem('hydra_google_token');
      const googleEmail = localStorage.getItem('hydra_google_email');
      return { googleToken, googleEmail };
    }

    async function copyCliCommand(btn, text) {
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copiat!';
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
      }).catch(err => {
        alert('Comandă: ' + text);
      });
    }

    async function initAuth() {
      try {
        const cfgRes = await fetch(`${API_BASE}/api/auth/config`);
        const cfgData = await cfgRes.json();
        activeGoogleClientId = cfgData.googleClientId || '';
      } catch (e) {}

      const { googleToken, googleEmail, apiKey } = getAuth();
      const authView = document.getElementById('auth-view');

      if (!googleToken && !apiKey) {
        authView.style.display = 'flex';
        renderGoogleButton();
      } else {
        authView.style.display = 'none';
        const display = googleEmail || (apiKey ? 'Token: ' + apiKey.substring(0, 6) + '...' : 'Autentificat');
        document.getElementById('user-display').textContent = display;
        if (googleEmail) {
          document.getElementById('user-avatar').textContent = googleEmail.charAt(0).toUpperCase();
        }
        loadDevices();
      }
    }

    function renderGoogleButton() {
      const slot = document.getElementById('google-btn-slot');
      if (!activeGoogleClientId) return;

      if (window.google && window.google.accounts) {
        try {
          google.accounts.id.initialize({
            client_id: activeGoogleClientId,
            callback: handleGoogleCallback,
            prompt_parent_id: 'google-btn-slot',
            auto_select: false
          });
          google.accounts.id.renderButton(slot, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            width: 320
          });
        } catch (err) {
          console.error('Google button error:', err);
        }
      } else {
        setTimeout(renderGoogleButton, 500);
      }
    }

    async function handleGoogleCallback(response) {
      const idToken = response.credential;
      const errBox = document.getElementById('auth-error-box');
      errBox.style.display = 'none';

      try {
        const res = await fetch(`${API_BASE}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: idToken, clientId: activeGoogleClientId })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          localStorage.setItem('hydra_google_token', idToken);
          localStorage.setItem('hydra_google_email', data.email);
          localStorage.removeItem('hydra_device_token');
          document.getElementById('auth-view').style.display = 'none';
          initAuth();
        } else {
          showError(data.error || 'Autentificare eșuată cu Google');
        }
      } catch (e) {
        showError('Eroare de rețea la validarea contului Google.');
      }
    }

    function handleTokenLogin(e) {
      e.preventDefault();
      const token = document.getElementById('tokenInput').value.trim();
      if (!token) return;

      localStorage.setItem('hydra_device_token', token);
      localStorage.removeItem('hydra_google_token');
      localStorage.removeItem('hydra_google_email');
      document.getElementById('auth-view').style.display = 'none';
      initAuth();
    }

    function openAddModal() {
      document.getElementById('claim-error').style.display = 'none';
      document.getElementById('claim-success').style.display = 'none';
      document.getElementById('claimKeyInput').value = '';
      document.getElementById('claimNameInput').value = '';
      document.getElementById('add-device-modal').style.display = 'flex';
    }

    function closeAddModal() {
      document.getElementById('add-device-modal').style.display = 'none';
    }

    async function handleClaimDevice(e) {
      e.preventDefault();
      const { googleToken } = getAuth();
      const errBox = document.getElementById('claim-error');
      const succBox = document.getElementById('claim-success');
      errBox.style.display = 'none';
      succBox.style.display = 'none';

      if (!googleToken) {
        errBox.textContent = 'Trebuie să fii autentificat cu Google pentru a asocia calculatoare la cont.';
        errBox.style.display = 'block';
        return;
      }

      const key = document.getElementById('claimKeyInput').value.trim();
      const name = document.getElementById('claimNameInput').value.trim();

      try {
        const res = await fetch(`${API_BASE}/api/devices/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: key, customName: name, googleToken })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          succBox.textContent = 'Computerul a fost asociat cu succes la contul tău!';
          succBox.style.display = 'block';
          setTimeout(() => {
            closeAddModal();
            loadDevices();
          }, 1200);
        } else {
          errBox.textContent = data.error || 'Eroare la salvarea dispozitivului.';
          errBox.style.display = 'block';
        }
      } catch (err) {
        errBox.textContent = 'Eroare de rețea la asocierea dispozitivului.';
        errBox.style.display = 'block';
      }
    }

    function showError(msg) {
      const errBox = document.getElementById('auth-error-box');
      errBox.textContent = msg;
      errBox.style.display = 'block';
    }

    function logout() {
      localStorage.removeItem('hydra_google_token');
      localStorage.removeItem('hydra_google_email');
      localStorage.removeItem('hydra_device_token');
      sessionStorage.clear();
      window.location.reload();
    }

    function openTutorial() {
      document.getElementById('tutorial-modal').style.display = 'flex';
    }

    function closeTutorial() {
      document.getElementById('tutorial-modal').style.display = 'none';
    }

    function formatTimeAgo(timestamp) {
      if (!timestamp) return 'Niciodată';
      const seconds = Math.floor((Date.now() - timestamp) / 1000);
      if (seconds < 20) return 'Chiar acum';
      if (seconds < 60) return `acum ${seconds} secunde`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `acum ${minutes} minute`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `acum ${hours} ore`;
      const days = Math.floor(hours / 24);
      return `acum ${days} zile`;
    }

    async function loadDevices() {
      const { googleToken, apiKey } = getAuth();
      if (!googleToken && !apiKey) return;

      let url = `${API_BASE}/api/devices?`;
      if (googleToken) url += `googleToken=${encodeURIComponent(googleToken)}`;
      else if (apiKey) url += `apiKey=${encodeURIComponent(apiKey)}`;

      try {
        const res = await fetch(url);
        if (res.status === 401) {
          logout();
          return;
        }
        const data = await res.json();
        renderDevices(data.devices || []);
      } catch (err) {
        console.error('Eroare la încărcarea dispozitivelor:', err);
      }
    }

    function renderDevices(devices) {
      const container = document.getElementById('devices-container');
      if (devices.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">💻</div>
            <h3>Niciun computer asociat încă</h3>
            <p style="color: var(--text-muted); margin-top: 0.6rem; max-width: 480px; margin-left: auto; margin-right: auto;">
              Poți adăuga un PC instant folosind butonul albastru de sus <b>„+ Adaugă PC cu Cheie SK”</b>.
            </p>
          </div>
        `;
        return;
      }

      container.innerHTML = devices.map(d => {
        const isOnline = d.isOnline;
        const icon = d.platform === 'win32' ? '🪟' : (d.platform === 'darwin' ? '🍎' : '🐧');
        const connectUrl = `/login?autoConnect=1&session=${encodeURIComponent(d.sessionId)}&key=${encodeURIComponent(d.apiKey)}`;

        return `
          <div class="device-card">
            <div>
              <div class="device-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div class="device-icon">${icon}</div>
                  <div class="status-badge ${isOnline ? 'online' : 'offline'}">
                    ${isOnline ? 'Online' : 'Offline'}
                  </div>
                </div>
                <div class="device-actions-top">
                  <button class="btn-icon-sm" onclick="promptRename('${d.apiKey || d.id}', '${d.name.replace(/'/g, "\\'")}')" title="Redenumește PC">
                    ✏️ Modifică
                  </button>
                  <button class="btn-icon-sm delete" onclick="confirmDelete('${d.apiKey || d.id}', '${d.name.replace(/'/g, "\\'")}')" title="Șterge PC">
                    🗑️
                  </button>
                </div>
              </div>
              <div class="device-name">${d.name}</div>
              <div class="device-meta">
                <div><span>Sistem:</span> <strong>${d.platform || 'Necunoscut'}</strong></div>
                <div><span>Local IP:</span> <code>${d.localIp || '-'}</code></div>
                <div><span>IP Internet:</span> <code>${d.publicIp || '...'}</code></div>
                <div><span>Ultima activitate:</span> <strong>${formatTimeAgo(d.lastSeen)}</strong></div>
                <div><span>Cheie:</span> <code>${d.apiKey ? d.apiKey.substring(0, 8) + '...' : '-'}</code></div>
              </div>
            </div>

            <div>
              ${isOnline ? `
                <button onclick="secureConnect('${d.sessionId}', '${d.apiKey}', '${d.name}')" class="connect-btn" style="cursor: pointer;">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                  Conectare Securizată
                </button>
              ` : `
                <button class="connect-btn disabled" disabled>
                  Computer Offline
                </button>
              `}
            </div>
          </div>
        `;
      }).join('');
    }

    // Inițializare & Polling
    initAuth();
    setInterval(loadDevices, 4000);
  
    let activePollTimer = null;

    async function secureConnect(sessionId, apiKey, devName) {
      const { googleToken } = getAuth();
      const modal = document.getElementById('consent-modal');
      const title = document.getElementById('consent-title');
      const msg = document.getElementById('consent-msg');

      try {
        const res = await fetch(`${API_BASE}/api/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, googleToken })
        });

        const data = await res.json();

        if (res.status === 429) {
          alert('🔒 Protecție Anti-Brute-Force: ' + data.error);
          return;
        }

        if (!data.success && data.error) {
          alert('Eroare conectare: ' + data.error);
          return;
        }

        if (data.status === 'approved') {
          // Utilizatorul este Owner sau Whitelisted -> Acces Direct
          const finalKey = data.apiKey || apiKey;
          window.location.href = `/login?k=${encodeURIComponent(finalKey)}`;
          return;
        }

        if (data.status === 'pending_approval') {
          // Afișăm modalul AnyDesk / Google Remote Desktop
          title.textContent = `Aprobare Cerută: ${devName}`;
          msg.innerHTML = `Notificare trimisă pe ecranul <b>${devName}</b>.<br><br>Se așteaptă aprobarea utilizatorului local...`;
          modal.style.display = 'flex';

          const reqId = data.requestId;
          if (activePollTimer) clearInterval(activePollTimer);

          activePollTimer = setInterval(async () => {
            try {
              const pollRes = await fetch(`${API_BASE}/api/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey, googleToken, requestId: reqId })
              });
              const pollData = await pollRes.json();

              if (pollData.status === 'approved') {
                clearInterval(activePollTimer);
                modal.style.display = 'none';
                const finalKey = pollData.apiKey || apiKey;
                window.location.href = `/login?k=${encodeURIComponent(finalKey)}`;
              } else if (pollRes.status === 403 || pollData.status === 'rejected') {
                clearInterval(activePollTimer);
                modal.style.display = 'none';
                alert('❌ Conexiunea a fost REFUZATĂ de utilizatorul de la PC.');
              }
            } catch (e) {}
          }, 2000);
        }
      } catch (err) {
        alert('Eroare de rețea la inițierea conexiunii');
      }
    }

    function cancelConnectRequest() {
      if (activePollTimer) clearInterval(activePollTimer);
      document.getElementById('consent-modal').style.display = 'none';
    }


    async function promptRename(targetId, currentName) {
      const newName = prompt('Introdu noul nume pentru acest calculator:', currentName);
      if (!newName || !newName.trim() || newName.trim() === currentName) return;

      const { googleToken } = getAuth();
      try {
        const res = await fetch(`${API_BASE}/api/devices/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: targetId, apiKey: targetId, googleToken, newName: newName.trim() })
        });
        const data = await res.json();
        if (data.success) {
          loadDevices();
        } else {
          alert('Eroare redenumire: ' + (data.error || 'Necunoscută'));
        }
      } catch (err) {
        alert('Eroare de rețea');
      }
    }

    async function confirmDelete(targetId, name) {
      if (!confirm(`Sigur dorești să ștergi calculatorul "${name}" din lista contului tău?`)) {
        return;
      }

      const { googleToken } = getAuth();
      try {
        const res = await fetch(`${API_BASE}/api/devices/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: targetId, apiKey: targetId, googleToken })
        });
        const data = await res.json();
        if (data.success) {
          loadDevices();
        } else {
          alert('Eroare ștergere: ' + (data.error || 'Necunoscută'));
        }
      } catch (err) {
        alert('Eroare de rețea');
      }
    }

