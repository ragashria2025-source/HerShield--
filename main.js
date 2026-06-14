// HerShield Proto main.js — frontend connected to Render backend

// ✅ Backend link (Render)
const API_BASE = "https://hershield-ai-3157.onrender.com/api";

// frontend/main.js
// Full shared client logic for HerShield prototype (updated: Socket.IO, admin helpers, accessibility)
window.HS_API = 'http://localhost:4000';

// Load Socket.IO client dynamically (if available)
function loadSocketIoClient(callback) {
  if (window.io) return callback();
  const s = document.createElement('script');
  s.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
  s.onload = () => callback();
  s.onerror = () => console.warn('Socket.IO client failed to load');
  document.head.appendChild(s);
}

/* -------------------------
   Dynamic animated background
   ------------------------- */
function startDynamicBackground() {
  try {
    const body = document.body;
    let t = 0;
    function frame() {
      t += 0.003;
      const g1 = 20 + Math.sin(t * 0.7) * 6;
      const g2 = 80 + Math.cos(t * 0.6) * 8;
      body.style.background = `linear-gradient(120deg, rgba(43,11,74,0.95) 0%, rgba(123,44,191,0.95) 100%), radial-gradient(circle at ${g1}% 20%, rgba(255,111,181,0.06), transparent 8%), radial-gradient(circle at ${g2}% 80%, rgba(109,211,255,0.04), transparent 12%)`;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (e) {
    console.warn('Background animation failed', e);
  }
}

/* -------------------------
   Clock helper
   ------------------------- */
function startClock(elId) {
  function tick() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (elId) {
      const el = document.getElementById(elId);
      if (el) el.textContent = `${hh}:${mm}`;
    }
  }
  tick();
  setInterval(tick, 1000);
}

/* -------------------------
   Geolocation helper
   ------------------------- */
function getCurrentPosition(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No geolocation'));
    const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      err => { clearTimeout(timer); reject(err); },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  });
}

/* -------------------------
   Capture short media (video + audio)
   ------------------------- */
async function captureShortMedia(videoMs = 5000, audioMs = 3000) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const vRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
    const vChunks = [];
    vRecorder.ondataavailable = e => { if (e.data && e.data.size) vChunks.push(e.data); };
    vRecorder.start();
    await new Promise(r => setTimeout(r, videoMs));
    vRecorder.stop();
    await new Promise(r => vRecorder.onstop = r);
    const videoBlob = new Blob(vChunks, { type: 'video/webm' });

    const audioStream = new MediaStream(stream.getAudioTracks());
    const aRecorder = new MediaRecorder(audioStream);
    const aChunks = [];
    aRecorder.ondataavailable = e => { if (e.data && e.data.size) aChunks.push(e.data); };
    aRecorder.start();
    await new Promise(r => setTimeout(r, audioMs));
    aRecorder.stop();
    await new Promise(r => aRecorder.onstop = r);
    const audioBlob = new Blob(aChunks, { type: 'audio/webm' });

    stream.getTracks().forEach(t => t.stop());
    return { videoBlob, audioBlob, videoUrl: URL.createObjectURL(videoBlob), audioUrl: URL.createObjectURL(audioBlob) };
  } catch (err) {
    console.warn('capture failed', err);
    return null;
  }
}

/* -------------------------
   Toast helper
   ------------------------- */
function toast(msg, t = 2200) {
  try {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      background: '#111',
      color: '#fff',
      padding: '8px 12px',
      borderRadius: '8px',
      zIndex: 9999,
      boxShadow: '0 8px 20px rgba(0,0,0,0.2)'
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), t);
  } catch (e) { /* ignore */ }
}

/* -------------------------
   Offline queue helpers
   ------------------------- */
function enqueueOffline(action) {
  const key = 'hs_offline_queue_v1';
  const q = JSON.parse(localStorage.getItem(key) || '[]');
  q.push(action);
  localStorage.setItem(key, JSON.stringify(q));
}
async function flushOffline() {
  const key = 'hs_offline_queue_v1';
  const q = JSON.parse(localStorage.getItem(key) || '[]');
  if (!q.length) return;
  try {
    await fetch(window.HS_API + '/api/sync-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actions: q }) });
    localStorage.removeItem(key);
    toast('Offline actions synced');
  } catch (err) {
    console.warn('sync failed', err);
  }
}
window.addEventListener('online', flushOffline);

/* -------------------------
   Refresh counts (volunteers, shops, drivers)
   ------------------------- */
async function refreshCounts() {
  try {
    const vols = await fetch(window.HS_API + '/api/volunteers').then(r => r.json()).catch(() => []);
    const shops = await fetch(window.HS_API + '/api/shops').then(r => r.json()).catch(() => []);
    const drivers = await fetch(window.HS_API + '/api/drivers').then(r => r.json()).catch(() => []);
    const volEl = document.getElementById('volCount');
    const shopEl = document.getElementById('shopCount');
    const driverEl = document.getElementById('driverCount');
    if (volEl) volEl.textContent = (Array.isArray(vols) ? vols.length : 0);
    if (shopEl) shopEl.textContent = (Array.isArray(shops) ? shops.length : 0);
    if (driverEl) driverEl.textContent = (Array.isArray(drivers) ? drivers.length : 0);
  } catch (err) { console.warn(err); }
}
window.refreshCounts = refreshCounts;

/* -------------------------
   Show nearby (geocode + nearby endpoints)
   ------------------------- */
async function showNearby() {
  const input = document.getElementById('searchLocation');
  if (!input) return alert('Search input not found');
  const q = input.value.trim();
  if (!q) return alert('Enter a location or use current location');
  let latlng = null;
  if (q.includes(',')) {
    const parts = q.split(',').map(s => s.trim());
    latlng = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
  } else {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q));
    const j = await res.json();
    if (!j || !j.length) return alert('Location not found');
    latlng = { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
  }
  const vols = await fetch(window.HS_API + `/api/nearby/volunteers?lat=${latlng.lat}&lng=${latlng.lng}`).then(r => r.json()).catch(() => []);
  const shops = await fetch(window.HS_API + `/api/nearby/shops?lat=${latlng.lat}&lng=${latlng.lng}`).then(r => r.json()).catch(() => []);
  const drivers = await fetch(window.HS_API + `/api/nearby/drivers?lat=${latlng.lat}&lng=${latlng.lng}`).then(r => r.json()).catch(() => []);
  const el = document.getElementById('nearbyResults');
  if (!el) return;
  el.innerHTML = `
    <h4>Volunteers (${vols.length})</h4>
    ${vols.map(v => `<div class="mini"><strong>${v.name}</strong> • ${Array.isArray(v.skills) ? v.skills.join(', ') : ''} • ${v.contact || ''} <button onclick="location.href='volunteers.html'">View</button></div>`).join('') || '<div class="muted">None</div>'}
    <h4>Verified Shops (${shops.length})</h4>
    ${shops.map(s => `<div class="mini"><strong>${s.name}</strong> • ${s.address || ''} <button onclick="location.href='shops.html'">View</button></div>`).join('') || '<div class="muted">None</div>'}
    <h4>Recommended Drivers (${drivers.length})</h4>
    ${drivers.map(d => `<div class="mini"><strong>${d.name}</strong> • ${d.rating || '—'}★ • ${d.platform || '—'} <button onclick="location.href='drivers.html'">View</button></div>`).join('') || '<div class="muted">None</div>'}
  `;
}

/* -------------------------
   Modal / profile helpers
   ------------------------- */
function openModal(html) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}<div style="text-align:right;margin-top:12px"><button id="closeModal" class="btn">Close</button></div></div>`;
  document.body.appendChild(backdrop);
  const closeBtn = document.getElementById('closeModal');
  if (closeBtn) {
    closeBtn.focus();
    closeBtn.addEventListener('click', () => backdrop.remove());
  }
}
async function showVolunteerProfile(id) {
  const v = await fetch(window.HS_API + '/api/volunteers/' + id).then(r => r.json()).catch(() => null);
  if (!v) return alert('Volunteer not found');
  const html = `<h3>${v.name} ${v.verified ? '✅' : ''}</h3>
    <div class="mini"><strong>Age:</strong> ${v.age || '—'}</div>
    <div class="mini"><strong>DOB:</strong> ${v.dob || '—'}</div>
    <div class="mini"><strong>Contact:</strong> ${v.contact || '—'}</div>
    <div class="mini"><strong>Address:</strong> ${v.address || '—'}</div>
    <div class="mini"><strong>Skills:</strong> ${Array.isArray(v.skills) ? v.skills.join(', ') : (v.skills || '—')}</div>
    <div class="mini"><strong>Availability:</strong> ${v.availability || '—'}</div>`;
  openModal(html);
}
async function showShopProfile(id) {
  const s = await fetch(window.HS_API + '/api/shops/' + id).then(r => r.json()).catch(() => null);
  if (!s) return alert('Shop not found');
  const html = `<h3>${s.name} ${s.verified ? '✅' : ''}</h3>
    <div class="mini"><strong>Address:</strong> ${s.address || '—'}</div>
    <div class="mini"><strong>Contact:</strong> ${s.contact || '—'}</div>
    <div class="mini"><strong>Hours:</strong> ${s.hours || '—'}</div>
    <div class="mini"><strong>Notes:</strong> ${s.notes || '—'}</div>`;
  openModal(html);
}
async function showHomeProfile(id) {
  const h = await fetch(window.HS_API + '/api/homes/' + id).then(r => r.json()).catch(() => null);
  if (!h) return alert('Home not found');
  const html = `<h3>${h.name} ${h.verified ? '✅' : ''}</h3>
    <div class="mini"><strong>Address:</strong> ${h.address || '—'}</div>
    <div class="mini"><strong>Contact:</strong> ${h.contact || '—'}</div>
    <div class="mini"><strong>Notes:</strong> ${h.notes || '—'}</div>`;
  openModal(html);
}
async function showDriverProfile(id) {
  const d = await fetch(window.HS_API + '/api/drivers/' + id).then(r => r.json()).catch(() => null);
  if (!d) return alert('Driver not found');
  const html = `<h3>${d.name}</h3>
    <div class="mini"><strong>Platform:</strong> ${d.platform || '—'}</div>
    <div class="mini"><strong>Rating:</strong> ${d.rating || '—'} ★</div>
    <div class="mini"><strong>Feedbacks:</strong> ${d.feedbackCount || 0}</div>`;
  openModal(html);
}

/* -------------------------
   Booking & feedback helpers
   ------------------------- */
async function bookDriver(driverId) {
  try {
    const res = await fetch(window.HS_API + '/api/book-driver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driverId }) }).then(r => r.json()).catch(() => ({ ok: false }));
    if (res.ok) {
      alert('Driver booked (mock). You will be prompted for feedback after the ride.');
      localStorage.setItem('lastBooking', JSON.stringify({ driverId, bookedAt: new Date().toISOString() }));
      setTimeout(() => askFeedback(driverId), 5000);
    } else {
      alert('Booking failed');
    }
  } catch (err) {
    console.warn(err);
    alert('Booking failed');
  }
}
function askFeedback(driverId) {
  if (!confirm('Did you complete the ride? Leave feedback now?')) return;
  const rating = prompt('Rate driver 1-5 stars');
  const comment = prompt('Any feedback for other women riders?');
  fetch(window.HS_API + '/api/driver-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driverId, rating: parseInt(rating, 10) || 5, comment }) });
  alert('Thanks for your feedback');
}

/* -------------------------
   SOS helpers (used by sos.html)
   ------------------------- */
async function sendSosFlow() {
  try {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Preparing SOS...';
    const loc = await getCurrentPosition(10000).catch(() => null);
    if (statusEl) statusEl.textContent = loc ? 'GPS captured' : 'GPS unavailable';
    const media = await captureShortMedia(5000, 3000).catch(() => null);
    if (media && document.getElementById('evidenceControls')) {
      document.getElementById('evidenceControls').style.display = 'block';
      const previewVideo = document.getElementById('preview');
      const audioPreview = document.getElementById('audioPreview');
      if (previewVideo && media.videoUrl) previewVideo.src = media.videoUrl;
      if (audioPreview && media.audioUrl) audioPreview.src = media.audioUrl;
      const evidenceMeta = document.getElementById('evidenceMeta');
      if (evidenceMeta) evidenceMeta.innerHTML = `Evidence recorded at <strong>${new Date().toISOString()}</strong>`;
    }
    const payload = { type: 'SOS', note: 'SOS from prototype', location: loc, anonymous: false };
    const res = await fetch(window.HS_API + '/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const alertJson = await res.json();
    if (statusEl) statusEl.textContent = 'SOS sent ✓';
    toast('SOS sent. Trusted contacts notified (mock).');

    if (media && (media.videoBlob || media.audioBlob)) {
      const form = new FormData();
      if (media.videoBlob) form.append('file', media.videoBlob, 'evidence-video.webm');
      if (media.audioBlob) form.append('file', media.audioBlob, 'evidence-audio.webm');
      const up = await fetch(window.HS_API + '/api/evidence', { method: 'POST', body: form });
      const upj = await up.json();
      if (upj.item && upj.item.createdAt && document.getElementById('evidenceMeta')) {
        document.getElementById('evidenceMeta').innerHTML += `<div class="evidence-meta">Uploaded at <strong>${upj.item.createdAt}</strong></div>`;
      }
    }
  } catch (err) {
    console.error(err);
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Failed to send SOS. Saved locally.';
    enqueueOffline({ type: 'alert', payload: { type: 'SOS', note: 'offline SOS' } });
  }
}

/* -------------------------
   Socket.IO: connect and handlers for patrols and admin updates
   ------------------------- */
let socket = null;
function initSocketIo() {
  loadSocketIoClient(() => {
    try {
      socket = window.io ? io(window.HS_API) : null;
      if (!socket) return console.warn('Socket.IO not available');
      socket.on('connect', () => console.log('Socket connected', socket.id));
      socket.on('patrols:update', (data) => {
        // dispatch a custom event so pages can listen
        const ev = new CustomEvent('patrols:update', { detail: data });
        window.dispatchEvent(ev);
      });
      socket.on('admin:update', (data) => {
        const ev = new CustomEvent('admin:update', { detail: data });
        window.dispatchEvent(ev);
      });
      socket.on('new-alert', (a) => {
        const ev = new CustomEvent('alerts:new', { detail: a });
        window.dispatchEvent(ev);
      });
    } catch (e) { console.warn('Socket init failed', e); }
  });
}

/* -------------------------
   Admin helpers (demo token)
   ------------------------- */
async function adminLogin(token) {
  try {
    const res = await fetch(window.HS_API + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const j = await res.json();
    if (j.ok) {
      localStorage.setItem('hs_admin_token', j.token);
      return true;
    }
    return false;
  } catch (e) { return false; }
}
async function adminCreate(type, data) {
  const token = localStorage.getItem('hs_admin_token');
  if (!token) throw new Error('Not logged in');
  const res = await fetch(window.HS_API + '/api/admin/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, data, adminToken: token }) });
  return res.json();
}
async function adminUpdate(type, id, data) {
  const token = localStorage.getItem('hs_admin_token');
  if (!token) throw new Error('Not logged in');
  const res = await fetch(window.HS_API + '/api/admin/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, id, data, adminToken: token }) });
  return res.json();
}

/* -------------------------
   Utility: escapeHtml
   ------------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* -------------------------
   Accessibility helpers
   ------------------------- */
function trapFocus(modalEl) {
  const focusable = modalEl.querySelectorAll('a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length-1];
  modalEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    } else if (e.key === 'Escape') {
      const close = modalEl.querySelector('#closeModal');
      if (close) close.click();
    }
  });
}

/* -------------------------
   Expose functions globally
   ------------------------- */
window.startDynamicBackground = startDynamicBackground;
window.startClock = startClock;
window.getCurrentPosition = getCurrentPosition;
window.captureShortMedia = captureShortMedia;
window.toast = toast;
window.enqueueOffline = enqueueOffline;
window.flushOffline = flushOffline;
window.refreshCounts = refreshCounts;
window.showNearby = showNearby;
window.openModal = openModal;
window.showVolunteerProfile = showVolunteerProfile;
window.showShopProfile = showShopProfile;
window.showHomeProfile = showHomeProfile;
window.showDriverProfile = showDriverProfile;
window.bookDriver = bookDriver;
window.askFeedback = askFeedback;
window.sendSosFlow = sendSosFlow;
window.adminLogin = adminLogin;
window.adminCreate = adminCreate;
window.adminUpdate = adminUpdate;
window.initSocketIo = initSocketIo;
window.trapFocus = trapFocus;

/* -------------------------
   Auto-run small tasks if present
   ------------------------- */
try {
  if (document.getElementById('liveTime')) startClock('liveTime');
  if (document.getElementById('headerTime')) startClock('headerTime');
  // initialize socket.io for pages that want real-time updates
  initSocketIo();
} catch (e) { /* ignore */ }

