// backend/server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure db.json exists
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    alerts: [], evidence: [], contacts: [], locations: [], smsLog: [],
    volunteers: [], shops: [], homes: [], drivers: [], bookings: [], driverFeedback: []
  }, null, 2));
}
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE)); }
  catch (e) { return { alerts: [], evidence: [], contacts: [], locations: [], smsLog: [], volunteers: [], shops: [], homes: [], drivers: [], bookings: [], driverFeedback: [] }; }
}
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Secure evidence download: requires admin token
app.get('/api/evidence/:id/download', (req, res) => {
  const token = req.query.token; // ?token=...
  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const db = readDB();
  const item = (db.evidence || []).find(e => e.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(UPLOAD_DIR, item.name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });

  res.download(filePath, item.originalName);
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage });

/* ---------- Utilities ---------- */
function hashCoord(lat, lng) {
  const s = `${lat.toFixed(4)}:${lng.toFixed(4)}`;
  let h = 0;
  for (let i=0;i<s.length;i++) h = (h<<5)-h + s.charCodeAt(i);
  return Math.abs(h);
}
function computeMetrics(lat, lng) {
  const h = hashCoord(lat,lng);
  const lighting = 40 + (h % 61); // 40-100
  const crime = Math.max(1, (h % 50)); // 1-49
  const crowd = 10 + (h % 81); // 10-90
  const score = Math.round(Math.max(5, Math.min(98, (lighting*0.45) + (100 - crime)*0.35 + (100 - Math.abs(crowd-40))*0.2)));
  return { lighting: Math.min(100, lighting), crime: Math.min(100, crime), crowd: Math.min(100, crowd), score };
}
function lerp(a,b,t){ return a + (b-a)*t; }
function sampleLine(a,b,steps){
  const pts = [];
  for(let i=0;i<steps;i++){
    const t = i/(steps-1);
    pts.push([ lerp(a[0],b[0],t), lerp(a[1],b[1],t) ]);
  }
  return pts;
}
function distKm(a,b){ const R=6371; const dLat=(b.lat-a.lat)*Math.PI/180; const dLon=(b.lng-a.lng)*Math.PI/180; const la=a.lat*Math.PI/180; const lb=b.lat*Math.PI/180; const x=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)*Math.sin(dLon/2); const c=2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x)); return R*c; }

/* ---------- Basic endpoints ---------- */
app.get('/api/contacts', (req, res) => { res.json(readDB().contacts || []); });
app.post('/api/contacts', (req, res) => {
  const { name, phone, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = readDB();
  const contact = { id: Date.now().toString(), name, phone: phone || '', email: email || '' };
  db.contacts.push(contact); writeDB(db); res.status(201).json(contact);
});

app.get('/api/alerts', (req,res) => res.json(readDB().alerts || []));
app.post('/api/alerts', (req,res) => {
  const { type, note, escalation, anonymous, location, userId } = req.body;
  const db = readDB();
  const item = { id: Date.now().toString(), type: type||'SOS', note: note||'', escalation: escalation||[], anonymous: !!anonymous, location: location||null, userId: userId||null, createdAt: new Date().toISOString(), status:'new' };
  db.alerts.push(item); writeDB(db); io.emit('new-alert', item); res.status(201).json(item);
});

app.post('/api/evidence', upload.single('file'), (req,res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const db = readDB();
  const item = { id: Date.now().toString(), name: req.file.filename, originalName: req.file.originalname, url: `/uploads/${req.file.filename}`, createdAt: new Date().toISOString() };
  db.evidence.push(item); writeDB(db); io.emit('evidence-uploaded', { item, summary: `Mock summary for ${item.originalName}` }); res.status(201).json({ item, summary: `Mock summary for ${item.originalName}` });
});
app.get('/api/evidence', (req,res) => res.json(readDB().evidence || []));

/* ---------- Location endpoints ---------- */
app.post('/api/location', (req,res) => {
  const { userId, lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'lat and lng required' });
  const db = readDB();
  const loc = { id: Date.now().toString(), userId: userId||null, lat, lng, createdAt: new Date().toISOString() };
  db.locations.push(loc); writeDB(db); io.emit('location-update', loc); res.status(201).json(loc);
});
app.get('/api/locations-all', (req,res) => res.json(readDB().locations || []));

/* ---------- Safe score and route metrics ---------- */
app.get('/api/safe-score', (req,res) => {
  const lat = parseFloat(req.query.lat); const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'lat and lng required' });
  const metrics = computeMetrics(lat,lng);
  res.json({ score: metrics.score, lighting: metrics.lighting, crimePercent: metrics.crime, crowdPercent: metrics.crowd });
});

app.post('/api/route-metrics', (req,res) => {
  const { waypoints, samplesPerSegment = 6 } = req.body;
  if (!Array.isArray(waypoints) || waypoints.length < 2) return res.status(400).json({ error: 'waypoints array required (2+ points)' });
  const points = [];
  for (let i=0;i<waypoints.length-1;i++){
    const a = waypoints[i]; const b = waypoints[i+1];
    const seg = sampleLine(a,b,samplesPerSegment);
    if (i < waypoints.length-2) seg.pop();
    seg.forEach(p => points.push(p));
  }
  const metrics = points.map(p => {
    const m = computeMetrics(p[0], p[1]);
    return { lat: p[0], lng: p[1], lighting: m.lighting, crimePercent: m.crime, crowdPercent: m.crowd, score: m.score };
  });
  const avgScore = Math.round(metrics.reduce((s,m)=>s+m.score,0)/metrics.length);
  const avgLighting = Math.round(metrics.reduce((s,m)=>s+m.lighting,0)/metrics.length);
  const avgCrime = Math.round(metrics.reduce((s,m)=>s+m.crimePercent,0)/metrics.length);
  const avgCrowd = Math.round(metrics.reduce((s,m)=>s+m.crowdPercent,0)/metrics.length);
  res.json({ points: metrics, aggregated: { score: avgScore, lighting: avgLighting, crimePercent: avgCrime, crowdPercent: avgCrowd } });
});

/* ---------- Volunteers, shops, homes, drivers ---------- */
app.post('/api/volunteers', (req,res) => { const db = readDB(); db.volunteers = db.volunteers || []; const v = { id: Date.now().toString(), ...req.body }; db.volunteers.push(v); writeDB(db); res.json(v); });
app.get('/api/volunteers', (req,res) => res.json(readDB().volunteers || []));
app.get('/api/volunteers/:id', (req,res) => { const v = (readDB().volunteers||[]).find(x=>x.id===req.params.id); res.json(v||null); });

app.get('/api/shops', (req,res) => res.json(readDB().shops || []));
app.get('/api/shops/:id', (req,res) => { const s = (readDB().shops||[]).find(x=>x.id===req.params.id); res.json(s||null); });
app.post('/api/shops', (req,res) => { const db = readDB(); db.shops = db.shops || []; const s = { id: Date.now().toString(), ...req.body }; db.shops.push(s); writeDB(db); res.json(s); });

app.get('/api/homes', (req,res) => res.json(readDB().homes || []));
app.get('/api/homes/:id', (req,res) => { const h = (readDB().homes||[]).find(x=>x.id===req.params.id); res.json(h||null); });
app.post('/api/homes', (req,res) => { const db = readDB(); db.homes = db.homes || []; const h = { id: Date.now().toString(), ...req.body }; db.homes.push(h); writeDB(db); res.json(h); });

app.get('/api/drivers', (req,res) => res.json(readDB().drivers || []));
app.get('/api/drivers/:id', (req,res) => { const d = (readDB().drivers||[]).find(x=>x.id===req.params.id); res.json(d||null); });

/* ---------- Nearby endpoints ---------- */
app.get('/api/nearby/volunteers', (req,res) => {
  const { lat, lng } = req.query; const db = readDB();
  if (!lat || !lng) return res.json(db.volunteers || []);
  const list = (db.volunteers || []).filter(v => !v.lat || !v.lng || distKm({lat:parseFloat(lat),lng:parseFloat(lng)},{lat:v.lat,lng:v.lng}) < 15);
  res.json(list);
});
app.get('/api/nearby/shops', (req,res) => {
  const { lat, lng } = req.query; const db = readDB();
  if (!lat || !lng) return res.json(db.shops || []);
  const list = (db.shops || []).filter(s => !s.lat || !s.lng || distKm({lat:parseFloat(lat),lng:parseFloat(lng)},{lat:s.lat,lng:s.lng}) < 20);
  res.json(list);
});
app.get('/api/nearby/drivers', (req,res) => {
  const { lat, lng } = req.query; const db = readDB();
  if (!lat || !lng) return res.json(db.drivers || []);
  const list = (db.drivers || []).filter(d => !d.lat || !d.lng || distKm({lat:parseFloat(lat),lng:parseFloat(lng)},{lat:d.lat,lng:d.lng}) < 25);
  res.json(list);
});

/* ---------- Booking & feedback ---------- */
app.post('/api/book-driver', (req,res) => {
  const { driverId } = req.body; const db = readDB(); db.bookings = db.bookings || []; const b = { id: Date.now().toString(), driverId, createdAt: new Date().toISOString() }; db.bookings.push(b); writeDB(db); res.json({ ok:true, bookingId: b.id });
});
app.post('/api/driver-feedback', (req,res) => {
  const { driverId, rating, comment } = req.body; const db = readDB(); db.driverFeedback = db.driverFeedback || []; db.driverFeedback.push({ id: Date.now().toString(), driverId, rating, comment, createdAt: new Date().toISOString() }); writeDB(db); res.json({ ok:true });
});

/* ---------- Patrol simulator (server-side live positions) ---------- */
const patrolTemplates = [
  { id:'p1', name:'T Nagar Loop', coords:[ [13.0419,80.2376],[13.0435,80.2410],[13.0460,80.2430],[13.0480,80.2400],[13.0450,80.2380] ] },
  { id:'p2', name:'Anna Salai Patrol', coords:[ [13.0629,80.2490],[13.0645,80.2520],[13.0660,80.2550],[13.0680,80.2525],[13.0650,80.2500] ] },
  { id:'p3', name:'Adyar River Edge', coords:[ [13.0100,80.2500],[13.0120,80.2520],[13.0140,80.2540],[13.0160,80.2520],[13.0130,80.2500] ] }
];
const patrolState = patrolTemplates.map((t, idx) => {
  const route = t.coords.map(c => ({ lat:c[0], lng:c[1] }));
  return { id: t.id, name: t.name, route, index: idx % route.length, direction: 1, speedMs: 1200 + idx*200 };
});

// endpoint returns current positions (still available)
app.get('/api/patrols/live', (req,res) => {
  patrolState.forEach((p, idx) => {
    p.index = (p.index + p.direction + p.route.length) % p.route.length;
    if (Math.random() < 0.02) p.direction *= -1;
  });
  const out = patrolState.map(p => ({ id: p.id, name: p.name, lat: p.route[p.index].lat, lng: p.route[p.index].lng, ts: new Date().toISOString() }));
  res.json(out);
});

/* ---------- Socket.IO: push patrol updates ---------- */
io.on('connection', socket => {
  console.log('Socket connected', socket.id);
  // send initial patrols
  const snapshot = patrolState.map(p => ({ id: p.id, name: p.name, lat: p.route[p.index].lat, lng: p.route[p.index].lng, ts: new Date().toISOString() }));
  socket.emit('patrols:update', snapshot);

  socket.on('disconnect', () => console.log('Socket disconnected', socket.id));
});

// advance patrols and broadcast every 5 seconds
setInterval(() => {
  patrolState.forEach((p) => {
    p.index = (p.index + p.direction + p.route.length) % p.route.length;
    if (Math.random() < 0.02) p.direction *= -1;
  });
  const out = patrolState.map(p => ({ id: p.id, name: p.name, lat: p.route[p.index].lat, lng: p.route[p.index].lng, ts: new Date().toISOString() }));
  io.emit('patrols:update', out);
}, 5000);

/* ---------- Mock AI (expanded question bank + session history) ---------- */
const aiQuestions = [
  { id:'q1', text:'Are you safe right now?', options:['Yes','No','Not sure'] },
  { id:'q2', text:'Is anyone with you?', options:['Alone','With friend','With stranger'] },
  { id:'q3', text:'Do you feel threatened by someone nearby?', options:['Yes','No'] },
  { id:'q4', text:'Is there a vehicle involved?', options:['Yes','No','Not sure'] },
  { id:'q5', text:'Can you move to a safer, well-lit area?', options:['Yes','No'] },
  { id:'q6', text:'Do you want me to call a trusted contact?', options:['Yes','No'] },
  { id:'q7', text:'Would you like a volunteer nearby to be notified?', options:['Yes','No'] },
  { id:'q8', text:'Do you want to send a short recorded message as evidence?', options:['Yes','No'] },
  { id:'q9', text:'Would you like route guidance to a safe place?', options:['Yes','No'] },
  { id:'q10', text:'Do you want to escalate to emergency services?', options:['Yes','No'] },
  { id:'q11', text:'How urgent is this on a scale of 1-5?', options:['1','2','3','4','5'] },
  { id:'q12', text:'Would you like me to stay on the line (chat) while you move?', options:['Yes','No'] }
];

// in-memory session store (demo)
const aiSessions = {}; // sessionId -> { answers: [], createdAt }

app.post('/api/ai/checkin', (req,res) => {
  const { answers = [], context = {}, sessionId } = req.body;
  // ensure session exists
  const sid = sessionId || ('s' + (Date.now() + Math.floor(Math.random()*1000)));
  if (!aiSessions[sid]) aiSessions[sid] = { answers: [], createdAt: new Date().toISOString() };
  // append any new answers
  if (Array.isArray(answers) && answers.length) {
    answers.forEach(a => aiSessions[sid].answers.push(a));
  }
  const session = aiSessions[sid];
  const last = session.answers[session.answers.length-1] || null;

  // urgency detection: if user free-text contains urgent keywords, escalate
  const freeTexts = session.answers.filter(a => a.questionId === 'free').map(a => (a.answer||'').toLowerCase()).join(' ');
  const urgentKeywords = ['help','attack','follow','threat','danger','rape','assault','stabbing','gun','knife','robbery','chase'];
  const urgent = urgentKeywords.some(k => freeTexts.includes(k));

  // branching logic
  if (!session.answers.length) {
    return res.json({ sessionId: sid, next: aiQuestions[0], action: null });
  }

  if (urgent) {
    return res.json({ sessionId: sid, next: null, action: { type:'escalate', message:'I detect urgent language. Consider sending SOS or calling emergency services now.' } });
  }

  // if user answered q1 = No -> ask q3 and suggest SOS
  if (last && last.questionId === 'q1' && last.answer === 'No') {
    return res.json({ sessionId: sid, next: aiQuestions[2], action: { type:'suggest_sos', message:'You said you are not safe. Would you like to send SOS now?' } });
  }

  // if user answered q3 = Yes -> escalate
  if (last && last.questionId === 'q3' && last.answer === 'Yes') {
    return res.json({ sessionId: sid, next: aiQuestions[11], action: { type:'escalate', message:'Threat detected. Offer to call contact or emergency services.' } });
  }

  // if user answered q11 (urgency scale) high -> escalate
  if (last && last.questionId === 'q11' && parseInt(last.answer,10) >= 4) {
    return res.json({ sessionId: sid, next: null, action: { type:'escalate', message:'You rated urgency high. Consider sending SOS or calling emergency services.' } });
  }

  // otherwise progress through questions sequentially but skip ones already answered
  const askedIds = session.answers.map(a => a.questionId);
  const nextQ = aiQuestions.find(q => !askedIds.includes(q.id));
  if (nextQ) return res.json({ sessionId: sid, next: nextQ, action: null });

  // complete
  return res.json({ sessionId: sid, next: null, action: { type:'complete', message:'Check-in complete. Resources suggested.' } });
});

/* ---------- Admin endpoints (simple token-based demo) ---------- */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'demo-admin-token-please-change';

app.post('/api/admin/login', (req,res) => {
  const { token } = req.body;
  if (token === ADMIN_TOKEN) return res.json({ ok:true, token: ADMIN_TOKEN });
  return res.status(401).json({ ok:false, error:'Invalid token' });
});

// create entity: body { type: 'volunteer'|'shop'|'home'|'driver', data: {...}, adminToken }
app.post('/api/admin/create', (req,res) => {
  const { type, data, adminToken } = req.body;
  if (adminToken !== ADMIN_TOKEN) return res.status(403).json({ error:'Unauthorized' });
  const db = readDB();
  const id = Date.now().toString();
  const item = { id, ...data };
  if (type === 'volunteer') { db.volunteers = db.volunteers || []; db.volunteers.push(item); }
  else if (type === 'shop') { db.shops = db.shops || []; db.shops.push(item); }
  else if (type === 'home') { db.homes = db.homes || []; db.homes.push(item); }
  else if (type === 'driver') { db.drivers = db.drivers || []; db.drivers.push(item); }
  else return res.status(400).json({ error:'Invalid type' });
  writeDB(db);
  io.emit('admin:update', { type, item });
  res.json({ ok:true, item });
});

// update entity: body { type, id, data, adminToken }
app.post('/api/admin/update', (req,res) => {
  const { type, id, data, adminToken } = req.body;
  if (adminToken !== ADMIN_TOKEN) return res.status(403).json({ error:'Unauthorized' });
  const db = readDB();
  let list;
  if (type === 'volunteer') list = db.volunteers = db.volunteers || [];
  else if (type === 'shop') list = db.shops = db.shops || [];
  else if (type === 'home') list = db.homes = db.homes || [];
  else if (type === 'driver') list = db.drivers = db.drivers || [];
  else return res.status(400).json({ error:'Invalid type' });
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error:'Not found' });
  list[idx] = { ...list[idx], ...data };
  writeDB(db);
  io.emit('admin:update', { type, item: list[idx] });
  res.json({ ok:true, item: list[idx] });
});

app.get('/api/admin/list', (req,res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error:'Unauthorized' });
  const db = readDB();
  res.json({ volunteers: db.volunteers || [], shops: db.shops || [], homes: db.homes || [], drivers: db.drivers || [] });
});

/* ---------- Health check ---------- */
app.get('/', (req,res) => res.send('HerShield backend running'));

/* ---------- Start server ---------- */
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));

app.use(express.static("frontend"));
app.get("*", (req,res)=>{
  res.sendFile(path.join(__dirname,"frontend","index.html"));
});

import express from "express";
import path from "path";

const app = express();
const __dirname = path.resolve();

// Serve frontend files
app.use(express.static(path.join(__dirname, "frontend")));

// Catch-all route for frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

app.listen(3000, () => {
  console.log("HerShield running on port 3000");
});

