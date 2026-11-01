'use strict';
/*
 * KSAK Audio — plugins website with custom accounts and gated trial downloads.
 * Single-file Express + SQLite (better-sqlite3) app.
 * Env: PORT, SESSION_SECRET (accepted for future cookie-signing use; sessions
 * are server-side random tokens), DOWNLOADS_DIR, DB_PATH, NODE_ENV.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(__dirname, '..', 'downloads');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'ksak.db');
const IS_PROD = (process.env.NODE_ENV || '') === 'production';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const DL_TOKEN_TTL_MS = 1000 * 60 * 15; // 15 minutes

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dl_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plugin_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  logged INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plugin_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

const PLUGINS = [
  { id: 'pre',      name: 'KSAK-Pre',        sub: 'Ultimate Channel Strip', version: 'v0.3.8', img: '/assets/pre.png',      accent: '#0fe08a', file: 'KSAK-Pre-Setup-v0.3.8-TRIAL.exe',              size: 10259266, hook: 'The whole vocal chain, in one strip.', chips: ['10 modules', 'Reorderable', 'Per-module presets', 'MIDI Learn'] },
  { id: 'delay',    name: 'Simple Delay',    sub: 'The Repeat Deck',        version: 'v0.1.6', img: '/assets/delay.png',    accent: '#4da3ff', file: 'KSAK-Simple-Delay-Setup-v0.1.6-TRIAL.exe',   size: 12522153, hook: 'Tape-style echoes, dialed by feel.', chips: ['Tap Tempo', 'Swing', '5-band EQ', 'Trails', 'Freeze'] },
  { id: 'reverb',   name: 'Simple Reverb',   sub: 'The Vault',              version: 'v0.1.5', img: '/assets/reverb.png',   accent: '#44f7e3', file: 'KSAK-Simple-Reverb-Setup-v0.1.5-TRIAL.exe', size: 6700004,  hook: 'Space you can feel, not fight.', chips: ['Size + Mod', '5-band EQ', 'Spectral meter', 'Freeze'] },
  { id: 'omega',    name: 'OMEGA EQ',        sub: 'Flagship EQ',            version: 'v0.1.4', img: '/assets/omega.png',    accent: '#b07dff', file: 'KSAK-Omega-EQ-Setup-v0.1.4-TRIAL.exe',       size: 6198141,  hook: 'Every band, every type, zero clutter.', chips: ['7 filter types', '15 local AI assists', 'EXPAND depth'] },
  { id: 'colossus', name: 'COLOSSUS',        sub: 'Flagship Compressor',    version: 'v0.1.3', img: '/assets/colossus.png', accent: '#c9ccd4', file: 'KSAK-Colossus-Setup-v0.1.3-TRIAL.exe',       size: 15731331, hook: 'A monument of compression.', chips: ['7 circuits', 'Dual Engine', '8-band Multiband', 'Spectral'] },
];
const MODULES = [
  ['Gate', 'Noise Gate'], ['Drive', 'Drive Preamp'], ['Comp', 'Vocal Comp'], ['Dyn EQ', 'Dynamic EQ'],
  ['Multi', 'Multiband'], ['Tone', 'Tone Shaper'], ['Glue', 'Glue Comp'], ['Image', 'Stereo Imager'],
  ['Limit', 'Limiter'], ['Loud', 'Loudness'],
].map(([short, full], i) => ({ n: i + 1, short, full, img: `/assets/module${String(i + 1).padStart(2, '0')}.png` }));

/* ---------- helpers ---------- */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => Date.now();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}
function verifyPassword(password, saltHex, hashHex) {
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use((req, res, next) => { // security headers (helmet-style, manual)
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'",
  });
  if (IS_PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

/* session loading */
app.use((req, res, next) => {
  req.user = null; req.session = null;
  const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('ksak_session='));
  if (token) {
    const row = db.prepare('SELECT s.*, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
      .get(sha256(token.slice('ksak_session='.length)), now());
    if (row) { req.session = row; req.user = { id: row.user_id, name: row.name, email: row.email, role: row.role }; }
  }
  res.locals.user = req.user;
  res.locals.csrf = req.session ? req.session.csrf : '';
  next();
});

function setSessionCookie(res, rawToken) {
  res.setHeader('Set-Cookie', `ksak_session=${rawToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${IS_PROD ? '; Secure' : ''}`);
}
function startSession(res, userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(sha256(raw), userId, crypto.randomBytes(16).toString('hex'), now(), now() + SESSION_TTL_MS);
  setSessionCookie(res, raw);
}
function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/auth?notice=' + encodeURIComponent('Sign in to continue.'));
  next();
}
function requireOwner(req, res, next) {
  if (!req.user) return res.redirect('/auth?notice=' + encodeURIComponent('Sign in to continue.'));
  if (req.user.role !== 'owner') return res.status(403).send(page('Owner only', `<section class="wrap narrow"><h1>Owner access only</h1><p class="muted">This area is restricted to the site owner account.</p></section>`));
  next();
}
function csrfOk(req) {
  if (!req.session) return false;
  const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || '';
  return typeof sent === 'string' && sent.length === req.session.csrf.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf));
}

/* rate limit auth endpoints: 30 attempts / 15 min / IP */
const authHits = new Map();
function authRateLimit(req, res, next) {
  const key = req.ip || 'x';
  const win = authHits.get(key) || [];
  const fresh = win.filter(t => now() - t < 15 * 60 * 1000);
  if (fresh.length >= 30) return res.status(429).send(page('Slow down', `<section class="wrap narrow"><h1>Too many attempts</h1><p class="muted">Please wait a few minutes and try again.</p></section>`));
  fresh.push(now()); authHits.set(key, fresh); next();
}

/* ---------- layout ---------- */
function page(title, body, extra = '') {
  const u = extraUser();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — KSAK Audio</title><meta name="description" content="KSAK Audio Effects Plugin Suite: KSAK-Pre, Simple Delay, Simple Reverb, OMEGA EQ, COLOSSUS. 30-day trials.">
<link rel="icon" href="/img/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32x32.png"><link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16x16.png"><link rel="apple-touch-icon" sizes="180x180" href="/img/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:site_name" content="KSAK Audio"><meta property="og:title" content="${esc(title)} — KSAK Audio"><meta property="og:description" content="KSAK Audio Effects Plugin Suite: KSAK-Pre, Simple Delay, Simple Reverb, OMEGA EQ, COLOSSUS. 30-day trials."><meta property="og:image" content="https://ksakaudio.com/img/ksak-emblem.png">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)} — KSAK Audio"><meta name="twitter:image" content="https://ksakaudio.com/img/ksak-emblem.png">
<style>
:root{--bg:#020a07;--panel:#04120c;--panel2:#06231a;--text:#eef2f5;--muted:#93a89c;--line:#123527;--em:#0fe08a;--mint:#2dffc4;--teal:#44f7e3;--chrome:#c9ccd4}
*{box-sizing:border-box}body{margin:0;background-color:#010503;background-image:radial-gradient(1200px 620px at 72% -10%,#00291b 0%,rgba(0,41,27,0) 58%),radial-gradient(900px 540px at 6% 24%,#002015 0%,rgba(0,32,21,0) 55%),radial-gradient(1100px 720px at 50% 115%,#002015 0%,rgba(0,32,21,0) 60%);color:var(--text);font:16px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
a{color:inherit}.wrap{max-width:1120px;margin:0 auto;padding:0 20px}.narrow{max-width:520px}
header{position:sticky;top:0;backdrop-filter:blur(10px);background:rgba(2,10,7,.85);border-bottom:1px solid var(--line);z-index:10}
.nav{display:flex;align-items:center;gap:22px;padding:14px 0}.logo{font-weight:800;letter-spacing:.22em;font-size:18px}.logo span{background:linear-gradient(180deg,#f7f9fc 0%,var(--chrome) 55%,#8f959f 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none}.brandmark{height:40px;width:40px;border-radius:10px;box-shadow:0 0 18px rgba(15,224,138,.40)}
.herotop{display:flex;gap:36px;align-items:center;flex-wrap:wrap}.heroemblem{width:230px;height:230px;border-radius:28px;box-shadow:0 24px 70px rgba(0,0,0,.6),0 0 110px rgba(15,224,138,.45)}
.foot{display:flex;align-items:center;gap:10px}.footmark{height:22px;width:22px;border-radius:6px}
.nav nav{margin-left:auto;display:flex;gap:18px;align-items:center;flex-wrap:wrap}.nav nav a{text-decoration:none;color:var(--muted);font-size:14px}.nav nav a:hover{color:var(--text)}
.btn{display:inline-block;background:var(--em);color:#000;font-weight:700;border:0;border-radius:10px;padding:10px 18px;text-decoration:none;cursor:pointer;font-size:15px;transition:background .15s,box-shadow .15s}
.btn:hover{background:var(--mint);box-shadow:0 0 24px rgba(45,255,196,.45)}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
.btn.ghost:hover{border-color:var(--em);box-shadow:0 0 16px rgba(15,224,138,.25)}
.btn.locked{background:var(--panel2);color:var(--muted);border:1px solid var(--line);cursor:pointer}
.hero{padding:64px 0 30px;text-align:left}.hero h1{font-size:52px;line-height:1.05;margin:0 0 12px}.hero h1 em{background:linear-gradient(180deg,#ffffff 0%,#c9ccd4 55%,#9399a4 100%);-webkit-background-clip:text;background-clip:text;color:transparent;font-style:normal}
.hero p{color:var(--muted);max-width:560px;font-size:18px}
.stats{display:flex;gap:14px;flex-wrap:wrap;margin:26px 0}.stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 20px}.stat b{font-size:26px;display:block}.stat span{color:var(--muted);font-size:13px}
.heroimg{border-radius:18px;border:1px solid var(--line);box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 90px rgba(15,224,138,.18);width:100%}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px;padding:18px 0 40px}
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:18px;overflow:hidden;transition:border-color .15s,box-shadow .15s}
.card:hover{border-color:rgba(15,224,138,.5);box-shadow:0 0 30px rgba(15,224,138,.14)}
.card img{width:100%;display:block}.card .in{padding:18px}.tag{font-size:12px;letter-spacing:.18em;color:var(--muted);text-transform:uppercase}
.card h3{margin:6px 0 2px;font-size:24px}.hook{color:var(--muted);margin:4px 0 12px}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{border:1px solid var(--line);background:#03130b;border-radius:999px;padding:5px 11px;font-size:13px;color:var(--muted)}
section.blk{padding:42px 0}.blk h2{font-size:34px;margin:0 0 6px}.blk .sub{color:var(--muted);margin:0 0 20px}
.chain{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:18px}
.node{width:58px;height:58px;border-radius:50%;border:2px solid #14532d;background:#04170d;color:#cfe9da;font-weight:700;cursor:pointer;font-size:17px}
.node.on{background:var(--em);color:#02130a;border-color:var(--em);box-shadow:0 0 24px rgba(15,224,138,.5)}
.arrow{color:var(--muted)}
.chainimg{width:100%;max-width:640px;border-radius:16px;border:1px solid var(--line);display:block}
form.card2{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px}
label{display:block;font-size:13px;color:var(--muted);margin:14px 0 6px}input{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:#03130b;color:var(--text);font-size:15px}
input:focus{border-color:var(--em);outline:none;box-shadow:0 0 0 3px rgba(15,224,138,.18)}
.err{background:#3a1420;border:1px solid #7c2740;color:#ffb3c2;border-radius:10px;padding:10px 14px;margin:12px 0}
.ok{background:#123324;border:1px solid #226644;color:#a9ecc9;border-radius:10px;padding:10px 14px;margin:12px 0}
.notice{background:#052117;border:1px solid var(--line);color:var(--muted);border-radius:10px;padding:10px 14px;margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
.dlrow{display:flex;gap:14px;align-items:center;justify-content:space-between;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:10px 0;flex-wrap:wrap;transition:border-color .15s,box-shadow .15s}
.dlrow:hover{border-color:rgba(15,224,138,.4);box-shadow:0 0 20px rgba(15,224,138,.10)}
.muted{color:var(--muted)}footer{border-top:1px solid var(--line);padding:26px 0;color:var(--muted);font-size:14px;margin-top:30px}
@media(max-width:640px){.hero h1{font-size:36px}.heroemblem{width:150px;height:150px}}
</style></head><body>
<header><div class="wrap nav"><a class="brand" href="/"><img class="brandmark" src="/img/ksak-emblem.png" alt="KSAK Audio"><div class="logo">KSAK <span>AUDIO</span></div></a><nav>
<a href="/">Plugins</a><a href="/#pre">KSAK-Pre</a><a href="/#downloads">Downloads</a>
${u ? `<a href="/account">My Account</a>${u.role === 'owner' ? '<a href="/owner">Owner</a>' : ''}
<form method="post" action="/auth/signout" style="display:inline"><input type="hidden" name="_csrf" value="${esc(extraCsrf())}"><button class="btn ghost" type="submit">Sign out</button></form>`
  : `<a href="/auth">Sign in</a><a class="btn" href="/auth?mode=signup">Create account</a>`}
</nav></div></header>
${body}
<footer><div class="wrap foot"><img class="footmark" src="/img/ksak-emblem.png" alt="KSAK Audio"><span>© KSAK Audio · KSAK Audio Effects Plugin Suite · VST3 · Windows</span></div></footer>
</body></html>`;
}
let _locals = { user: null, csrf: '' };
function extraUser() { return _locals.user; }
function extraCsrf() { return _locals.csrf; }
app.use((req, res, next) => { _locals = { user: req.user, csrf: req.session ? req.session.csrf : '' }; next(); });

/* ---------- pages ---------- */
app.get('/', (req, res) => {
  const cards = PLUGINS.map((p, i) => `
  <article class="card" id="${p.id === 'pre' ? 'pre' : ''}">
    <img src="${p.img}" alt="${esc(p.name)} plugin interface" loading="lazy">
    <div class="in">
      <div class="tag">${String(i + 1).padStart(2, '0')} · ${esc(p.sub)} · ${p.version} · 30-Day Trial</div>
      <h3 style="color:${p.accent}">${esc(p.name)}</h3>
      <p class="hook">${esc(p.hook)}</p>
      <div class="chips">${p.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
    </div>
  </article>`).join('');
  const nodes = MODULES.map((m, i) => `${i ? '<span class="arrow">›</span>' : ''}<button class="node${i === 0 ? ' on' : ''}" data-i="${i}" aria-label="Module ${m.n} ${esc(m.full)}">${m.n}</button>`).join('');
  const dl = PLUGINS.map(p => `
    <div class="dlrow"><div><b>${esc(p.name)}</b> <span class="muted">${p.version} TRIAL · ${mb(p.size)} · VST3 · Windows</span></div>
    ${req.user
      ? `<button class="btn" data-dl="${p.id}">Download</button>`
      : `<a class="btn locked" href="/auth?notice=${encodeURIComponent('Create an account or sign in to download trials.')}">🔒 Sign in to download</a>`}
    </div>`).join('');
  res.send(page('KSAK Audio Effects Plugin Suite', `
  <section class="wrap hero">
    <div class="herotop">
      <img class="heroemblem" src="/img/ksak-emblem.png" alt="KSAK Audio emblem">
      <div>
        <h1>Five plugins.<br><em>One suite.</em></h1>
        <p>The KSAK Audio Effects Plugin Suite — a complete vocal chain, two feel-first essentials, and two flagships. Every trial runs 30 days, then locks.</p>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><b>5</b><span>Plugins</span></div>
      <div class="stat"><b>10</b><span>KSAK-Pre modules</span></div>
      <div class="stat"><b>7</b><span>COLOSSUS circuits</span></div>
      <div class="stat"><b>15</b><span>OMEGA local AI assists</span></div>
      <div class="stat"><b>30</b><span>Day free trials</span></div>
    </div>
    <img class="heroimg" src="/assets/pre.png" alt="KSAK-Pre plugin interface">
  </section>
  <section class="wrap"><div class="grid">${cards}</div></section>
  <section class="wrap blk" >
    <h2>KSAK-Pre — the chain</h2>
    <p class="sub">Tap a module. The exact order on a fresh load — Loudness sits last, on purpose.</p>
    <div class="chain">${nodes}</div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
      <img class="chainimg" id="chainImg" src="${MODULES[0].img}" alt="Module panel">
      <div><div class="tag">Module 1 of 10</div><h3 id="chainName" style="margin:6px 0;font-size:28px">${MODULES[0].full}</h3>
      <p class="muted" style="max-width:300px">Every module reorderable, every control on the face. Fresh load at unity does nothing — until you dial it in.</p></div>
    </div>
    <script>var M=${JSON.stringify(MODULES)};document.querySelectorAll('.node').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('.node').forEach(function(x){x.classList.remove('on')});b.classList.add('on');var m=M[+b.dataset.i];document.getElementById('chainImg').src=m.img;document.getElementById('chainName').textContent=m.full;});});</script>
  </section>
  <section class="wrap blk" id="downloads">
    <h2>30-Day Trial Downloads</h2>
    <p class="sub">${req.user ? 'Signed in — downloads are unlocked. Links expire 15 minutes after you tap.' : 'Downloads are members-only. Create a free account — it takes a minute — and the trials unlock. No account, no download: that is the rule.'}</p>
    ${dl}
    <p class="muted" style="font-size:13px">Each trial is a separate build with no unlock inside it: on day 31 it goes silent and locks. Updates and new versions are delivered only through your KSAK account.</p>
    <div id="dlmsg"></div>
    ${req.user ? `<meta name="csrf" content="${esc(req.session.csrf)}"><script>document.querySelectorAll('[data-dl]').forEach(function(b){b.addEventListener('click',function(){b.disabled=true;b.textContent='Preparing…';fetch('/api/download-link',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':document.querySelector('meta[name=csrf]').content},body:JSON.stringify({plugin:b.dataset.dl})}).then(function(r){return r.json()}).then(function(j){if(j.url){window.location=j.url;}else{document.getElementById('dlmsg').innerHTML='<div class="err">'+(j.error||'Something went wrong.')+'</div>';b.disabled=false;b.textContent='Download';}}).catch(function(){b.disabled=false;b.textContent='Download';});});});</script>` : ''}
  </section>`));
});

app.get('/auth', (req, res) => {
  const mode = req.query.mode === 'signup' ? 'signup' : 'signin';
  const err = req.query.error ? `<div class="err">${esc(req.query.error)}</div>` : '';
  const notice = req.query.notice ? `<div class="notice">${esc(req.query.notice)}</div>` : '';
  res.send(page(mode === 'signup' ? 'Create account' : 'Sign in', `
  <section class="wrap narrow" style="padding:44px 20px">
    <h1>${mode === 'signup' ? 'Create your KSAK account' : 'Welcome back'}</h1>
    <p class="muted">${mode === 'signup' ? 'One account for trial downloads, updates, and new versions.' : 'Sign in to download trials and manage your account.'}</p>
    ${err}${notice}
    <form class="card2" method="post" action="/auth/${mode}">
      ${mode === 'signup' ? '<label>Full name</label><input name="name" required autocomplete="name">' : ''}
      <label>Email</label><input name="email" type="email" required autocomplete="email">
      <label>Password</label><input name="password" type="password" required ${mode === 'signup' ? 'minlength="8"' : ''} autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}">
      <div style="margin-top:18px"><button class="btn" type="submit">${mode === 'signup' ? 'Create account' : 'Sign in'}</button></div>
    </form>
    <p class="muted" style="margin-top:14px">${mode === 'signup' ? 'Already have an account? <a href="/auth">Sign in</a>' : 'New here? <a href="/auth?mode=signup">Create an account</a>'}</p>
  </section>`));
});

app.post('/auth/signup', authRateLimit, (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const back = (msg) => res.redirect('/auth?mode=signup&error=' + encodeURIComponent(msg));
  if (!name || !email || password.length < 8) return back('Please enter your name, a valid email, and a password of at least 8 characters.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return back('That email does not look right.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return back('An account with that email already exists. Try signing in.');
  const { salt, hash } = hashPassword(password);
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const role = count === 0 ? 'owner' : 'member';
  const info = db.prepare('INSERT INTO users (name, email, pass_hash, pass_salt, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(name, email, hash, salt, role, new Date().toISOString());
  startSession(res, info.lastInsertRowid);
  res.redirect('/account');
});

app.post('/auth/signin', authRateLimit, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const back = () => res.redirect('/auth?error=' + encodeURIComponent('Email or password is incorrect.'));
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.pass_salt, user.pass_hash)) return back();
  startSession(res, user.id);
  res.redirect('/account');
});

app.post('/auth/signout', (req, res) => {
  if (req.session && csrfOk(req)) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.session.token_hash);
  res.setHeader('Set-Cookie', 'ksak_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.redirect('/');
});

app.get('/account', requireAuth, (req, res) => {
  const history = db.prepare('SELECT * FROM downloads WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  const rows = history.length
    ? history.map(d => { const p = PLUGINS.find(x => x.id === d.plugin_id); return `<tr><td>${esc(p ? p.name : d.plugin_id)}</td><td>${esc(new Date(d.created_at).toLocaleString('en-US'))}</td></tr>`; }).join('')
    : '<tr><td colspan="2" class="muted">No downloads yet.</td></tr>';
  const dl = PLUGINS.map(p => `<div class="dlrow"><div><b>${esc(p.name)}</b> <span class="muted">${p.version} TRIAL · ${mb(p.size)}</span></div><button class="btn" data-dl="${p.id}">Download</button></div>`).join('');
  res.send(page('My Account', `
  <meta name="csrf" content="${esc(req.session.csrf)}">
  <section class="wrap" style="padding:40px 20px">
    <h1>My Account</h1>
    <p class="muted">${esc(req.user.name)} · ${esc(req.user.email)}${req.user.role === 'owner' ? ' · <b>Site owner</b>' : ''}</p>
    <div class="notice">Updates and new versions come only through this account — signed-in here is the one place they are delivered.</div>
    <h2 style="margin-top:30px">Trial downloads</h2>
    ${dl}<div id="dlmsg"></div>
    <h2 style="margin-top:30px">Download history</h2>
    <table><tr><th>Plugin</th><th>When</th></tr>${rows}</table>
  </section>
  <script>document.querySelectorAll('[data-dl]').forEach(function(b){b.addEventListener('click',function(){b.disabled=true;b.textContent='Preparing…';fetch('/api/download-link',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':document.querySelector('meta[name=csrf]').content},body:JSON.stringify({plugin:b.dataset.dl})}).then(function(r){return r.json()}).then(function(j){if(j.url){window.location=j.url;}else{document.getElementById('dlmsg').innerHTML='<div class="err">'+(j.error||'Something went wrong.')+'</div>';b.disabled=false;b.textContent='Download';}});});});</script>`));
});

app.get('/owner', requireOwner, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  const acts = db.prepare('SELECT d.*, u.email FROM downloads d JOIN users u ON u.id = d.user_id ORDER BY d.id DESC LIMIT 100').all();
  const urows = users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(new Date(u.created_at).toLocaleDateString('en-US'))}</td></tr>`).join('');
  const arows = acts.length ? acts.map(d => { const p = PLUGINS.find(x => x.id === d.plugin_id); return `<tr><td>${esc(d.email)}</td><td>${esc(p ? p.name : d.plugin_id)}</td><td>${esc(new Date(d.created_at).toLocaleString('en-US'))}</td></tr>`; }).join('') : '<tr><td colspan="3" class="muted">No downloads yet.</td></tr>';
  res.send(page('Owner', `
  <section class="wrap" style="padding:40px 20px">
    <h1>Owner view</h1>
    <h2>Accounts (${users.length})</h2>
    <table><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr>${urows}</table>
    <h2 style="margin-top:30px">Download activity</h2>
    <table><tr><th>Account</th><th>Plugin</th><th>When</th></tr>${arows}</table>
  </section>`));
});

/* ---------- gated downloads ---------- */
app.post('/api/download-link', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (!csrfOk(req)) return res.status(403).json({ error: 'Session check failed. Reload the page and try again.' });
  const p = PLUGINS.find(x => x.id === (req.body && req.body.plugin));
  if (!p) return res.status(404).json({ error: 'Unknown plugin' });
  const filePath = path.join(DOWNLOADS_DIR, p.file);
  if (!fs.existsSync(filePath)) return res.status(503).json({ error: 'That download is not available right now.' });
  const raw = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO dl_tokens (token_hash, user_id, plugin_id, expires_at, logged) VALUES (?,?,?,?,0)')
    .run(sha256(raw), req.user.id, p.id, now() + DL_TOKEN_TTL_MS);
  res.json({ url: '/dl/' + raw, name: p.file, size: p.size, expiresInMinutes: 15 });
});

app.get('/dl/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM dl_tokens WHERE token_hash = ? AND expires_at > ?').get(sha256(req.params.token), now());
  if (!row) return res.status(403).send(page('Link expired', `<section class="wrap narrow" style="padding:44px 20px"><h1>This download link has expired</h1><p class="muted">Links last 15 minutes. Sign in and tap Download again for a fresh one.</p></section>`));
  const p = PLUGINS.find(x => x.id === row.plugin_id);
  const filePath = path.join(DOWNLOADS_DIR, p.file);
  if (!fs.existsSync(filePath)) return res.status(503).send('Download unavailable.');
  if (!row.logged) {
    db.prepare('UPDATE dl_tokens SET logged = 1 WHERE token_hash = ?').run(row.token_hash);
    db.prepare('INSERT INTO downloads (user_id, plugin_id, created_at) VALUES (?,?,?)').run(row.user_id, p.id, new Date().toISOString());
  }
  res.download(filePath, p.file);
});

app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets'), { maxAge: '7d' }));
app.use('/img', express.static(path.join(__dirname, '..', 'public', 'img'), { maxAge: '7d' }));
app.use((req, res) => res.status(404).send(page('Not found', `<section class="wrap narrow" style="padding:44px 20px"><h1>Not found</h1><p class="muted">That page does not exist. <a href="/">Back to the plugins</a></p></section>`)));

if (require.main === module) app.listen(PORT, '0.0.0.0', () => console.log(`KSAK Audio site listening on :${PORT} (downloads: ${DOWNLOADS_DIR})`));
module.exports = app;
