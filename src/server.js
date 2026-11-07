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
  { id: 'pre',      slug: 'ksak-pre',      name: 'KSAK-Pre',        sub: 'Ultimate Channel Strip', version: 'v0.3.8', img: '/assets/pre.png',      accent: '#0fe08a', file: 'KSAK-Pre-Setup-v0.3.8-TRIAL.exe',              size: 10259266, hook: 'The whole vocal chain, in one strip.', chips: ['10 modules', 'Reorderable', 'Per-module presets', 'MIDI Learn'] },
  { id: 'delay',    slug: 'simple-delay',  name: 'Simple Delay',    sub: 'The Repeat Deck',        version: 'v0.1.6', img: '/assets/delay.png',    accent: '#4da3ff', file: 'KSAK-Simple-Delay-Setup-v0.1.6-TRIAL.exe',   size: 12522153, hook: 'Tape-style echoes, dialed by feel.', chips: ['Tap Tempo', 'Swing', '5-band EQ', 'Trails', 'Freeze'] },
  { id: 'reverb',   slug: 'simple-reverb', name: 'Simple Reverb',   sub: 'The Vault',              version: 'v0.1.5', img: '/assets/reverb.png',   accent: '#44f7e3', file: 'KSAK-Simple-Reverb-Setup-v0.1.5-TRIAL.exe', size: 6700004,  hook: 'Space you can feel, not fight.', chips: ['Size + Mod', '5-band EQ', 'Spectral meter', 'Freeze'] },
  { id: 'omega',    slug: 'omega-eq',      name: 'OMEGA EQ',        sub: 'Flagship EQ',            version: 'v0.1.4', img: '/assets/omega.png',    accent: '#b07dff', file: 'KSAK-Omega-EQ-Setup-v0.1.4-TRIAL.exe',       size: 6198141,  hook: 'Every band, every type, zero clutter.', chips: ['7 filter types', '15 local AI assists', 'EXPAND depth'] },
  { id: 'colossus', slug: 'colossus',      name: 'COLOSSUS',        sub: 'Flagship Compressor',    version: 'v0.1.3', img: '/assets/colossus.png', accent: '#c9ccd4', file: 'KSAK-Colossus-Setup-v0.1.3-TRIAL.exe',       size: 15731331, hook: 'A monument of compression.', chips: ['7 circuits', 'Dual Engine', '8-band Multiband', 'Spectral'] },
  { id: 'chronos',  slug: 'ksak-chronos',  name: 'KSAK CHRONOS',    sub: 'Flagship FX Sequencer',  version: 'v0.1.0', img: '/assets/chronos.png',  accent: '#2dffc4', trial: false, file: null, size: 0, hook: 'RC-20 meets Effectrix on steroids.', chips: ['32-step sequencer', '6 color modules + MAGNET', 'Loop FX engine', 'Pitch + formant shift', '170 factory presets'] },
];

/* In-depth per-plugin page copy. Facts drawn from each plugin's user manual
 * and the suite canon — nothing here is claimed that the manuals do not state. */
const DETAILS = {
  pre: {
    bio: [
      'KSAK-Pre is the whole vocal chain in a single window: noise gate, drive preamp, vocal compressor, dynamic EQ, multiband, tone shaper, glue compressor, stereo imager, limiter and loudness metering — ten modules that each do the job of a classic studio unit, rebuilt as KSAK Audio originals. Mono and stereo, 44.1–192 kHz.',
      'Every module is modeled control-for-control on a classic unit engineers already trust — every knob, switch, range and taper mirrors the original, and the detectors, timing, knees and saturation character are measured against it, then level-matched A/B\u2019d on real material. Where a difference remains, it is documented, never hidden.',
      'The chain is yours to arrange. Drag modules into any order, save per-module presets, and drive the controls from your controller with MIDI Learn. The modules listen to each other through the sidechain, so the chain behaves like a chain — not ten separate plugins pretending to be one.',
      'And it starts honest. A fresh load is UNITY — START CLEAN: every module at neutral, audio passing bit-identical to bypass. The limiter\u2019s lookahead is reported to your DAW, which compensates for it. Flip the header BYPASS or A/B against UNITY any time: if it doesn\u2019t sound better, it isn\u2019t better.',
    ],
    features: [
      '10 modules: Noise Gate · Drive Preamp · Vocal Comp · Dynamic EQ · Multiband · Tone Shaper · Glue Comp · Stereo Imager · Limiter · Loudness',
      'Fully reorderable chain — drag modules into any order',
      'Per-module presets, plus the full factory library',
      'MIDI Learn on the controls',
      'Sidechain interaction between modules',
      'Dynamic EQ: first and last bands carry all seven filter types',
      'True-peak limiter with lookahead and dither',
      'Loudness metering built in — the last module, on purpose',
      'Fresh load is bit-identical to bypass (UNITY — START CLEAN)',
      'Low CPU by design: a module that is off costs nothing — its processing sleeps entirely',
    ],
  },
  delay: {
    bio: [
      'Simple Delay — The Repeat Deck — is a tape-style echo built around one rule: \u201csimple\u201d means simple to use, not simple in power. Every control starts at a true neutral position, so what you hear after you turn a knob is exactly what that knob did. A fresh load is UNITY — START CLEAN: what goes in comes out unchanged, sample for sample.',
      'Five characters cover the echo vocabulary. SLAP is a tight slapback voice with its own feedback character, so a slap stays a slap — one tight bounce and a short tail. DIGITAL is pristine, full-bandwidth repeats. TAPE darkens and gently saturates each pass. ANALOG is bucket-brigade darkness with a lifted low end. PING-PONG bounces the repeats left–right across the stereo field.',
      'Timing runs free from 1 ms to 2 seconds, or locks to your song — quarter, dotted eighth, eighth, triplet — with Tap Tempo for when the host has no tempo to give. Swing pushes every second repeat later until straight echoes become a shuffle. DUCK dips the repeats under the dry signal so they never talk over the vocal, and FREEZE captures the loop and holds it while you play over the top.',
      'The bottom strip is tone: a full 5-band EQ that shapes the repeats only. The dry signal is never touched, and each repeat is EQ\u2019d once, so turning a band up does not compound from repeat to repeat. The twin reels turn while audio plays, and the timeline shows the repeat pattern and the spectrum of the wet signal.',
    ],
    features: [
      '5 modes: SLAP · DIGITAL · TAPE · ANALOG · PING-PONG — each with its own character',
      'Free time 1 ms – 2 s, or tempo sync: 1/4 · dotted 1/8 · 1/8 · triplet',
      'Tap Tempo (a reported host tempo wins; tapped tempo otherwise)',
      'Feedback · Tone · Swing · Width · Mix knobs',
      'MIX LOCK — loading presets changes everything except your mix balance',
      'DUCK — repeats dip under the dry signal automatically',
      'FREEZE — capture the loop and play over it',
      '5-band EQ on the repeats only: draggable graph, per-band bypass',
      'Bands 1 and 5 carry all seven filter types (Bell, shelves, passes, Notch, Band Pass)',
      'TRAILS — tails ring out after bypass; wet-path pan and output trim',
      '23 factory presets; unlimited user presets',
      'Whole-face scaling 50%–200% — every control visible at the default size',
    ],
  },
  reverb: {
    bio: [
      'Simple Reverb — The Vault — holds five spaces one click apart: ROOM, PLATE, HALL, CHAMBER and SPACE. Their characters are measured, not just named: Room is tight and present, the shortest reflections of the five; Plate is bright and dense, the classic vocal and snare plate; Hall is the big public space with a longer decay than the knob reads; Chamber is small, dark and intimate; Space is the vast one, where the tail becomes part of the music.',
      'Nine gold knobs run the space. DECAY sets how long the tail takes to fall into silence — 0.1 to 30 seconds. PRE-DELAY opens a gap so the dry sound stays clear while the space blooms behind it. SIZE is the physical size of the room, independent of decay: decay is how long, size is how big. TONE tilts the tank\u2019s filters, MOD keeps gentle movement inside the tail so long notes feel like they are moving through weather, and WIDTH widens the wet signal only.',
      'DUCK dips the tail while the dry signal is loud and lets it bloom back in the gaps — the reverb that never talks over the vocal. FREEZE stops new audio entering the tank and holds the current space in the air while you play over it. The framed pan section places each side of the wet signal independently, and TRAILS decides what bypass does to the tail.',
      'Shaping happens in two layers, both on the wet path only — the dry signal is never touched. Input high-pass and low-pass filters decide what enters the tank, and a 5-band EQ with a draggable graph shapes the finished tail. While it sounds, the Vault display draws the live spectrum and the tail\u2019s decay curve. A fresh load is UNITY — START CLEAN.',
    ],
    features: [
      '5 algorithms: ROOM · PLATE · HALL · CHAMBER · SPACE',
      'Decay 0.1–30 s · Pre-Delay 0–250 ms (honoured in full at 96/192 kHz) · Size independent of Decay',
      'Tone · Mod · Width (wet signal only) · Mix, with MIX LOCK that stays locked across preset loads',
      'DUCK — the tail dips under the dry signal automatically',
      'FREEZE — hold the space and play over it',
      'Input high-pass (20 Hz – 1 kHz) and low-pass (1–20 kHz) filters on the tank input',
      '5-band EQ on the tail only: draggable graph, per-band bypass, full filter set on bands 1 and 5',
      'Dual pan section: left and right wet pans independent, plus output trim',
      'TRAILS — tails ring out after bypass',
      'Live Vault display: wet spectrum + tail decay curve',
      '23 factory presets; unlimited user presets',
      'Whole-face scaling 50%–200% — every control visible at the default size',
    ],
  },
  omega: {
    bio: [
      'OMEGA EQ is the flagship equalizer: 64 fully independent bands, and every band carries all 17 filter types — Bell, Low Shelf, High Shelf, Low Pass, High Pass, Notch, Band Pass, Tilt Shelf, Flat Tilt, Flat Top, the razor Sword bell, All-Pass, resonant passes, steep passes and Brick Cut. The curves are drawn from the same mathematics that processes the audio, so what you see is literally what you get, right up to Nyquist, with no high-frequency cramping.',
      'Each band can wear one of nine vintage curve characters — exact Digital, Pultec, API, Neve, SSL, Tube, British Console, American Console or Passive — with a Character knob blending in soft saturation on that band\u2019s contribution only. And each band picks its own mode: Static; Dynamic, a full gain computer per band with threshold, range, knee, attack, release, lookahead and a relative-threshold mode; or Spectral, cutting only the FFT bins that poke above the band\u2019s own average.',
      'Then OMEGA goes where equalizers don\u2019t. A full Pitch Engine hears monophonic sources and corrects them to a key and scale — Retune, Flex-Tune, Humanize, formant preserve and shift, Auto-Key, MIDI Target, and a graph mode where a captured take becomes note blocks you drag on a piano roll. The Harmony drawer runs three harmony voices off the corrected lead, each with its own interval, level, formant, pan, width and EQ, alongside the Double Maker, De-Plosive and Breath Control.',
      'A local AI drawer proposes and you dispose: Source ID, the Auto-EQ Assistant, Resonance Hunter, Pitch Brain, Text-to-EQ, the Session Doctor and more — nothing changes your sound until you press ACCEPT, and every model runs on your machine. God View draws every OMEGA in the session on one screen and flags where instances pile up. Two laws run the house: AI proposes, you dispose — and power off is truly off, audio untouched at zero CPU.',
    ],
    features: [
      '64 independent bands (32/64 view; bands 33–64 hold in memory when hidden)',
      'All 17 filter types on every band — passes follow the Butterworth law, −3.01 dB at the cutoff, slopes 6–48 dB/oct',
      '9 vintage curve models per band + per-band Character saturation',
      'Per-band modes: Static · Dynamic (full gain computer, relative threshold, bidirectional) · Spectral',
      'Transient/Sustain split; per-band LFO or envelope motion on gain or frequency',
      'Per-band channels: Stereo · Mid · Side · Left · Right, with Field L/R and Field M/S rotation',
      'Pitch Engine: correction to key/scale, Auto-Key, MIDI Target, graph-mode note editing, Hum-to-Band',
      'Harmony drawer: 3 voices with per-voice EQ; Double Maker · De-Plosive · Breath Control · Vocal God Mode',
      'Local AI: Source ID · Auto-EQ Assistant · Resonance Hunter · Pitch Brain · Text-to-EQ · AI Timing · Translation Predictor · Blind Coach · Session Doctor',
      'Delta audition (global or per-band) · Loudness Match (BS.1770) · God Guard true-peak ceiling · Auto Gain · Gain Scale',
      'God View + Ecosystem Link across instances; Style Memory — local, visible, erasable in one press',
      'Masking Slayer · Layer EQ · Codec Audition · 4 macros (AIR / WARMTH / PRESENCE / GLUE)',
      'Per-band presets; headphone correction curves on bands 61–64',
      '8 colour themes; whole-face scaling 50%–200%',
    ],
  },
  colossus: {
    bio: [
      'KSAK COLOSSUS is the flagship compressor of the suite — the dynamics pair to OMEGA EQ. One instance holds the chain you would normally build from three or four separate plugins, under one preset and one undo history. And the face is a colossus: a monumental statue composition in Imperial Bronze, built flat to the glass, where every part of the statue does a job — the transfer curve lives in its chest, the gain-reduction columns stand at the pedestal\u2019s edge.',
      'Seven circuits, each a way of hearing level and reacting to it. CLEAN is transparent and precise, control without a fingerprint. BUS is RMS-leaning glue in the SSL G-Bus tradition. FET is the fast, forward 1176 character. OPTO rides a performance with the LA-2A\u2019s smooth, program-dependent release. VARI-MU is slow, rich glue whose ratio itself grows as the signal gets louder. VCA PUNCH pushes the middle of the sound at you, tight and controlled. CHAMELEON is the Distressor\u2019s range — extended ratios including NUKE, and the hottest saturation of the seven. Every circuit carries its own Character saturation: per circuit, never forced.',
      'Three architectures run those circuits: Classic; Multiband, with up to 8 bands; and Spectral. The Dual Engine stacks two full engines in one instance — in series, FET into OPTO is the classic vocal chain, or in parallel — with downward and upward compression and a transient/sustain split to aim the work where it belongs.',
      'When the AI has a move to suggest, it draws a dashed ghost curve over your transfer curve with plain-word labels and ACCEPT / REJECT pills — nothing changes until you accept. A fresh load is neutral, identical to bypass; with power off, the engine is not called at all. Free updates for life, per license.',
    ],
    features: [
      '7 circuits: CLEAN · BUS · FET · OPTO · VARI-MU · VCA PUNCH · CHAMELEON — measured pairwise distinct',
      'Per-circuit Character / Saturation, from clean to driven — never forced',
      '3 architectures: Classic · Multiband (up to 8 bands) · Spectral',
      'Dual Engine: two full engines in series (A → B) or parallel (A + B), with LINK',
      'Ratio from below 1:1 expansion through gentle control to 100:1 and Limit behaviour',
      'Threshold · Attack · Release · Knee · Make-Up · Mix · Range — the knee point is grabbable on the graph',
      'Upward and downward compression; transient/sustain split',
      'Focused vocal tools, sidechain with detector EQ, Motion, and macros',
      'Local AI proposal features in plain words — accept, adjust or reject; proposals appear as ghost curves',
      'MATCH loudness-matched compare; preset morphing; God View',
      'Quality modes: ECO · STD · GOD',
      'Whole-face scaling 50%–200% — every control visible at the default size',
    ],
  },
  chronos: {
    teaser: 'The flagship of the suite: a retro-color engine and a 32-step effect sequencer on one game board — pitch correction, a loop lab, a Tone EQ strip and a local AI that proposes while you dispose. Paint effects onto steps, chain patterns from verse to hook to drop, and let MAGNET age the sound — and the face itself — as you turn it up.',
    bio: [
      'KSAK CHRONOS is the flagship FX sequencer — RC-20 meets Effectrix on steroids. A retro-color engine, a 32-step effect sequencer, pitch correction, a loop lab and a local AI, all on one game board in KSAK Emerald. A fresh load is UNITY — START CLEAN: the board is empty and the audio passes bit-identical until you change it.',
      'The left deck is colour: six modules — Noise, Wobble, Distort, Digital, Space and Magnetic — under one master, the MAGNET clock. Turn MAGNET up and the sound is not the only thing that ages: the face itself takes on a seeded patina — fine grain, micro-scratches and recess grime in the Emerald family only — while the clock dial stays pristine and every glyph stays legible. It is display only; the audio never knows.',
      'The centre board is time: 32 steps × 9 lanes — Stutter, Reverse, Scratch, Tape-Stop, X-Loop, Gate, Half-Time, Filter and Pitch — plus a lane per color module. Paint how hard each step hits, set per-step probability so steps fire only sometimes, give each lane its own length and swing for polyrhythm, freeze a lane, and chain the eight pattern pads A–H from verse to hook to drop. Vocal Mode and Drum Mode retune the whole board\u2019s feel for the source in front of it.',
      'The right rail is pitch and loops. The Pitch block tunes to 440, 432 or 444 Hz plus cents, auto-detects note and key, and corrects in Natural or Hard Tune mode with formant preserve — and formant shift that moves the body of the voice on purpose. The Loop FX engine captures a beat or whole bars, slices them onto the 32 steps for reorder, mute, reverse and pitch per slice, and lets you tune and colour the loop separately from the dry.',
      'Under the board sits a Tone EQ strip — high-pass and low-pass knobs with 12/24/48 dB slope selectors, and three bell bands whose shape switches between Bell, Low Shelf, High Shelf and Notch, with a live curve drawn from the true combined response. A dual Quantizer keeps time and pitch honest. The local AI proposes ghost patterns — Pattern Builder, Loop Finder, Pitch Brain, Text-to-FX and more — and your sound does not change until you press ACCEPT. CHRONOS ships with 170 factory presets across nine categories, plus over 100 pattern presets.',
    ],
    features: [
      'Color engine: Noise · Wobble · Distort · Digital · Space · Magnetic, under the MAGNET master clock',
      'MAGNET aging: the face patinas as MAGNET rises — display only, dial stays pristine',
      '32-step sequencer: 9 FX lanes (Stutter · Reverse · Scratch · Tape-Stop · X-Loop · Gate · Half-Time · Filter · Pitch) plus a lane per color module',
      'Per-step amount · per-step probability · per-lane length and swing · Freeze lane',
      'Pattern pads A–H with chaining; 100+ pattern presets',
      'Vocal Mode and Drum Mode lane tunings',
      'Pitch block: tuning 440/432/444 Hz + cents, auto-detect note/key, Natural + Hard Tune correction, formant preserve and per-step formant shift, sequenced pitch lane (−12/+12 semitones)',
      'Loop FX engine: quantized or free capture (1 beat to 8 bars), Reverse, Ping-Pong, Half/Double speed, Slice onto the steps, Freeze/Hold, Overdub + Undo, MIDI retrigger, drag-out WAV',
      'FX batch: granular chop, buffer shuffle, slip and stretch, shimmer/reverse/gated/spring/plate reverb, spectral freeze and blur, chorus/flanger/phaser/tremolo, DJ filter, multiband distortion, wavefold, bitcrush, width and pump sequencers',
      'Tone EQ strip: HP + LP with slope selectors, 3 shape-switching bands, live true-response curve',
      'Dual Quantizer: Time (grid, strength, swing/groove) + Pitch (key/scale lock, glide)',
      'Local AI: Pattern Builder · Source ID · Loop Finder · Pitch Brain · Fill & Transition Builder · Text-to-FX · Smart Randomizer · Clean-Up · Style Memory — AI proposes, you dispose',
      'XY Morph pad + 8 macros; reorderable FX chain',
      '170 factory presets: Vocals 25 · Drums 20 · Melody/Keys 20 · Loops/Samples 20 · Transitions & Fills 20 · Extreme/Sound Design 20 · Guitar 15 · Bass 15 · Full Beat/Mix Bus 15',
      'Zero-Latency tracking mode · high-quality oversampling mode · Eco CPU mode · on-face CPU meter',
      'Whole-face scaling 50%–200% — every control visible at the default size',
    ],
  },
};
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
/* Decorative side rails: fill the wide-screen margins beside the centered
 * column. Pure CSS/art dressing — pointer-events off, aria-hidden, and
 * display:none below 1280px so phones keep the single-column layout. */
function sideRails() {
  const faces = PLUGINS.map(p => `<img src="${p.img}" alt="" loading="lazy">`).join('');
  return `<div class="rail rail-l" aria-hidden="true"><div class="glow"></div><img class="rail-emblem" src="/img/ksak-emblem.png" alt=""><div class="rail-text">KSAK Audio · Effects Plugin Suite</div></div>
<div class="rail rail-r" aria-hidden="true"><div class="glow"></div><div class="rail-faces">${faces}</div><img class="rail-emblem" src="/img/ksak-emblem.png" alt=""><div class="rail-text">VST3 · Windows · 30-Day Trials</div></div>`;
}
function page(title, body, extra = '') {
  const u = extraUser();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — KSAK Audio</title><meta name="description" content="KSAK Audio Effects Plugin Suite: KSAK-Pre, Simple Delay, Simple Reverb, OMEGA EQ, COLOSSUS, KSAK CHRONOS. 30-day trials.">
<link rel="icon" href="/img/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32x32.png"><link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16x16.png"><link rel="apple-touch-icon" sizes="180x180" href="/img/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:site_name" content="KSAK Audio"><meta property="og:title" content="${esc(title)} — KSAK Audio"><meta property="og:description" content="KSAK Audio Effects Plugin Suite: KSAK-Pre, Simple Delay, Simple Reverb, OMEGA EQ, COLOSSUS, KSAK CHRONOS. 30-day trials."><meta property="og:image" content="https://ksakaudio.com/img/ksak-emblem.png">
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
.feature{display:grid;grid-template-columns:1.25fr 1fr;gap:30px;align-items:center;background:linear-gradient(180deg,#07271a,var(--panel));border:1px solid rgba(45,255,196,.45);border-radius:20px;padding:26px;margin:34px 0 6px;box-shadow:0 0 46px rgba(45,255,196,.16)}
.feature img{width:100%;border-radius:14px;border:1px solid var(--line);display:block}
.feature h2{font-size:40px;margin:6px 0 4px;color:var(--mint)}
.feature .hook{font-size:19px;color:var(--text);margin:0 0 10px}
.feature p{color:var(--muted);margin:0 0 16px}
.feature .row{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:16px}
.pnav{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 22px}
.pnav a{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:7px 14px;font-size:14px;color:var(--muted);text-decoration:none}
.pnav a:hover{color:var(--text);border-color:var(--em)}
.pnav a.on{color:#02130a;background:var(--em);border-color:var(--em);font-weight:700}
.bio p{color:#c8d6cd;max-width:780px;font-size:17px;margin:0 0 16px}
ul.feat{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:10px 26px}
ul.feat li{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px;color:#c8d6cd;font-size:15px}
ul.feat li::before{content:'▸ ';color:var(--em);font-weight:700}
.prevnext{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:34px}
.prevnext a{color:var(--muted);text-decoration:none;font-size:15px}.prevnext a:hover{color:var(--text)}
.cardlink{display:inline-block;margin-top:14px;color:var(--em);text-decoration:none;font-weight:600;font-size:15px}
.cardlink:hover{color:var(--mint)}
@media(max-width:760px){.feature{grid-template-columns:1fr}.feature h2{font-size:30px}}
.carousel{position:relative;border:1px solid var(--line);border-radius:20px;overflow:hidden;background:linear-gradient(180deg,var(--panel2),var(--panel))}
.ctrack{display:flex;transition:transform .45s ease}
.cslide{min-width:100%;padding:0}
.cslide img{width:100%;display:block}
.cslide .in{padding:20px 24px 26px}
.cslide h3{margin:6px 0 2px;font-size:30px}
.cbtn{position:absolute;top:38%;width:46px;height:46px;border-radius:50%;border:1px solid var(--line);background:rgba(2,10,7,.82);color:var(--text);font-size:22px;cursor:pointer;line-height:1}
.cbtn:hover{border-color:var(--em);color:var(--mint)}
.cprev{left:14px}.cnext{right:14px}
.cdots{display:flex;gap:8px;justify-content:center;padding:0 0 18px}
.cdot{width:11px;height:11px;border-radius:50%;border:1px solid var(--line);background:var(--panel2);cursor:pointer;padding:0}
.cdot.on{background:var(--em);border-color:var(--em)}
.videoframe{aspect-ratio:16/9;border:1.5px dashed #1d5c40;border-radius:18px;background:radial-gradient(700px 320px at 50% 0%,#04241a 0%,rgba(4,36,26,0) 70%),var(--panel);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:24px}
.videoframe .play{width:74px;height:74px;border-radius:50%;border:2px solid var(--em);color:var(--mint);display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 0 30px rgba(15,224,138,.30)}
.videoframe h3{margin:6px 0 0;font-size:26px}.videoframe p{color:var(--muted);max-width:520px;margin:0}
@media(max-width:640px){.hero h1{font-size:36px}.heroemblem{width:150px;height:150px}}
.rail{position:fixed;top:0;bottom:0;width:calc((100vw - 1160px)/2);z-index:0;pointer-events:none;overflow:hidden;display:none}
.rail-l{left:0}.rail-r{right:0}
.rail::before{content:'';position:absolute;inset:0;background-image:radial-gradient(rgba(15,224,138,.13) 1px,transparent 1.4px);background-size:22px 22px;opacity:.5}
.rail::after{content:'';position:absolute;top:0;bottom:0;width:1px;background:linear-gradient(180deg,rgba(15,224,138,0) 0%,rgba(15,224,138,.38) 30%,rgba(45,255,196,.38) 70%,rgba(15,224,138,0) 100%)}
.rail-l::after{right:0}.rail-r::after{left:0}
.rail .glow{position:absolute;left:50%;top:32%;width:340px;height:340px;transform:translate(-50%,-50%);background:radial-gradient(closest-side,rgba(15,224,138,.13),rgba(15,224,138,0) 72%)}
.rail-r .glow{top:auto;bottom:4%;transform:translate(-50%,0)}
.rail-emblem{position:absolute;left:50%;transform:translateX(-50%);width:min(320px,86%);opacity:.08;display:none}
.rail-l .rail-emblem{top:12%}
.rail-r .rail-emblem{bottom:4%}
.rail-text{position:absolute;top:50%;transform:translateY(-50%);writing-mode:vertical-rl;letter-spacing:.42em;font-size:11px;font-weight:700;text-transform:uppercase;color:rgba(45,255,196,.34);white-space:nowrap}
.rail-l .rail-text{right:16px}
.rail-r .rail-text{left:16px;transform:translateY(-50%) rotate(180deg)}
.rail-faces{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);display:none;flex-direction:column;gap:12px;align-items:center;width:100%}
.rail-faces img{width:min(132px,72%);border:1px solid var(--line);border-radius:10px;opacity:.55;box-shadow:0 10px 26px rgba(0,0,0,.45)}
@media(min-width:1280px){.rail{display:block}}
@media(min-width:1560px){.rail-faces{display:flex}}
@media(min-width:1760px){.rail-emblem{display:block}}
</style></head><body>
${sideRails()}
<header><div class="wrap nav"><a class="brand" href="/"><img class="brandmark" src="/img/ksak-emblem.png" alt="KSAK Audio"><div class="logo">KSAK <span>AUDIO</span></div></a><nav>
<a href="/">Plugins</a><a href="/showcase">Showcase</a><a href="/#pre">KSAK-Pre</a><a href="/#downloads">Downloads</a>
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
      <div class="tag">${String(i + 1).padStart(2, '0')} · ${esc(p.sub)} · ${p.version}${p.trial === false ? '' : ' · 30-Day Trial'}</div>
      <h3 style="color:${p.accent}">${esc(p.name)}</h3>
      <p class="hook">${esc(p.hook)}</p>
      <div class="chips">${p.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <a class="cardlink" href="/plugins/${p.slug}">Full details →</a>
    </div>
  </article>`).join('');
  const chronos = PLUGINS.find(p => p.id === 'chronos');
  const chronosFeature = `
  <section class="wrap" id="chronos-feature">
    <div class="feature">
      <img src="${chronos.img}" alt="KSAK CHRONOS plugin interface" loading="lazy">
      <div>
        <div class="tag">Flagship Spotlight · 06 · ${esc(chronos.sub)} · ${chronos.version}</div>
        <h2>${esc(chronos.name)}</h2>
        <p class="hook">${esc(chronos.hook)}</p>
        <p>${esc(DETAILS.chronos.teaser)}</p>
        <div class="chips">${chronos.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
        <div class="row">
          <a class="btn" href="/plugins/${chronos.slug}">Explore KSAK CHRONOS →</a>
          <button class="btn locked" disabled>Trial coming soon</button>
        </div>
      </div>
    </div>
  </section>`;
  const nodes = MODULES.map((m, i) => `${i ? '<span class="arrow">›</span>' : ''}<button class="node${i === 0 ? ' on' : ''}" data-i="${i}" aria-label="Module ${m.n} ${esc(m.full)}">${m.n}</button>`).join('');
  const dl = PLUGINS.map(p => p.trial === false ? `
    <div class="dlrow"><div><b>${esc(p.name)}</b> <span class="muted">${p.version} · VST3 · Windows</span></div>
    <button class="btn locked" disabled>Trial coming soon</button>
    </div>` : `
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
        <h1>Six plugins.<br><em>One suite.</em></h1>
        <p>The KSAK Audio Effects Plugin Suite — a complete vocal chain, two feel-first essentials, and three flagships. Every trial runs 30 days, then locks.</p>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><b>6</b><span>Plugins</span></div>
      <div class="stat"><b>10</b><span>KSAK-Pre modules</span></div>
      <div class="stat"><b>7</b><span>COLOSSUS circuits</span></div>
      <div class="stat"><b>15</b><span>OMEGA local AI assists</span></div>
      <div class="stat"><b>170</b><span>CHRONOS factory presets</span></div>
      <div class="stat"><b>30</b><span>Day free trials</span></div>
    </div>
  </section>
  ${chronosFeature}
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
  const dl = PLUGINS.map(p => p.trial === false
    ? `<div class="dlrow"><div><b>${esc(p.name)}</b> <span class="muted">${p.version} · VST3 · Windows</span></div><button class="btn locked" disabled>Trial coming soon</button></div>`
    : `<div class="dlrow"><div><b>${esc(p.name)}</b> <span class="muted">${p.version} TRIAL · ${mb(p.size)}</span></div><button class="btn" data-dl="${p.id}">Download</button></div>`).join('');
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

/* ---------- per-plugin pages ---------- */
function dlRow(p, user) {
  return p.trial === false ? `
    <div class="dlrow"><div><b>${esc(p.name)}</b> <span class="muted">${p.version} · VST3 · Windows</span></div>
    <button class="btn locked" disabled>Trial coming soon</button>
    </div>` : `
    <div class="dlrow"><div><b>${esc(p.name)}</b> <span class="muted">${p.version} TRIAL · ${mb(p.size)} · VST3 · Windows</span></div>
    ${user
      ? `<button class="btn" data-dl="${p.id}">Download</button>`
      : `<a class="btn locked" href="/auth?notice=${encodeURIComponent('Create an account or sign in to download trials.')}">🔒 Sign in to download</a>`}
    </div>`;
}
const DL_SCRIPT = `<script>document.querySelectorAll('[data-dl]').forEach(function(b){b.addEventListener('click',function(){b.disabled=true;b.textContent='Preparing…';fetch('/api/download-link',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':document.querySelector('meta[name=csrf]').content},body:JSON.stringify({plugin:b.dataset.dl})}).then(function(r){return r.json()}).then(function(j){if(j.url){window.location=j.url;}else{document.getElementById('dlmsg').innerHTML='<div class="err">'+(j.error||'Something went wrong.')+'</div>';b.disabled=false;b.textContent='Download';}}).catch(function(){b.disabled=false;b.textContent='Download';});});});</script>`;

app.get('/plugins/:slug', (req, res, next) => {
  const idx = PLUGINS.findIndex(p => p.slug === req.params.slug);
  if (idx < 0) return next();
  const p = PLUGINS[idx];
  const d = DETAILS[p.id];
  const prev = PLUGINS[(idx + PLUGINS.length - 1) % PLUGINS.length];
  const nxt = PLUGINS[(idx + 1) % PLUGINS.length];
  const pnav = PLUGINS.map(q => `<a href="/plugins/${q.slug}"${q.id === p.id ? ' class="on"' : ''}>${esc(q.name)}</a>`).join('');
  res.send(page(p.name, `
  <section class="wrap" style="padding:36px 20px 10px">
    <nav class="pnav">${pnav}</nav>
    <img class="heroimg" src="${p.img}" alt="${esc(p.name)} plugin interface">
    <div class="tag" style="margin-top:24px">${String(idx + 1).padStart(2, '0')} · ${esc(p.sub)} · ${p.version}${p.trial === false ? '' : ' · 30-Day Trial'}</div>
    <h1 style="color:${p.accent};font-size:46px;line-height:1.08;margin:8px 0 4px">${esc(p.name)}</h1>
    <p class="hook" style="font-size:20px">${esc(p.hook)}</p>
    <div class="bio">${d.bio.map(t => `<p>${esc(t)}</p>`).join('')}</div>
    <h2 style="font-size:30px;margin:30px 0 14px">Features</h2>
    <ul class="feat">${d.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    <h2 style="font-size:30px;margin:36px 0 6px">${p.trial === false ? 'Availability' : '30-Day Trial Download'}</h2>
    <p class="sub muted" style="margin:0 0 14px">${p.trial === false
      ? 'CHRONOS is the newest member of the suite. Its trial build is not available yet — the other five plugins\u2019 trials are live for members today.'
      : 'Members-only, like every KSAK trial. Create a free account and the download unlocks; links expire 15 minutes after you tap. On day 31 the trial goes silent and locks.'}</p>
    ${dlRow(p, req.user)}
    <div id="dlmsg"></div>
    ${req.user && p.trial !== false ? `<meta name="csrf" content="${esc(req.session.csrf)}">${DL_SCRIPT}` : ''}
    <div class="prevnext">
      <a href="/plugins/${prev.slug}">← ${esc(prev.name)}</a>
      <a href="/#downloads">All downloads</a>
      <a href="/plugins/${nxt.slug}">${esc(nxt.name)} →</a>
    </div>
  </section>`));
});

/* ---------- showcase: interactive slides + video ---------- */
app.get('/showcase', (req, res) => {
  const slides = PLUGINS.map((p, i) => `
    <div class="cslide" role="group" aria-label="Slide ${i + 1} of ${PLUGINS.length}: ${esc(p.name)}">
      <img src="${p.img}" alt="${esc(p.name)} plugin interface" loading="lazy">
      <div class="in">
        <div class="tag">${String(i + 1).padStart(2, '0')} · ${esc(p.sub)} · ${p.version}</div>
        <h3 style="color:${p.accent}">${esc(p.name)}</h3>
        <p class="hook">${esc(p.hook)}</p>
        <a class="cardlink" href="/plugins/${p.slug}">Full details →</a>
      </div>
    </div>`).join('');
  const dots = PLUGINS.map((p, i) => `<button class="cdot${i === 0 ? ' on' : ''}" data-go="${i}" aria-label="Go to ${esc(p.name)}"></button>`).join('');
  res.send(page('Showcase', `
  <section class="wrap hero" style="padding-bottom:6px">
    <h1>The <em>Showcase</em></h1>
    <p>Six plugins, one suite — flip through the faces, then watch this space for sound.</p>
  </section>
  <section class="wrap" style="padding-bottom:10px">
    <div class="carousel" id="ksakCarousel">
      <div class="ctrack" id="ksakTrack">${slides}</div>
      <button class="cbtn cprev" id="ksakPrev" aria-label="Previous plugin">‹</button>
      <button class="cbtn cnext" id="ksakNext" aria-label="Next plugin">›</button>
      <div class="cdots">${dots}</div>
    </div>
    <p class="muted" style="font-size:13px;margin-top:10px">Use the arrows, the dots, or your keyboard's ← → keys.</p>
    <script>
    (function(){
      var track=document.getElementById('ksakTrack'),slides=track.children.length,i=0,timer=null;
      var dots=document.querySelectorAll('.cdot');
      function go(n){i=(n+slides)%slides;track.style.transform='translateX('+(-i*100)+'%)';dots.forEach(function(d,k){d.classList.toggle('on',k===i)});}
      function auto(){stop();timer=setInterval(function(){go(i+1);},6000);}
      function stop(){if(timer){clearInterval(timer);timer=null;}}
      document.getElementById('ksakNext').addEventListener('click',function(){go(i+1);auto();});
      document.getElementById('ksakPrev').addEventListener('click',function(){go(i-1);auto();});
      dots.forEach(function(d){d.addEventListener('click',function(){go(+d.dataset.go);auto();});});
      document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'){go(i+1);auto();}else if(e.key==='ArrowLeft'){go(i-1);auto();}});
      var c=document.getElementById('ksakCarousel');
      c.addEventListener('mouseenter',stop);c.addEventListener('mouseleave',auto);
      c.addEventListener('focusin',stop);c.addEventListener('focusout',auto);
      auto();
    })();
    </script>
  </section>
  <section class="wrap blk" id="showcase-video">
    <h2>Watch</h2>
    <p class="sub">Sound first: walkthroughs and audio demos for every plugin in the suite.</p>
    <!-- Video slot: no KSAK product video exists yet. When one is published,
         drop the YouTube embed iframe in place of the .videoframe block below. -->
    <div class="videoframe">
      <div class="play">▶</div>
      <h3>Showcase videos coming soon</h3>
      <p>Walkthroughs, preset tours and sound demos for all six plugins are in production. When the first video lands, it plays right here.</p>
    </div>
  </section>`));
});

/* ---------- gated downloads ---------- */
app.post('/api/download-link', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (!csrfOk(req)) return res.status(403).json({ error: 'Session check failed. Reload the page and try again.' });
  const p = PLUGINS.find(x => x.id === (req.body && req.body.plugin));
  if (!p) return res.status(404).json({ error: 'Unknown plugin' });
  if (!p.file) return res.status(503).json({ error: 'That download is not available right now.' });
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
