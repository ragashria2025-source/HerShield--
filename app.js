// frontend/app.js
const API = 'http://localhost:4000';
const socket = io(API);

// DOM refs
const alertsList = document.getElementById('alertsList');
const evidenceList = document.getElementById('evidenceList');
const smsLogEl = document.getElementById('smsLog');
const contactsListEl = document.getElementById('contactsList');
const mapEl = document.getElementById('map');

let map, markers = [];
let watchId = null;
let liveSharing = false;
let offlineQueue = JSON.parse(localStorage.getItem('hs_queue') || '[]');

// Helpers
async function apiGet(path){ return (await fetch(API + path)).json(); }
async function apiPost(path, body){ return (await fetch(API + path, { method:'POST', headers: body instanceof FormData ? undefined : { 'Content-Type':'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body) })).json(); }

function renderAlerts(items){
  alertsList.innerHTML = '';
  items.slice().reverse().forEach(a => {
    const li = document.createElement('li');
    li.textContent = `${new Date(a.createdAt).toLocaleString()} — ${a.type} ${a.anonymous ? '(anonymous)' : ''} ${a.note ? '— ' + a.note : ''}`;
    alertsList.appendChild(li);
  });
}

function renderEvidence(items){
  evidenceList.innerHTML = '';
  items.slice().reverse().forEach(e => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = API + e.url;
    a.target = '_blank';
    a.textContent = `${new Date(e.createdAt).toLocaleString()} — ${e.originalName || e.name}`;
    li.appendChild(a);
    evidenceList.appendChild(li);
  });
}

function renderSMSLog(items){
  smsLogEl.innerHTML = '';
  items.forEach(s => {
    const li = document.createElement('li');
    li.textContent = `${new Date(s.createdAt).toLocaleString()} → ${s.to} : ${s.message}`;
    smsLogEl.appendChild(li);
  });
}

function renderContacts(list){
  contactsListEl.innerHTML = '';
  list.forEach(c => {
    const div = document.createElement('div');
    div.textContent = `${c.name} — ${c.phone || c.email}`;
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.dataset.contactId = c.id;
    div.prepend(chk);
    const del = document.createElement('button');
    del.textContent = 'Remove';
    del.style.marginLeft = '8px';
    del.addEventListener('click', async ()=> {
      await fetch(API + '/api/contacts/' + c.id, { method: 'DELETE' });
      loadContacts();
    });
    div.appendChild(del);
    contactsListEl.appendChild(div);
  });
}

async function loadAll(){
  const [alerts, evidence, smsLog, contacts] = await Promise.all([apiGet('/api/alerts'), apiGet('/api/evidence'), apiGet('/api/sms-log'), apiGet('/api/contacts')]);
  renderAlerts(alerts);
  renderEvidence(evidence);
  renderSMSLog(smsLog);
  renderContacts(contacts);
  renderMap(alerts);
}

async function loadContacts(){ const c = await apiGet('/api/contacts'); renderContacts(c); }

// Map and heatmap (simple markers)
function initMap(){
  map = L.map('map').setView([20.5937,78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
}

function clearMarkers(){ markers.forEach(m => map.removeLayer(m)); markers = []; }

function renderMap(alerts){
  if (!map) initMap();
  clearMarkers();
  alerts.forEach(a => {
    if (a.location && a.location.lat && a.location.lng){
      const m = L.marker([a.location.lat, a.location.lng]).addTo(map).bindPopup(`${a.type} ${a.anonymous ? '(anon)' : ''}<br>${a.note || ''}`);
      markers.push(m);
    }
  });
}

// UI actions
document.getElementById('sosBtn').addEventListener('click', async () => {
  const escalation = Array.from(document.querySelectorAll('#contactsList input[type="checkbox"]:checked')).map(i => i.dataset.contactId);
  const anonymous = document.getElementById('anonymousChk').checked;
  const location = lastKnownLocation || null;
  const payload = { type: 'SOS', note: '', escalation, anonymous, location };
  if (!navigator.onLine) { enqueue({ type:'alert', payload }); alert('Offline: queued'); return; }
  await apiPost('/api/alerts', payload);
  await loadAll();
});

document.getElementById('unsafeBtn').addEventListener('click', async () => {
  const escalation = Array.from(document.querySelectorAll('#contactsList input[type="checkbox"]:checked')).map(i => i.dataset.contactId);
  const anonymous = document.getElementById('anonymousChk').checked;
  const location = lastKnownLocation || null;
  const payload = { type: 'UNSAFE', note: '', escalation, anonymous, location };
  if (!navigator.onLine) { enqueue({ type:'alert', payload }); alert('Offline: queued'); return; }
  await apiPost('/api/alerts', payload);
  await loadAll();
});

document.getElementById('sendNote').addEventListener('click', async () => {
  const note = document.getElementById('noteInput').value.trim();
  if (!note) return alert('Enter a note');
  const escalation = Array.from(document.querySelectorAll('#contactsList input[type="checkbox"]:checked')).map(i => i.dataset.contactId);
  const anonymous = document.getElementById('anonymousChk').checked;
  const payload = { type: 'NOTE', note, escalation, anonymous, location: lastKnownLocation || null };
  if (!navigator.onLine) { enqueue({ type:'alert', payload }); alert('Offline: queued'); return; }
  await apiPost('/api/alerts', payload);
  document.getElementById('noteInput').value = '';
  await loadAll();
});

// Contacts
document.getElementById('addContact').addEventListener('click', async () => {
  const name = document.getElementById('contactName').value.trim();
  const phone = document.getElementById('contactPhone').value.trim();
  if (!name) return alert('Name required');
  await apiPost('/api/contacts', { name, phone });
  document.getElementById('contactName').value = '';
  document.getElementById('contactPhone').value = '';
  loadContacts();
});

// Evidence upload
document.getElementById('uploadBtn').addEventListener('click', async () => {
  const f = document.getElementById('fileInput').files[0];
  if (!f) return alert('Pick a file');
  const form = new FormData();
  form.append('file', f);
  if (!navigator.onLine) { enqueue({ type:'evidence', payload: { name: f.name } }); alert('Offline: queued'); return; }
  const res = await fetch(API + '/api/evidence', { method: 'POST', body: form });
  const data = await res.json();
  if (data.summary) document.getElementById('aiSummary').textContent = data.summary;
  await loadAll();
});

// Mock SMS button
document.getElementById('smsHelp').addEventListener('click', async () => {
  // For demo, send a mock alert to first contact
  const contacts = await apiGet('/api/contacts');
  if (!contacts.length) return alert('Add a contact first');
  const payload = { type: 'SOS', note: 'Auto SMS test', escalation: [contacts[0].id], anonymous: false, location: lastKnownLocation || null };
  await apiPost('/api/alerts', payload);
  await loadAll();
});

// Accessibility toggle
document.getElementById('a11yToggle').addEventListener('click', () => {
  document.body.classList.toggle('a11y');
});

// Offline queue
function enqueue(action){
  offlineQueue.push(action);
  localStorage.setItem('hs_queue', JSON.stringify(offlineQueue));
}

async function flushQueue(){
  if (!navigator.onLine) return;
  if (!offlineQueue.length) return;
  const actions = offlineQueue.splice(0, offlineQueue.length);
  localStorage.setItem('hs_queue', JSON.stringify(offlineQueue));
  await apiPost('/api/sync-queue', { actions });
  await loadAll();
}

window.addEventListener('online', () => { flushQueue(); });

// Live location
let lastKnownLocation = null;
document.getElementById('shareLocationChk').addEventListener('change', (e) => {
  if (e.target.checked) startSharing(); else stopSharing();
});

function startSharing(){
  if (!navigator.geolocation) return alert('Geolocation not supported');
  liveSharing = true;
  watchId = navigator.geolocation.watchPosition(async pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    lastKnownLocation = { lat, lng };
    await apiPost('/api/location', { userId: 'demo-user', lat, lng });
    // update map marker
    if (map) {
      const m = L.circleMarker([lat, lng], { radius:8, color:'red' }).addTo(map);
      markers.push(m);
      map.setView([lat, lng], 13);
    }
  }, err => console.warn('geo err', err), { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}

function stopSharing(){
  liveSharing = false;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

// Socket.IO listeners
socket.on('connect', () => console.log('socket connected'));
socket.on('new-alert', a => {
  // Prepend to alerts list
  const li = document.createElement('li');
  li.textContent = `${new Date(a.createdAt).toLocaleString()} — ${a.type} ${a.anonymous ? '(anonymous)' : ''} ${a.note ? '— ' + a.note : ''}`;
  alertsList.insertBefore(li, alertsList.firstChild);
});
socket.on('sms-log-updated', data => renderSMSLog(data));
socket.on('evidence-uploaded', data => {
  document.getElementById('aiSummary').textContent = data.summary || '';
  loadAll();
});
socket.on('location-update', loc => {
  // optional: show live location updates on map
  if (map && loc.lat && loc.lng) {
    const m = L.circleMarker([loc.lat, loc.lng], { radius:6, color:'blue' }).addTo(map);
    markers.push(m);
  }
});

// Initial load
init();
async function init(){
  initMap();
  await loadAll();
  flushQueue();
}
