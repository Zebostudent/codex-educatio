require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const initSqlJs = require('sql.js');

const app = express();
app.use(cors());
app.use(express.json());
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : __dirname;

app.use(express.static(PUBLIC_DIR));

// ── SOZLAMALAR ──────────────────────────────────────────────
let CFG = {
  markaz:      process.env.MARKAZ_NOMI     || 'Codex Education',
  tel:         process.env.MARKAZ_TEL      || '',
  aiKey:       process.env.ANTHROPIC_API_KEY || '',
  eskizEmail:  process.env.ESKIZ_EMAIL     || '',
  eskizPass:   process.env.ESKIZ_PASSWORD  || '',
  adminParol:  process.env.ADMIN_PAROL     || 'admin123',
  teacherParol:process.env.TEACHER_PAROL  || 'teacher123',
};

// ── BAZA ────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data');
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });
const DB_FILE = path.join(DB_PATH, 'baza.db');

let db;
async function bazaYukla() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS oqvchilar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ism TEXT, familya TEXT, maktab TEXT,
    sinf TEXT, tel TEXT, fan TEXT, fanId TEXT,
    ball INTEGER DEFAULT 0, jami INTEGER DEFAULT 0,
    foiz INTEGER DEFAULT 0, javoblar TEXT,
    tahlil TEXT, sms INTEGER DEFAULT 0,
    vaqt TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS fanlar (
    id TEXT PRIMARY KEY, data TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sinflar (
    nom TEXT PRIMARY KEY, tartib INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sozlamalar (
    kalit TEXT PRIMARY KEY, qiymat TEXT
  )`);
  saqlash();

  // Sozlamalarni bazadan yuklash
  const sozList = dbAll("SELECT kalit,qiymat FROM sozlamalar");
  sozList.forEach(r => { if (CFG[r.kalit] !== undefined) CFG[r.kalit] = r.qiymat; });

  console.log('✅ Baza tayyor');
}

function saqlash() {
  try { fs.writeFileSync(DB_FILE, Buffer.from(db.export())); } catch(e) { console.error('Saqlash xato:', e.message); }
}

function dbRun(sql, p = []) { db.run(sql, p); saqlash(); const r = db.exec("SELECT last_insert_rowid() lid"); return r[0]?.values[0][0]; }
function dbGet(sql, p = []) { const r = db.exec(sql, p); if (!r[0]) return null; return Object.fromEntries(r[0].columns.map((c,i) => [c, r[0].values[0][i]])); }
function dbAll(sql, p = []) { const r = db.exec(sql, p); if (!r[0]) return []; return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c,i) => [c, row[i]]))); }

// ── SMS ─────────────────────────────────────────────────────
async function smsYuborish(tel, matn) {
  if (!CFG.eskizEmail || !CFG.eskizPass) return false;
  try {
    const a = await fetch('https://notify.eskiz.uz/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: CFG.eskizEmail, password: CFG.eskizPass })
    });
    const { data } = await a.json();
    if (!data?.token) return false;
    const r = tel.replace(/\D/g, '');
    const to = r.startsWith('998') ? r : `998${r}`;
    const s = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
      body: JSON.stringify({ mobile_phone: to, message: matn, from: '4546' })
    });
    const res = await s.json();
    return res.status === 'waiting' || !!res.id;
  } catch (e) { console.error('SMS xato:', e.message); return false; }
}

// ── AI ───────────────────────────────────────────────────────
async function aiTahlil(ism, familya, fan, ball, jami, foiz) {
  if (!CFG.aiKey || !CFG.aiKey.startsWith('sk-')) return null;
  try {
    const anthropic = new Anthropic({ apiKey: CFG.aiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Sen "${CFG.markaz}" o'quv markazi uchun ishlaysan. ${familya} ${ism} "${fan}" fanidan ${jami} savoldan ${ball} tasini to'g'ri yechdi (${foiz}%). Faqat JSON formatda javob ber:
{"qiziqishlar":["soha1","soha2"],"tavsiya":["kurs1","kurs2"],"sms":"Hurmatli ota-ona! Bugun ${familya} ${ism} ${CFG.markaz}da ${fan} testini topshirdi: ${ball}/${jami} (${foiz}%). Qobiliyati bor! Qiziqsangiz: ${CFG.tel}"}`
      }]
    });
    const txt = msg.content[0].text;
    return JSON.parse(txt.match(/\{[\s\S]*\}/)[0]);
  } catch (e) { console.error('AI xato:', e.message); return null; }
}

// ── MIDDLEWARE ───────────────────────────────────────────────
function adminAuth(req, res, next) {
  if (req.headers['x-token'] !== CFG.adminParol) return res.status(401).json({ xato: 'Ruxsat yoq' });
  next();
}
function teacherAuth(req, res, next) {
  const t = req.headers['x-token'];
  if (t !== CFG.teacherParol && t !== CFG.adminParol) return res.status(401).json({ xato: 'Ruxsat yoq' });
  next();
}

// ── API ──────────────────────────────────────────────────────

// Login
app.post('/api/login', (req, res) => {
  const { rol, parol } = req.body;
  if (rol === 'admin'   && parol === CFG.adminParol)   return res.json({ ok: true, token: CFG.adminParol });
  if (rol === 'teacher' && parol === CFG.teacherParol) return res.json({ ok: true, token: CFG.teacherParol });
  res.status(401).json({ xato: "Parol noto'g'ri" });
});

// Fanlar
app.get('/api/fanlar', (_, res) => {
  const list = dbAll("SELECT data FROM fanlar");
  const fanlar = list.map(r => JSON.parse(r.data));
  res.json(fanlar.length ? fanlar : STANDART_FANLAR);
});

app.post('/api/fanlar', adminAuth, (req, res) => {
  db.run("DELETE FROM fanlar");
  req.body.forEach(f => dbRun("INSERT OR REPLACE INTO fanlar VALUES(?,?)", [f.id, JSON.stringify(f)]));
  res.json({ ok: true });
});

// Sinflar
app.get('/api/sinflar', (_, res) => {
  const list = dbAll("SELECT nom FROM sinflar ORDER BY tartib,nom");
  res.json(list.length ? list.map(r => r.nom) : SINFLAR_STANDART);
});

app.post('/api/sinflar', adminAuth, (req, res) => {
  const { amal, nom } = req.body;
  if (amal === 'qosh') {
    const count = dbGet("SELECT COUNT(*) c FROM sinflar")?.c || 0;
    dbRun("INSERT OR IGNORE INTO sinflar VALUES(?,?)", [nom, count]);
    return res.json({ ok: true });
  }
  if (amal === 'ochir') {
    dbRun("DELETE FROM sinflar WHERE nom=?", [nom]);
    return res.json({ ok: true });
  }
  res.status(400).json({ xato: "Noma'lum amal" });
});

// Sozlamalar
app.get('/api/sozlama', adminAuth, (_, res) => {
  res.json({ markaz: CFG.markaz, tel: CFG.tel });
});

app.post('/api/sozlama', adminAuth, (req, res) => {
  const fields = ['markaz','tel','aiKey','eskizEmail','eskizPass','adminParol','teacherParol'];
  fields.forEach(k => {
    if (req.body[k] !== undefined && req.body[k] !== '') {
      CFG[k] = req.body[k];
      dbRun("INSERT OR REPLACE INTO sozlamalar VALUES(?,?)", [k, req.body[k]]);
    }
  });
  res.json({ ok: true });
});

// Test yuborish
app.post('/api/yuborish', async (req, res) => {
  const { ism, familya, maktab, sinf, tel, fan, fanId, ball, jami, foiz, javoblar } = req.body;
  if (!ism || !tel) return res.status(400).json({ xato: "Ma'lumotlar yetarli emas" });

  const id = dbRun(
    `INSERT INTO oqvchilar (ism,familya,maktab,sinf,tel,fan,fanId,ball,jami,foiz,javoblar) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [ism, familya||'', maktab||'', sinf||'', tel, fan||'', fanId||'', ball||0, jami||0, foiz||0, JSON.stringify(javoblar||{})]
  );
  res.json({ ok: true, id });

  // Fon: AI + SMS
  aiTahlil(ism, familya, fan, ball, jami, foiz).then(async tahlil => {
    if (!tahlil) {
      tahlil = {
        qiziqishlar: [fan || 'Umumiy'],
        tavsiya: [(fan || 'Asosiy') + ' kursi'],
        sms: `Hurmatli ota-ona! Bugun ${familya} ${ism} ${CFG.markaz}da ${fan} testini topshirdi: ${ball}/${jami} (${foiz}%). Qiziqsangiz: ${CFG.tel}`
      };
    }
    const sms = await smsYuborish(tel, tahlil.sms);
    dbRun('UPDATE oqvchilar SET tahlil=?,sms=? WHERE id=?', [JSON.stringify(tahlil), sms ? 1 : 0, id]);
    console.log(`✅ ${familya} ${ism}: ${ball}/${jami} | SMS: ${sms ? '✓' : '✗'}`);
  }).catch(e => console.error('AI/SMS xato:', e.message));
});

// Natija
app.get('/api/natija/:id', (req, res) => {
  const r = dbGet('SELECT * FROM oqvchilar WHERE id=?', [req.params.id]);
  if (!r) return res.status(404).json({ xato: 'Topilmadi' });
  try { r.tahlil = r.tahlil ? JSON.parse(r.tahlil) : null; } catch { r.tahlil = null; }
  res.json(r);
});

// Admin: barchasi
app.get('/api/admin/barchasi', adminAuth, (_, res) => {
  const list = dbAll('SELECT * FROM oqvchilar ORDER BY vaqt DESC');
  list.forEach(r => { try { r.tahlil = r.tahlil ? JSON.parse(r.tahlil) : null; } catch { r.tahlil = null; } });
  res.json(list);
});

// Admin: statistika
app.get('/api/admin/statistika', adminAuth, (_, res) => {
  res.json({
    jami:   dbGet("SELECT COUNT(*) c FROM oqvchilar")?.c || 0,
    sms:    dbGet("SELECT COUNT(*) c FROM oqvchilar WHERE sms=1")?.c || 0,
    bugun:  dbGet("SELECT COUNT(*) c FROM oqvchilar WHERE date(vaqt)=date('now','localtime')")?.c || 0,
    ort:    dbGet("SELECT ROUND(AVG(foiz),1) c FROM oqvchilar")?.c || 0,
  });
});

// O'qituvchi
app.get('/api/teacher/natijalar', teacherAuth, (req, res) => {
  const { sinf } = req.query;
  const list = sinf
    ? dbAll('SELECT * FROM oqvchilar WHERE sinf=? ORDER BY foiz DESC', [sinf])
    : dbAll('SELECT * FROM oqvchilar ORDER BY foiz DESC');
  res.json(list);
});

// Hammaga SMS
app.post('/api/admin/hammaga-sms', adminAuth, async (req, res) => {
  const { matn } = req.body;
  const list = dbAll('SELECT * FROM oqvchilar');
  res.json({ ok: true, jami: list.length });
  let n = 0;
  for (const o of list) {
    const t = matn
      .replace(/{ism}/g, `${o.familya} ${o.ism}`)
      .replace(/{ball}/g, `${o.ball}/${o.jami}`)
      .replace(/{foiz}/g, (o.foiz || 0) + '%')
      .replace(/{fan}/g, o.fan || '')
      .replace(/{maktab}/g, o.maktab || '');
    const ok = await smsYuborish(o.tel, t);
    if (ok) { n++; dbRun('UPDATE oqvchilar SET sms=1 WHERE id=?', [o.id]); }
    await new Promise(r => setTimeout(r, 350));
  }
  console.log(`📱 Hammaga SMS: ${n}/${list.length}`);
});

// SPA fallback
app.get('*', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ── STANDART MA'LUMOTLAR ─────────────────────────────────────
const SINFLAR_STANDART = ['1-sinf','2-sinf','3-sinf','4-sinf','5-sinf','6-sinf','7-sinf','8-sinf','9-sinf','10-sinf','11-sinf'];
const STANDART_FANLAR = [];

// ── ISHGA TUSHIRISH ──────────────────────────────────────────
const PORT = process.env.PORT || 3001;
bazaYukla().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Codex Education: http://localhost:${PORT}`);
    console.log(`🔐 Admin parol: ${CFG.adminParol}`);
    console.log(`👨‍🏫 Teacher parol: ${CFG.teacherParol}\n`);
  });
});
