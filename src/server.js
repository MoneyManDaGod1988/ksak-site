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
  { id: 'chronos',  slug: 'ksak-chronos',  name: 'KSAK CHRONOS',    sub: 'Flagship FX Sequencer',  version: 'v0.1.0', img: '/assets/chronos.png',  accent: '#2dffc4', file: 'KSAK-CHRONOS-Setup-v0.1.0-TRIAL.exe', size: 22951728, hook: 'RC-20 meets Effectrix on steroids.', chips: ['32-step sequencer', '6 color modules + MAGNET', 'Loop FX engine', 'Pitch + formant shift', '170 factory presets'] },
];

/* In-depth per-plugin page copy. Facts drawn from each plugin's user manual
 * and the suite canon — nothing here is claimed that the manuals do not state. */
const DETAILS = {
  pre: {
    teaser: 'The whole vocal chain in a single window: ten modules that each do the job of a classic studio unit, rebuilt as KSAK Audio originals — reorderable, MIDI-learnable, and bit-identical to bypass on a fresh load.',
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
    teaser: 'A tape-style echo built around one rule: simple means simple to use, not simple in power. Five characters, tempo sync with tap tempo, ducking, freeze — and a 5-band EQ that shapes the repeats only.',
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
    teaser: 'Five spaces one click apart — ROOM, PLATE, HALL, CHAMBER and SPACE — with nine gold knobs, ducking, freeze, and two layers of shaping that never touch the dry signal.',
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
    teaser: '64 fully independent bands, every one carrying all 17 filter types — plus a pitch engine, a harmony drawer, and a local AI that proposes while you dispose.',
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
    teaser: 'Seven circuits, three architectures and a Dual Engine: the dynamics chain you would normally build from three or four plugins, held in one instance under one preset.',
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
/* ---------- module explorer data ----------
 * Every plugin's modules/sections, drawn from its delivered manual (the same
 * sources as DETAILS): KSAK-Pre User Manual v0.3.9 booklet; Simple Delay
 * Manual v0.1.7; Simple Reverb Manual v0.1.6; OMEGA EQ Visual Manual v0.1.10;
 * COLOSSUS Manual v0.1.6; KSAK CHRONOS User Manual Ed. 1.2 + locked spec.
 * Visuals are true crops of each plugin's own shipped face (public/assets),
 * or the full face where a section lives in a drawer off the resting face. */
const EXPLORERS = {
  pre: [
    { slug: 'noise-gate', full: 'Noise Gate', img: '/assets/module01.png',
      desc: 'The bouncer at the door of the chain: lets the voice through and closes on the noise between phrases.',
      body: ['The bouncer at the door of the chain: it lets the voice through and closes on the noise between phrases. Cleans the gaps first — bleed and room noise between phrases are silenced before the rest of the chain ever hears them. The status line at the bottom shows live ATTENUATION.',
             'A KSAK Audio original — no single classic unit was copied. It is the studio-standard gate workflow (threshold, attack, hold, release) built for this strip and voiced for vocals, with a key filter that focuses the gate’s hearing on the voice band so rumble doesn’t hold it open.'],
      controls: ['THRESH — level below which the gate starts to close (−80 to 0 dB)', 'RANGE — how far the gate closes (0 to −80 dB); 0 = never touches the signal', 'ATTACK — how fast it opens (0.01–100 ms)', 'HOLD — how long it stays open after the signal drops (0–2000 ms)', 'RELEASE — how smoothly it closes (10–2000 ms)', 'HYSTER — hysteresis, so the gate doesn’t chatter on borderline sounds (0–12 dB)', 'LOOKAHD — lookahead, so transients aren’t clipped (0–5 ms)', 'KEY FRQ — sidechain key filter (20 Hz–10 kHz), plus KEY LISTEN to hear the key signal'] },
    { slug: 'drive-preamp', full: 'Drive Preamp', img: '/assets/module02.png',
      desc: 'Console drive and musical EQ: warmth and shape before any compression touches the signal.',
      body: ['The first color in the chain: console drive, EQ and fader trims that warm a vocal up before compression touches it. Every EQ band has its own Gain knob (±15 dB) and Frequency knob.',
             'Modeled after the Scheps 73 (Waves) — Waves’ model of the Neve 1073 console channel Andrew Scheps made famous. KSAK-Pre captures its harmonic drive, EQ bands, high-pass filter and IN / OUT faders.'],
      controls: ['DRIVE — harmonic drive (0–100%); 0 = clean, completely neutral', 'PREAMP — overall level through the module (−24 to +24 dB)', 'HIGH G / HIGH F — high shelf gain, and its frequency (6–18 kHz)', 'MID G / MID F — mid bell gain, and its frequency (200 Hz–6 kHz)', 'LOW G / LOW F — low shelf gain, and its frequency (40–400 Hz)', 'HP G / HP F — high-pass band gain, and its frequency (20–400 Hz)', 'IN L / IN R · OUT L / OUT R — per-channel trims (±12 dB)'] },
    { slug: 'vocal-comp', full: 'Vocal Comp', img: '/assets/module03.png',
      desc: 'Three sliders, one job — a vocal that sits still in the mix.',
      body: ['The lead-vocal leveler: one gesture rides a vocal to the front of the mix and keeps it there, phrase after phrase. Three sliders, read against the printed tick scale, and the status line shows live GAIN REDUCTION.',
             'Modeled after R-Vox / Renaissance Vox (Waves) — the industry-standard one-knob vocal compressor. KSAK-Pre captures its compression, gate and gain riding in a single control, tuned so vocals stay upfront without sounding squeezed.'],
      controls: ['GATE slider — a gentle energy gate that tidies pauses (0 to −70 dB)', 'COMP slider — the amount of compression (0–100); 0 = none', 'GAIN slider — make-up gain after compression (−∞ to +24 dB)', 'Status line — live GAIN REDUCTION in dB'] },
    { slug: 'dynamic-eq', full: 'Dynamic EQ', img: '/assets/module04.png',
      desc: 'Seven bands that can move on their own — surgical EQ that reacts only when the voice does.',
      body: ['Surgical EQ that moves only when the voice does: seven bands, each with dynamic gain that answers the signal. The knobs edit only the selected band (white ring); the bright curve on the graph is live — static shape plus each band’s dynamic movement as it happens.',
             'Modeled after the Kirchhoff EQ (Three-Body Technology). Bands 1 and 7 can change shape — Bell, Low Shelf, High Shelf, Low Pass, High Pass, Notch, Band Pass — and on the pass types the dynamics move the cutoff instead of the gain. Measured in the 0.3.9 sweep: every type on bands 1 and 7 was driven through the plugin and matched its labelled curve (worst error 0.23 dB).'],
      controls: ['Band buttons 1–7 + the EQ graph — drag nodes for frequency/gain, wheel for Q', 'FREQ — the selected band’s frequency (20 Hz–20 kHz)', 'GAIN — its static gain (±15 dB)', 'Q — its width (0.3–30)', 'DYN — how far the band moves when triggered (±15 dB)', 'THRESH — the level that triggers the movement (−60 to 0 dB)', 'ATTACK — how fast the movement arrives (0–500 ms)', 'RELEASE — how fast it lets go (5–2000 ms)', 'Per-band BYPASS and SOLO'] },
    { slug: 'multiband', full: 'Multiband', img: '/assets/module05.png',
      desc: 'Four-band compression with a crossover display: tame one part of the spectrum without touching the rest.',
      body: ['Four compressors in one module, one per frequency zone — lows, mids and air each get their own control. The crossover graph draws the four bands’ crossover shapes with the same Linkwitz-Riley 4th-order math the engine runs; where the curves cross is a crossover point.',
             'Modeled after the MC404 (McDSP) — McDSP’s four-band compressor workhorse. KSAK-Pre captures its crossover workflow: per-band threshold, ratio, knee, bite and gain, over draggable crossovers.'],
      controls: ['Band buttons 1–4 — the knobs below edit only the selected band', 'Crossover grips X1 · X2 · X3 — drag to move a crossover (X1 40–800 Hz · X2 400 Hz–4 kHz · X3 4–16 kHz)', 'GAIN — the selected band’s level (−∞ to +12 dB)', 'THRESH — where its compression starts (−48 to 0 dB)', 'RATIO — how hard it squeezes (1:1–20:1)', 'KNEE — how softly compression arrives (0–100%)', 'BITE — transient emphasis for the band (0–100)', 'ATTACK — 0.1–300 ms · RELEASE — 10–1000 ms', 'GR strip — live gain-reduction metering, one cell per band'] },
    { slug: 'tone-shaper', full: 'Tone Shaper', img: '/assets/module06.png',
      desc: 'Six bands with plain-language names, plus a row of color knobs — a vocal’s whole character in a few big, musical moves.',
      body: ['Parallel tone shaping: blend the direct signal with four bands of body, warmth and air until the character sits right. Each fader reads against the printed tick scale; each band also has a FREQ select and its own ON switch under the faders.',
             'Modeled after the Manny Marroquin Tone Shaper (Waves) — Manny Marroquin’s parallel-EQ tone box, where a vocal’s whole character turns on a few big, musical moves.'],
      controls: ['DIRECT — 1 kHz low shelf: body of the voice in the mix', 'LOW — 100 Hz high shelf: fullness when up, mud control when down', 'LO-MID — 200 Hz bell: boxiness lives here', 'HI-MID — 1 kHz bell: presence and bite', 'HIGH — 8 kHz low shelf: brightness and air', 'WIDTH — Hardy-style shelf: perceived width of the track (inactive in MONO mode)', 'FREQ selects & band ON — each band picks its working frequency, and switches on its own', 'Color knobs — WARMTH · DISTORTION · SATURATION · GRIT · BRIGHTNESS (all 0–100, all neutral at 0)', 'INPUT / OUTPUT — level trims into and out of the module (±24 dB)'] },
    { slug: 'glue-comp', full: 'Glue Comp', img: '/assets/module07.png',
      desc: 'The compressor that makes many parts feel like one thing.',
      body: ['The handshake: gentle bus compression that glues a vocal — or a whole mix — into one piece. The status line at the bottom shows live GAIN REDUCTION.',
             'Modeled after the SSL G-Master Buss Compressor (Waves) — Waves’ model of the SSL 4000 G-series bus compressor, the sound of records sticking together. KSAK-Pre captures its threshold, ratio, attack, release, makeup and blend.'],
      controls: ['THRESH — where compression starts (−40 to +20 dB)', 'MAKE-UP — level back after compression (0 to +20 dB)', 'RELEASE — 0.1–1.2 s, or AUTO REL', 'SC FILT — sidechain high-pass (20–500 Hz): keeps low end from driving the compressor', 'MIX — parallel blend: dry signal mixed back in (0–100%)', 'TRIM — output trim (−20 to +20 dB)', 'ATTACK — step control: 0.1 / 0.3 / 1 / 3 / 10 / 30 ms', 'RATIO — step control: 2 / 4 / 10 / 20', 'ANALOG — switches the classic modeled behavior'] },
    { slug: 'stereo-imager', full: 'Stereo Imager', img: '/assets/module08.png',
      desc: 'Placement and width for stereo material: widen backing stacks, keep the lead focused.',
      body: ['Places the voice in width: widen backing stacks, keep the lead focused, and check the image stays honest. The horizontal sliders read against the printed tick scale, and the status line shows live OUT peaks (L / R, or M / S when METER MODE is M-S). In MONO mode the imager rests.',
             'Modeled after the S1 Stereo Imager (Waves) — the classic stereo width tool. KSAK-Pre captures its width and imaging controls: spread a stereo vocal or stack without losing the center that carries it.'],
      controls: ['GAIN fader — stereo level (−∞ to +12 dB)', 'WIDTH fader — stereo spread: 0 = mono-sum, 1.00 = untouched, up to 1.26', 'ASYMMETRY — balance the image’s energy (−100 to +100)', 'ROTATION — tilt the image back to centre (−100 to +100)', 'INPUT MODE — L-R or M-S: how the module reads the incoming field', 'SWAP — exchange left and right', 'INV L / INV R — invert one side’s polarity (diagnostic tools)', 'METER MODE — L-R or M-S: which peaks the status line publishes'] },
    { slug: 'limiter', full: 'Limiter', img: '/assets/module09.png',
      desc: 'The ceiling nothing crosses — brickwall limiting that sets exactly how loud the vocal is allowed to get.',
      body: ['The ceiling: brickwall limiting that sets exactly how loud the vocal is allowed to get, and not a dB more. Keep it near the end of the chain. Both faders read against the printed tick scale, and the status line shows live ATTENUATION.',
             'Modeled after the L2 UltraMaximizer (Waves) — the mastering limiter that defined the loudness era. KSAK-Pre captures its ceiling-and-release workflow: set the top, push the vocal into it, stay clean.'],
      controls: ['THRESH fader — how hard you drive into the limiter (0 to −30 dB)', 'CEILING fader — the maximum output level (0 to −30 dB); set −1.0 dB for anything headed to streaming or a lossy codec', 'RELEASE — 0.01–1000 ms', 'ARC — auto release control: the release adapts to the program', 'QUANTIZE — final-stage word length: Off / 24 / 20 / 18 / 16 bit', 'DITHER — None / Type 1 / Type 2, for when you do quantize (Type 1 is plain TPDF; Type 2 is the same TPDF with a high-frequency tilt)', 'SHAPING — noise shaping: Moderate / Normal / Ultra'] },
    { slug: 'loudness', full: 'Loudness', img: '/assets/module10.png',
      desc: 'The whole loudness picture in one place — LUFS and true-peak readouts that sign off the master.',
      body: ['The truth meter at the end of the chain. All meters live here — and only here: two VU dials, two LED peak bars, and six big numeric readouts. Keep Loudness last: module 10’s meters read the signal at module 10’s position in the chain, exactly where they sit.',
             'Modeled after the WLM Plus Loudness Meter (Waves) — Waves’ loudness meter for broadcast and streaming targets. KSAK-Pre captures its integrated / momentary metering and true-peak watch. One honest note from the booklet: the TARGET selector is stored by presets and shown on the face, but in this build it does not by itself change the audio or drive the limiter — TP CEIL and TP LIMIT are the controls that act.'],
      controls: ['TP CEIL — the true-peak ceiling the safety limiter aims at (0 to −3 dB); 0 = the limiter is transparent', 'TRIM — level into the measurement/limiter stage (−12 to +12 dB)', 'TARGET — the delivery standard the module’s presets are built around: −24 Broadcast / −14 Streaming / −16 Podcast / −23 EBU (see the honest note in the text)', 'TP LIMIT — engages the true-peak safety limiter; off = metering only', 'RESET METERS — clears peaks, integrated, range, and overs', 'VU meters (L / R) — big analog dials with hardware ballistics; 0 VU = −18 dBFS', 'LED bar meters (L / R) — fast peak meters with a peak-hold line', 'Readouts — TRUE PEAK dBTP · INTEGRATED LUFS (BS.1770) · SHORT-TERM LUFS · MOMENTARY LUFS · RANGE LU · TP LIMITER GR dB'] },
  ],
  delay: [
    { slug: 'modes', full: 'Modes — Five Characters', img: '/assets/mod-delay-modes.png',
      desc: 'Five characters cover the echo vocabulary — SLAP, DIGITAL, TAPE, ANALOG and PING-PONG, each with its own feedback character.',
      body: ['Five characters, five ways for repeats to behave. SLAP is a clean, short slapback voice — tight and present, made for the 60–250 ms range — and since v0.1.7 it has its own feedback character: the loop gain is capped at 0.20, so a slap stays a slap — one tight bounce and a short tail — even with the FEEDBACK knob high. FREEZE still overrides the cap.',
             'DIGITAL is pristine repeats, full bandwidth, no colour — what you play is what comes back. TAPE darkens each pass (the loop is capped at 6.5 kHz) and gently saturates, each pass a little warmer and rounder. ANALOG is bucket-brigade flavour: darker top (loop capped at 7.5 kHz), a low-end lift in the loop, soft saturation. PING-PONG bounces the repeats left–right–left across the stereo field, starting on the opposite side from the input.'],
      controls: ['SLAP — tight slapback voice; loop gain capped at 0.20', 'DIGITAL — pristine repeats, full bandwidth, no colour', 'TAPE — loop capped at 6.5 kHz, gently saturated each pass', 'ANALOG — loop capped at 7.5 kHz, low-end lift in the loop, soft saturation', 'PING-PONG — repeats bounce left–right, starting opposite the input'] },
    { slug: 'timing', full: 'Timing — Free or In Sync', img: '/assets/mod-delay-timing.png',
      desc: 'Free from 1 ms to 2 seconds, or locked to your song — quarter, dotted eighth, eighth, triplet — with Tap Tempo when the host has none.',
      body: ['Timing runs two ways. FREE: the TIME knob sets the delay directly, 1 ms to 2 seconds. Sync: the delay locks to your DAW’s tempo in the division you pick. The footer always shows the effective time in milliseconds and the tempo in use.',
             'TAP TEMPO sets the tempo by hand: a single tap sets nothing (an interval is required); taps between 0.15 s and 2.5 s apart are averaged over the last 5 intervals; a gap over 2.5 s clears back to the fallback. When the host reports a tempo, the host wins; otherwise the tapped tempo; otherwise 120 BPM.'],
      controls: ['FREE — the TIME knob sets the delay directly, 1 ms to 2 seconds', '1/4 · DOTTED 1/8 · 1/8 · TRIPLET — the delay locks to your DAW’s tempo in that division', 'TAP TEMPO — click in rhythm; averaged over the last 5 intervals'] },
    { slug: 'knob-row', full: 'The Knob Row', img: '/assets/mod-delay-knobs.png',
      desc: 'Six machined knobs run the engine: TIME, FEEDBACK, TONE, SWING, WIDTH and MIX — with MIX LOCK guarding your balance.',
      body: ['The working row of The Repeat Deck: six machined knobs, the MIX LOCK padlock beside MIX, and the DUCK / FREEZE pair on the right. Every control starts at a true neutral, so what you hear after you turn a knob is exactly what that knob did.',
             'TONE is the fastest way to push repeats behind the dry signal — or pull them forward: one knob tilts the feedback loop’s filters, darkening every repeat to the left and thinning them to the right. SWING pushes every second repeat later by up to 50% of the delay time — straight repeats become a shuffle; at dotted-eighth times it is instant groove.'],
      controls: ['TIME — delay time in FREE mode (1 ms – 2 s); in a sync mode it shows the synced value', 'FEEDBACK — how much of each repeat feeds the next: 0–95%', 'TONE — tilts the loop’s filters; centre is neutral (left darkens, right thins)', 'SWING — pushes every second repeat later, up to 50% of the delay time', 'WIDTH — stereo width of the wet signal only: 0% mono · 100% natural · 200% extra-wide', 'MIX — the wet level against the dry; 0% is the unity default. The padlock beside it is MIX LOCK'] },
    { slug: 'duck-freeze', full: 'Duck & Freeze', img: '/assets/mod-delay-duckfreeze.png',
      desc: 'DUCK dips the repeats under the dry signal; FREEZE captures the loop and holds it while you play over the top.',
      body: ['Two buttons, two stage tricks. DUCK — the repeats automatically dip while the dry signal is loud and bloom back in the gaps. The classic “delay that never talks over the vocal” trick, one button.',
             'FREEZE stops new audio entering the loop and holds the current repeats, looping them — lightly saturated so they sit still instead of decaying. Play over the top; unfreeze to release. FREEZE overrides the SLAP feedback cap. Try this: FREEZE a long TAPE feedback wash at the end of a chorus, then play the verse over it — the loop ignores your new playing completely.'],
      controls: ['DUCK — repeats dip under the dry signal automatically', 'FREEZE — capture the loop and play over it; overrides the SLAP feedback cap'] },
    { slug: 'eq', full: '5-Band EQ — On the Repeats Only', img: '/assets/mod-delay-eq.png',
      desc: 'A full 5-band EQ that shapes the repeats only — the dry signal is never touched, and each repeat is EQ’d once.',
      body: ['The EQ sits on the wet path only, outside the feedback loop: it shapes how the repeats sound, never the dry signal, and each repeat is EQ’d once — turning a band up does not compound from repeat to repeat the way a loop filter does. Reach for TONE when you want the repeats to evolve; reach for the EQ when you want them shaped.',
             'The graph draws the summed curve of all five bands — the same measured-response maths as the DSP, so the curve is the sound. Drag a node sideways for frequency and up or down for gain; the readout line shows the selected band’s exact type, frequency, gain and Q. Bands 1 and 5 carry the full filter set — Bell, Low Shelf, High Shelf, Low Pass, High Pass, Notch, Band Pass (the suite’s first/last-band standard); bands 2–4 offer Bell, Low Shelf and High Shelf. Defaults: band 1 is a low shelf at 60 Hz, bands 2–4 are bells at 220 Hz / 1 kHz / 3.5 kHz, band 5 is a high shelf at 10 kHz. Gain range ±15 dB, Q 0.3–8.'],
      controls: ['Band chips 1–5 — select a band; double-click a node (or the band’s bypass) to switch one band off', 'The graph — drag nodes for frequency and gain; the curve is the sound', 'FREQ / GAIN / Q mini-knobs — edit the selected band precisely', 'Type menu — bands 1 & 5 carry all seven filter types; bands 2–4 carry Bell + shelves', 'EQ BYPASS — the whole EQ off in one click', 'IN — trims the level entering the plug-in (±24 dB)'] },
    { slug: 'pan-out-trails', full: 'Pan, Out & Trails', img: '/assets/mod-delay-pan.png',
      desc: 'PAN places the wet signal, OUT trims the whole plug-in, and TRAILS decides what bypass does to the repeats.',
      body: ['The exit stage of the deck. PAN places the wet signal in the stereo field — the dry signal is never panned. OUT trims the plug-in’s overall output ±24 dB — match levels when you bypass to compare.',
             'TRAILS — when ON, bypassing the plug-in lets the current repeats ring out naturally while no new audio enters the loop. When OFF, bypass stops the sound immediately and clears the loop, so the next un-bypass starts from a truly clean slate.'],
      controls: ['PAN — places the wet signal in the stereo field (dry is never panned)', 'OUT — overall output trim (±24 dB)', 'TRAILS — ON: repeats ring out after bypass · OFF: bypass stops the sound and clears the loop'] },
  ],
  reverb: [
    { slug: 'algorithms', full: 'Five Algorithms', img: '/assets/mod-reverb-algorithms.png',
      desc: 'ROOM, PLATE, HALL, CHAMBER and SPACE — five spaces one click apart, their characters measured, not just named.',
      body: ['Five spaces, one click apart on the ALGORITHM rail. ROOM — the default: a believable small space, tight and present, the shortest reflections of the five. PLATE — bright and dense, with a longer tail than the knob suggests: the classic vocal and snare plate. HALL — a big public space: wider geometry, a 20% longer decay than the knob reads. CHAMBER — small and dark, an intimate, absorbent room. SPACE — the vast one: the largest geometry and half again the decay, where the tail becomes part of the music.',
             'The characters are measured, not just named: in the Nov 3, 2026 sweep the late-tail levels ordered exactly as the design intends — Space > Hall > Plate > Room > Chamber. The fastest way to learn them: load Vocal Plate on a lead vocal, then step through the algorithms with the same settings — one click hears the same decay in five different rooms.'],
      controls: ['ROOM — tight, present, the shortest reflections of the five', 'PLATE — bright and dense; a longer tail than the knob suggests', 'HALL — wider geometry; a 20% longer decay than the knob reads', 'CHAMBER — small, dark, intimate', 'SPACE — the largest geometry; half again the decay'] },
    { slug: 'vault-display', full: 'The Vault Display', img: '/assets/mod-reverb-display.png',
      desc: 'The arched window draws the wet signal’s live spectrum and the tail’s decay curve while the tail sounds.',
      body: ['The face of The Vault: the arched window shows the wet signal’s live spectrum and the tail’s decay curve, with the current tail level in dB — drawn while the tail sounds.',
             'It is a working surface, not decoration: watch a SPACE tail hang in the window, or see a dark CHAMBER tail fall away sooner than a HALL tail at the same DECAY setting. The footer mirrors the state in words — the algorithm and decay in use.'],
      controls: ['Live spectrum of the wet signal, drawn in real time', 'The tail’s decay curve, drawn as it sounds', 'Current tail level readout in dB'] },
    { slug: 'knob-grid', full: 'The Knob Grid', img: '/assets/mod-reverb-knobs.png',
      desc: 'Nine gold knobs run the space: DECAY, PRE-DELAY, SIZE across the top; TONE, MOD, WIDTH in the middle; MIX below.',
      body: ['Nine gold knobs run the space. DECAY — how long the tail takes to fall 60 dB into silence, 0.1 to 30 seconds: the size of the note the room leaves behind. PRE-DELAY — a gap of 0–250 ms between the dry sound and the start of the tail, so the dry sound stays clear while the space blooms behind it (the full 250 ms is honoured at 96 / 192 kHz too). SIZE — the physical size of the space, independent of DECAY: decay is how long; size is how big.',
             'TONE tilts the tank’s filters — left darkens the tail as it decays (the high end fades first, like a real room), right thins it. MOD keeps gentle movement inside the tail, the way air and small motions keep a real space alive — at 0 the tail is perfectly still. WIDTH is the stereo width of the wet signal only. MIX is the wet level against the dry — 0% is the unity default — and its LOCK is MIX LOCK, which stays locked across preset loads.'],
      controls: ['DECAY — tail length, 0.1–30 s', 'PRE-DELAY — gap before the tail starts, 0–250 ms', 'SIZE — the physical size of the space, independent of DECAY', 'TONE — tilts the tank’s filters; centre is neutral', 'MOD — gentle movement inside the tail', 'WIDTH — stereo width of the wet signal only (0% mono · 100% natural · 200% extra-wide)', 'MIX — wet level against the dry, with MIX LOCK'] },
    { slug: 'duck-freeze', full: 'Duck & Freeze', img: '/assets/mod-reverb-duckfreeze.png',
      desc: 'DUCK dips the tail under the dry signal; FREEZE holds the current space in the air while you play over it.',
      body: ['DUCK — the tail automatically dips while the dry signal is loud and blooms back in the gaps. The classic “reverb that never talks over the vocal” trick, one button.',
             'FREEZE stops new audio entering the tank and holds the current space, sustaining it — a light saturation keeps the frozen loop stable. Play over the top; unfreeze to let it die away. The Frozen Hall preset loads with freeze already on.'],
      controls: ['DUCK — the tail dips under the dry signal automatically', 'FREEZE — hold the space and play over it'] },
    { slug: 'filters-eq', full: 'Filters & 5-Band EQ — On the Tail Only', img: '/assets/mod-reverb-eq.png',
      desc: 'Two layers of shaping on the wet path only: input high-pass/low-pass filters, then a 5-band EQ on the finished tail.',
      body: ['Two layers of shaping, both on the wet path only — the dry signal is never touched. The input filters decide what enters the tank: HIGH-PASS (20 Hz – 1 kHz) keeps low mud out of the reverb so the tail stays clean without thinning the dry sound; LOW-PASS (1–20 kHz) caps how bright the tank can be — it sets the ceiling the TONE knob and the algorithm’s damping work under. Reach for the filters when you want the tail to evolve.',
             'The 5-band EQ sits after the tank: it shapes how the finished tail sounds, and each piece of tail is EQ’d once — turning a band up does not compound the way a tank filter does. The graph draws the summed curve of all five bands; drag a node for frequency and gain. Bands 1 and 5 carry the full filter set; bands 2–4 carry Bell, Low Shelf and High Shelf. One honest note, documented in the manual: the LOW-PASS knob’s top travel is currently bit-identical between 18 kHz and 20 kHz (in Plate the dead zone starts at about 12.5 kHz), because the knob is composed with the suite’s shared TONE law — the fix is held for a product ruling, and it is written down so it is never a surprise.'],
      controls: ['HIGH-PASS — 20 Hz – 1 kHz, on the tank input', 'LOW-PASS — 1–20 kHz, on the tank input (top-travel limit documented in the text)', 'Band chips 1–5 + the graph — drag nodes; the readout names the band’s true type, frequency, gain and Q', 'FREQ / GAIN / Q mini-knobs + the type menu, for the selected band', 'EQ BYPASS — the whole EQ off in one click', 'IN — trims the level entering the plug-in (±24 dB); it also sets how hard the space is driven'] },
    { slug: 'pan-out-trails', full: 'Pan, Out & Trails', img: '/assets/mod-reverb-pan.png',
      desc: 'A dual pan places each side of the wet signal independently; OUT trims the plug-in; TRAILS decides what bypass does to the tail.',
      body: ['The PAN section sits framed, on its own: LEFT PAN positions the tail’s left channel in the stereo field, RIGHT PAN the right channel. Both centred is natural stereo. Cross them — left to the right, right to the left — and the tail folds inward; the Crossed Plate preset starts there. The dry signal is never panned.',
             'OUT trims the plug-in’s overall output ±24 dB — match levels when you bypass to compare. TRAILS — when ON, bypassing lets the current tail ring out naturally while no new audio enters the tank (measured: the bypassed tail matches the never-bypassed tail within 0.5 dB). When OFF, bypass stops the wet sound immediately and empties the tank, so the next un-bypass starts from a truly clean slate.'],
      controls: ['LEFT PAN / RIGHT PAN — each side of the tail placed independently', 'OUT — overall output trim (±24 dB)', 'TRAILS — ON: the tail rings out after bypass · OFF: bypass stops the wet sound and empties the tank'] },
  ],
  omega: [
    { slug: 'bands', full: 'Bands — The Full 64', img: '/assets/mod-omega-bands.png',
      desc: '64 fully independent bands, every one carrying all 17 filter types and one of nine vintage curve characters.',
      body: ['OMEGA carries 64 fully independent bands. The header pill flips between showing 32 and 64; flipping back to 32 holds bands 33–64 in memory, untouched — flip forward again and they are exactly as you left them. New bands arrive flat and bypassed.',
             'Every band carries all 17 filter types — Bell · Low Shelf · High Shelf · Low Pass · High Pass · Notch · Band Pass · Tilt Shelf · Flat Tilt · Flat Top · Sword (razor bell) · All-Pass · Resonant Low Pass · Resonant High Pass · Steep Low Pass · Steep High Pass · Brick Cut. Pass filters follow the Butterworth law (exactly −3.01 dB at the cutoff, slopes 6–48 dB/oct) and the curves are drawn from the same mathematics that processes the audio — what you see is literally what you get, right up to Nyquist, with no high-frequency cramping. Each band can also wear one of nine vintage curve characters — Digital (exact), Pultec, API, Neve, SSL, Tube, British Console, American Console or Passive — with a Character knob blending in soft saturation on that band’s contribution only.'],
      controls: ['64 bands (32/64 view; bands 33–64 hold in memory when hidden)', 'All 17 filter types on every band', '9 vintage curve models per band + per-band Character saturation', 'Phase modes per band (Zero Latency and Natural are the working designs)', 'Per-band presets; headphone correction curves on bands 61–64'] },
    { slug: 'dynamic-spectral', full: 'Dynamic & Spectral Bands', img: '/assets/mod-omega-dynamic.png',
      desc: 'Every band picks its own mode: Static, Dynamic — a full gain computer per band — or Spectral, cutting only the bins that poke out.',
      body: ['EXPAND grows the window downward into the full parameters deck — every band’s complete control set: type, slope, vintage, phase, channel, mode, detector and motion. Every band has a Mode: Static, Dynamic or Spectral.',
             'Dynamic is a full gain computer per band: Threshold, Range, Knee, Attack, Release, Lookahead (to 25 ms), a Relative-threshold mode (the threshold rides the signal’s own slow average, so the band works at any level), Bidirectional movement, and a detector choice — MAIN (the input) or EXT (the sidechain bus). The dynamic offset can be aimed at the transient part of the signal, the sustain part, or both. Spectral works inside a streaming FFT engine: it cuts only the bins that poke above the band’s average by more than the Spectral Threshold, with a Density control for resolution. And any band’s gain or frequency can ride an LFO (free or tempo-synced) or the signal’s own envelope.'],
      controls: ['Mode per band: Static · Dynamic · Spectral', 'Dynamic: Threshold · Range · Knee · Attack · Release · Lookahead (to 25 ms)', 'Relative-threshold mode · Bidirectional movement · Detector: MAIN or EXT', 'Transient / Sustain split for the dynamic offset', 'Spectral: streaming FFT, Spectral Threshold, Density', 'Motion: LFO or envelope on a band’s gain or frequency'] },
    { slug: 'channels', full: 'Channels & the Stereo Field', img: '/assets/omega.png',
      desc: 'Per band: ST, MID, SIDE, L or R — with Field rotation that breathes a band between the centre and the sides. (Full face: the field controls live in the expanded deck.)',
      body: ['Per band: ST (stereo), MID, SIDE, L or R. The graph’s channel view shows one channel’s curve at a time.',
             'In the deck, Field L/R rotates a band’s contribution inside the stereo image and Field M/S breathes it between mid and side (clamped so nothing ever folds out of phase). The header MONO pill folds the whole plugin to level-compensated dual-mono, for checking mono compatibility the honest way.'],
      controls: ['Per-band channels: Stereo · Mid · Side · Left · Right', 'Field L/R rotation — a band’s contribution inside the stereo image', 'Field M/S rotation — a band breathed between mid and side', 'Header MONO pill — level-compensated dual-mono check'] },
    { slug: 'pitch-engine', full: 'The Pitch Engine', img: '/assets/mod-omega-pitch.png',
      desc: 'Hears monophonic sources and corrects them to a key and scale — with graph mode, where a captured take becomes note blocks on a piano roll.',
      body: ['Open it from the pitch capsule’s GRAPH button. OMEGA’s pitch engine hears monophonic sources (five input types: Soprano, Alto/Tenor, Low Male, Bass Voice, Instrument) and corrects them to a key and scale — Major, Minor, Chromatic, or a Custom scale you click together. Retune is the correction speed; Flex-Tune leaves expressive approaches alone until they are truly off; Humanize hands some depth back; Vibrato can be preserved, reduced or enhanced. Formant preserve keeps the voice’s body when the pitch moves; Formant Shift moves the body on purpose. Auto-Key listens to the whole song and names the key — and every OMEGA in the session follows the shared key (Key Sync). MIDI Target: play the melody the voice should sing. Polyphonic honesty: feed it a chord and it stands down instead of guessing.',
             'Graph mode — the vocal take, on a piano roll. CAPTURE INPUT records the dry input; STOP & ANALYSE cuts it into note blocks. Drag a block up/down to retune that note; Shift-drag slides its timing; per-note vibrato and formant rides are stored with the session. There is also Hum-to-Band: hum one steady note, press the button, and a resonant band appears at exactly that pitch.'],
      controls: ['Correction to key/scale: Major · Minor · Chromatic · Custom', 'Retune · Flex-Tune · Humanize · Vibrato (preserve / reduce / enhance)', 'Formant preserve and Formant Shift · Transpose · Detune · A4 reference 400–480 Hz', 'Auto-Key + Key Sync across instances', 'MIDI Target — play the melody the voice should sing', 'Graph mode: captured note blocks on a piano roll · Hum-to-Band'] },
    { slug: 'harmony', full: 'Harmony & the Vocal Stage', img: '/assets/omega.png',
      desc: 'Three harmony voices off the corrected lead, each with its own interval, level, formant, pan, width and EQ. (Full face: the stage lives in the HARMONY / VOCAL drawer.)',
      body: ['The HARMONY / VOCAL drawer runs three independent harmony voices off the corrected lead: interval (from an octave down to a major third up, per voice), level, formant, pan, width — and each voice carries its own little EQ (low shelf, presence, air).',
             'Add the Double Maker (the classic studio double, with width), De-Plosive (tames plosive blasts before they hit the chain) and Breath Control (rides breaths down between phrases). Vocal God Mode is the one-button chain: linked de-ess, harshness, mud, presence and air bands plus harmony and the double.'],
      controls: ['3 harmony voices: interval · level · formant · pan · width · per-voice EQ', 'Double Maker — the classic studio double, with width', 'De-Plosive — tames plosive blasts before the chain', 'Breath Control — rides breaths down between phrases', 'Vocal God Mode — the one-button vocal chain'] },
    { slug: 'delta-match-guard', full: 'Delta · Loudness Match · God Guard', img: '/assets/mod-omega-delta.png',
      desc: 'Hear exactly what the EQ is doing, judge it at matched loudness, and cap the output with a true-peak ceiling.',
      body: ['Delta (the dock button): OFF / GLOBAL — hear dry-minus-processed, exactly what the EQ is doing — / BAND, that solo for the band chosen in the deck.',
             'Loudness Match (the MATCH pill) measures input and output loudness (BS.1770) and trims the output so your EQ choices are judged at equal loudness; it defaults OFF, and MATCH LOCK freezes the trim where it stands. God Guard is a lookahead true-peak ceiling for the whole plugin — it rides the output down before inter-sample peaks can clip, and reports its gain reduction in God View. Auto Gain keeps the chain’s loudness honest as you work; Gain Scale breathes the whole curve up or down proportionally.'],
      controls: ['Delta: OFF / GLOBAL / BAND', 'Loudness Match (BS.1770) + MATCH LOCK', 'God Guard — lookahead true-peak ceiling, GR reported in God View', 'Auto Gain · Gain Scale'] },
    { slug: 'god-view', full: 'God View & the Ecosystem Link', img: '/assets/mod-omega-godview.png',
      desc: 'Every OMEGA in the session on one screen — your curve and theirs — with shared-boost collisions flagged.',
      body: ['Every OMEGA in the session registers with the Ecosystem Link. God View draws all of them — your curve and theirs — and flags shared-boost collisions where instances pile up.',
             'From there: the AI Mediator proposes complementary moves for colliding instances (ACCEPT applies this instance’s share; the others are listed, in plain words, to apply there); the Session Mastermind reads the whole session and trims the pile-ups; Key Sync keeps one shared song key for every instance; and Style Memory remembers the moves you accept and gently biases future suggestions toward your taste — local, visible in Settings, and erasable in one press. It never phones home — there is no home to phone. Boundary, stated plainly in the manual: KSAK-Pre, Simple Delay and Simple Reverb predate this protocol and do not publish into God View.'],
      controls: ['God View — every instance on one screen, collisions flagged', 'AI Mediator — complementary moves for colliding instances', 'Session Mastermind — reads the whole session, trims the pile-ups', 'Key Sync — one shared song key', 'Style Memory — local, visible, erasable in one press'] },
    { slug: 'ai-drawer', full: 'The AI Drawer', img: '/assets/omega.png',
      desc: 'Local AI that proposes and you dispose: Source ID, the Auto-EQ Assistant, Resonance Hunter, Pitch Brain, Text-to-EQ and more. (Full face: the drawer opens from the AI pill.)',
      body: ['Open it with the AI pill. Every model is local analysis — spectral statistics, rule systems and your Style Memory. Nothing leaves the machine; nothing needs an account. The standing law: AI proposes, you dispose — nothing changes your sound until you press ACCEPT.',
             'The shipped set: Source ID names the source it hears and sets the pitch input type; the Auto-EQ Assistant reads the long-term spectrum and proposes a labelled curve; Resonance Hunter draws narrow dynamic cuts at the resonances the scout hears ringing; Pitch Brain derives Retune/Humanize settings from the performance’s own stability and vibrato; Text-to-EQ turns “warmer, less muddy, more air” into an explained curve; plus AI Timing, the Translation Predictor, the Blind Coach, My Mic & Room Profile and the Session Doctor. Two of the fifteen announced features are NOT in this build — AI Harmony Composer (#14) and AI Reference Ghost (#15) have no control anywhere in v0.1.10; the manual declares them openly (§13) as a held, open product call.'],
      controls: ['Source ID · Auto-EQ Assistant · Resonance Hunter · Pitch Brain', 'Text-to-EQ · AI Timing · Translation Predictor · Blind Coach', 'My Mic & Room Profile · Session Doctor', 'AI proposes, you dispose — ACCEPT is the only moment anything changes', 'Not in this build (manual §13): AI Harmony Composer #14 · AI Reference Ghost #15'] },
  ],
  colossus: [
    { slug: 'clean', full: 'CLEAN Circuit', img: '/assets/mod-colossus-graph.png',
      desc: 'Transparent and precise: control without a fingerprint — measured, no saturation even at full Character.',
      body: ['A circuit is a way of hearing level and reacting to it — its speed, its curve, and the colour it leaves behind. All seven were measured pairwise distinct in the v0.1.6 label-truth sweep, and every label matches its measured behaviour. The visual is the transfer-curve graph every circuit works through.',
             'CLEAN — transparent mastering compressors (Kotelnikov class). Character: linear and precise. Control without a fingerprint — measured: no saturation even at full Character. Reach for it when the source sounds right and only needs holding — mastering, delicate buses.'],
      controls: ['Character / Saturation — this circuit’s own colour amount, clean to driven, never forced', 'Core controls: Threshold · Ratio · Attack · Release · Knee · Range · Make-Up · Mix', 'Detector: Peak · RMS · True-Peak, with detector EQ and SC Listen', 'Runs in Classic, Multiband (per band) or Spectral; stacks in the Dual Engine'] },
    { slug: 'bus', full: 'BUS Circuit', img: '/assets/mod-colossus-graph.png',
      desc: 'RMS-leaning glue in the SSL G-Bus tradition: separate elements start to move as one thing, and punch stays.',
      body: ['A circuit is a way of hearing level and reacting to it — its speed, its curve, and the colour it leaves behind. All seven were measured pairwise distinct in the v0.1.6 label-truth sweep, and every label matches its measured behaviour.',
             'BUS — SSL G-Bus. Character: RMS-leaning glue. Separate elements start to move as one thing; punch stays. Reach for it when a mix, drum bus or backing track needs to gel without going soft.'],
      controls: ['Character / Saturation — this circuit’s own colour amount, clean to driven, never forced', 'Core controls: Threshold · Ratio · Attack · Release · Knee · Range · Make-Up · Mix', 'Detector: Peak · RMS · True-Peak, with detector EQ and SC Listen', 'Runs in Classic, Multiband (per band) or Spectral; stacks in the Dual Engine'] },
    { slug: 'fet', full: 'FET Circuit', img: '/assets/mod-colossus-graph.png',
      desc: 'Fast, forward, with grit when you drive it — the fastest attack and release of the seven.',
      body: ['A circuit is a way of hearing level and reacting to it — its speed, its curve, and the colour it leaves behind. All seven were measured pairwise distinct in the v0.1.6 label-truth sweep, and every label matches its measured behaviour.',
             'FET — 1176. Character: fast, forward, with grit when you drive it — the fastest attack and release of the seven, with the second-hottest saturation. Reach for it when: rap and rock vocals, snare — anything that needs to jump forward and bite. In the Dual Engine, FET into OPTO is the classic vocal chain: the FET catches the fast peaks, the OPTO smooths what is left.'],
      controls: ['Character / Saturation — this circuit’s own colour amount, clean to driven, never forced', 'Core controls: Threshold · Ratio · Attack · Release · Knee · Range · Make-Up · Mix', 'Detector: Peak · RMS · True-Peak, with detector EQ and SC Listen', 'Runs in Classic, Multiband (per band) or Spectral; stacks in the Dual Engine'] },
    { slug: 'opto', full: 'OPTO Circuit', img: '/assets/mod-colossus-graph.png',
      desc: 'Smooth and musical, with a program-dependent two-stage release that rides a performance instead of chasing it.',
      body: ['A circuit is a way of hearing level and reacting to it — its speed, its curve, and the colour it leaves behind. All seven were measured pairwise distinct in the v0.1.6 label-truth sweep, and every label matches its measured behaviour.',
             'OPTO — LA-2A. Character: smooth and musical, with a program-dependent two-stage release — quick at first, then easing off slowly, riding a performance instead of chasing it. Reach for it when: vocals and bass that need effortless, natural levelling.'],
      controls: ['Character / Saturation — this circuit’s own colour amount, clean to driven, never forced', 'Core controls: Threshold · Ratio · Attack · Release · Knee · Range · Make-Up · Mix', 'Detector: Peak · RMS · True-Peak, with detector EQ and SC Listen', 'Runs in Classic, Multiband (per band) or Spectral; stacks in the Dual Engine'] },
    { slug: 'vari-mu', full: 'VARI-MU Circuit', img: '/assets/mod-colossus-graph.png',
      desc: 'Slow, rich glue whose ratio itself grows as the signal gets louder.',
      body: ['A circuit is a way of hearing level and reacting to it — its speed, its curve, and the colour it leaves behind. All seven were measured pairwise distinct in the v0.1.6 label-truth sweep, and every label matches its measured behaviour.',
             'VARI-MU — Fairchild 670 / Manley-style vari-mu. Character: slow, rich glue with harmonic weight. The ratio itself grows as the signal gets louder — measured: gain reduction grows ×2.22 low-to-high, against CLEAN’s ×1.98. Reach for it when: mix buses, mastering glue, and sources that want warmth and size.'],
      controls: ['Character / Saturation — this circuit’s own colour amount, clean to driven, never forced', 'Core controls: Threshold · Ratio · Attack · Release · Knee · Range · Make-Up · Mix', 'Detector: Peak · RMS · True-Peak, with detector EQ and SC Listen', 'Runs in Classic, Multiband (per band) or Spectral; stacks in the Dual Engine'] },
    { slug: 'vca-punch', full: 'VCA PUNCH Circuit', img: '/assets/mod-colossus-graph.png',
      desc: 'Tight and forward, with thrust — it pushes the middle of the sound at you, controlled.',
      body: ['A circuit is a way of hearing level and reacting to it — its speed, its curve, and the colour it leaves behind. All seven were measured pairwise distinct in the v0.1.6 label-truth sweep, and every label matches its measured behaviour.',
             'VCA PUNCH — API 2500-style VCA. Character: tight and forward, with thrust — it pushes the middle of the sound at you, controlled. Reach for it when: drums and buses that need punch you can feel.'],
      controls: ['Character / Saturation — this circuit’s own colour amount, clean to driven, never forced', 'Core controls: Threshold · Ratio · Attack · Release · Knee · Range · Make-Up · Mix', 'Detector: Peak · RMS · True-Peak, with detector EQ and SC Listen', 'Runs in Classic, Multiband (per band) or Spectral; stacks in the Dual Engine'] },
    { slug: 'chameleon', full: 'CHAMELEON Circuit', img: '/assets/mod-colossus-graph.png',
      desc: 'The Distressor’s range: extended ratios including NUKE, and the hottest saturation of the seven.',
      body: ['A circuit is a way of hearing level and reacting to it — its speed, its curve, and the colour it leaves behind. All seven were measured pairwise distinct in the v0.1.6 label-truth sweep, and every label matches its measured behaviour.',
             'CHAMELEON — Distressor. Character: extended ratios (including NUKE), detector band emphasis and drive modes — the hottest saturation of the seven. Reach for it when you need range — parallel crush, room mics, or a sound that has to change character, not just level.'],
      controls: ['Character / Saturation — this circuit’s own colour amount, clean to driven, never forced', 'Core controls: Threshold · Ratio · Attack · Release · Knee · Range · Make-Up · Mix', 'Detector: Peak · RMS · True-Peak, with detector EQ and SC Listen', 'Runs in Classic, Multiband (per band) or Spectral; stacks in the Dual Engine'] },
    { slug: 'character', full: 'Character — Per-Circuit Saturation', img: '/assets/colossus.png',
      desc: 'Every circuit carries its own Character saturation, from clean to driven — per circuit, never forced. (Full face: Character rides each circuit, it has no single panel.)',
      body: ['Every circuit carries a Character / Saturation amount, from clean to driven. It is per circuit and never forced: CLEAN stays spotless, FET can stay polite, and any circuit is pushed only as far as you choose.',
             'One honest limit, from the manual: in Multiband, bands carry Character = 0 by design, so per-band saturation does not engage (Appendix A).'],
      controls: ['Per-circuit amount, from clean to driven', 'CLEAN measures no saturation even at full Character', 'FET carries the second-hottest saturation of the seven; CHAMELEON the hottest', 'Multiband bands carry Character = 0 by design (manual, Appendix A)'] },
    { slug: 'core-controls', full: 'Core Controls', img: '/assets/mod-colossus-controls.png',
      desc: 'Threshold, Ratio, Attack, Release, Knee and Mix on the pedestal — the working set of the selected engine.',
      body: ['These controls belong to the selected engine — or, in Multiband, to the selected band. The pedestal shows the working set; the EXPAND deck shows all of them. Dragging the graph’s knee point moves threshold and ratio together; the mouse wheel over the knee point adjusts the knee.',
             'The detector is the engine’s ear. The detector EQ shapes what that ear hears — without changing the sound itself: a mini-EQ on the sidechain detector (high-pass, low-pass, a bell, and a de-ess band, each measured true to its label). Roll the lows out of the detector and a bass-heavy signal stops making the whole vocal pump. The detector source can be Internal, External, or a blend — per engine, and per band in Multiband — and SC LISTEN solos the detector signal, so you hear exactly what the engine is hearing.'],
      controls: ['Threshold — the level where compression begins', 'Ratio — continuous from expansion below 1:1, through gentle control, up to 100:1 and Limit behaviour', 'Attack — microseconds to 250 ms · Release — manual timing, or Auto 1 / Auto 2', 'Hold — keeps gain reduction held before release begins · Knee — how gradually compression arrives', 'Range — caps the maximum gain reduction · Lookahead — 0–20 ms, latency reported honestly', 'Detector — Peak, RMS, or True-Peak, plus a detector mix; detector EQ + SC Listen', 'Make-Up — manual, or Auto · Mix — dry/wet blend · IN / OUT trims'] },
    { slug: 'dual-engine', full: 'Dual Engine — Stacking Two Circuits', img: '/assets/mod-colossus-dual.png',
      desc: 'Two full engines in one instance: series (A → B) or parallel (A + B), with LINK tying their thresholds.',
      body: ['One engine at work. The Dual Engine puts a second full engine beside it — its own circuit, timing, detector and range — inside the same instance, preset and undo history.',
             'Series (A → B) — the output of A feeds B. The classic example is the vocal chain engineers have used for decades: FET into OPTO — the FET catches the fast peaks, the OPTO smooths what is left. Parallel (A + B) — both engines hear the input and their outputs blend: New York-style parallel compression without any aux routing. LINK ties the two thresholds together, so one move drives both engines at once. The Dual Engine also ships with proven serial chains as starting proposals — FET→Opto vocal, Bus→Limit bus, Opto→Clean level — fully editable, like every preset.'],
      controls: ['OFF / SERIAL (A → B) / PARALLEL (A + B)', 'LINK — ties the two thresholds together', 'Engine B — its own circuit, timing, detector and range', 'Starting proposals: FET→Opto vocal · Bus→Limit bus · Opto→Clean level'] },
    { slug: 'architectures', full: 'The Three Architectures', img: '/assets/mod-colossus-arch.png',
      desc: 'Classic wideband, Multiband with up to 8 bands, or Spectral — plus upward/downward compression and the transient/sustain split.',
      body: ['Classic — one wideband engine (or the Dual Engine pair) across the whole signal: the classic boxes’ job, and the right default for most tracks. Multiband — up to 8 bands, every band its own compressor: its own circuit, threshold, ratio, attack, release, range, detector and channel target — a VARI-MU band holding the low end with slow, rich glue while a FET band snaps the presence region, in one instance. Its crossovers were rewritten in v0.1.6: the band sum is flat within 0.00 dB from 30 Hz to 12 kHz in both minimum-phase and linear-phase modes. Spectral — dynamic resonance control across frequency, inside a streaming FFT engine: it presses down only the narrow resonances that poke out when the signal gets loud.',
             'Across the architectures: downward compression tames peaks — the familiar direction — while upward compression lifts quiet detail (tails, breaths, room) up toward the performance; COLOSSUS runs both in one instance, each with its own range. The transient / sustain split compresses the attack of a sound separately from its body. And Delta Listen plays only what the compressor is removing or lifting — per engine, per band, in Spectral, and for upward and downward separately.'],
      controls: ['CLASSIC — one wideband engine (or the Dual Engine pair)', 'MULTIBAND — up to 8 bands, each a full compressor; minimum-phase or linear-phase crossovers', 'SPECTRAL — dynamic resonance control in a streaming FFT engine', 'Upward + downward compression together, each with its own range', 'Transient / sustain split', 'Delta Listen — hear only the work'] },
    { slug: 'vocal-tools', full: 'Vocals — The Focused Tools', img: '/assets/colossus.png',
      desc: 'Vocal God Mode, De-Ess, De-Plosive, Breath Control and the Vocal Rider Layer — the focused vocal drawer. (Full face: the tools live in the Vocal God drawer.)',
      body: ['The Vocal God drawer — Level, Snap, De-Ess and Breath Lift as one focused layout, on top of the full flagship. The full layout is always one click away. Vocal God Mode: Level is opto-style ease, the smooth levelling job; Snap is FET-style bite, the fast peak job; De-Ess is sibilance control; Breath Lift lifts or settles breaths as their own job. Every control underneath stays fully manual — Vocal God Mode is a doorway, not a cage.',
             'De-Ess, De-Plosive and Breath Control: a spectral split identifies sibilance, plosive pops and breaths, and each becomes its own dynamic job inside the one instance — tame or lift each separately instead of letting one compressor setting fight all three. The Vocal Rider Layer is a slow pre-leveling stage that rides fader-level gain before compression, so the compressor works less and sounds more natural; the ride is drawn as a proposal you accept and edit phrase by phrase — it is never applied silently.'],
      controls: ['Vocal God Mode: Level · Snap · De-Ess · Breath Lift', 'De-Ess · De-Plosive · Breath Control — each its own dynamic job', 'Vocal Rider Layer — a slow pre-leveling ride, drawn as an editable proposal'] },
    { slug: 'ai-proposals', full: 'AI Proposals — You Dispose', img: '/assets/mod-colossus-ai.png',
      desc: '15 local AI features draw their proposals as ghost curves with plain-word labels — nothing changes until you accept.',
      body: ['The one law over all of it: AI proposes, you dispose. Every result arrives as a visible proposal — a ghost transfer curve, a ghost gain-reduction pattern, plain-word labels — and only becomes real when you accept it. All AI runs locally on your machine — no cloud, no account, no audio leaves the computer. The propose-only law was verified per button in the full functional audit: every feature produces its proposal with zero parameters moved before APPLY.',
             'The fifteen: AI Source ID hears what the source is and proposes the circuit and timing defaults that suit it. AI Auto-Comp Assistant draws a full proposal — circuit, threshold, ratio, timing, range — each choice labelled in plain words. AI Timing Brain proposes attack and release per source. AI Pump & Breath Guard offers the smallest fix for unwanted pumping. AI Mix Mediator works across all instances in God View. AI Text-to-Comp builds settings from plain words and explains each choice. AI Style Memory learns your compression taste locally. AI Layer Comp compresses the layers of a finished 2-track separately. AI Session Doctor scans a timeline and marks the problems. Loudness-True / LOUDNESS MATCH keeps comparisons honest. AI Serial Chain Builder proposes the Dual Engine chain. AI Blind Coach lets your ears pick between hidden candidates. AI Translation Predictor warns how a setting travels. AI Dynamic Ride draws the Vocal Rider proposal. AI Reference Ghost draws a Match proposal from a released song’s dynamic fingerprint.'],
      controls: ['Ghost-curve proposals with plain-word labels — zero parameters move before APPLY', 'AI Source ID · AI Auto-Comp Assistant · AI Timing Brain · AI Pump & Breath Guard', 'AI Mix Mediator · AI Text-to-Comp · AI Style Memory · AI Layer Comp · AI Session Doctor', 'Loudness-True / LOUDNESS MATCH · AI Serial Chain Builder · AI Blind Coach', 'AI Translation Predictor · AI Dynamic Ride · AI Reference Ghost', 'All local — no cloud, no account, no audio leaves the computer'] },
  ],
  chronos: [
    { slug: 'noise', full: 'Noise', img: '/assets/mod-chronos-noise.png',
      desc: 'Vinyl dust and texture noise under your signal.',
      body: ['Six modules give CHRONOS its retro colour. Each module is one knob — how much — with an ON pill under the knob that switches that module in or out. NOISE lays vinyl dust and texture noise under your signal.',
             'Every color module answers to the MAGNET master: with MAGNET at zero the six modules stay silent no matter how their knobs are set — turn the clock up and the deck comes alive.'],
      controls: ['Amount knob — how much noise rides under the signal', 'ON pill — switch the module in or out', 'Silent at MAGNET 0, whatever the knob says'] },
    { slug: 'wobble', full: 'Wobble', img: '/assets/mod-chronos-wobble.png',
      desc: 'The pitch wobble of tired tape and warped vinyl.',
      body: ['WOBBLE is the pitch wobble of tired tape and warped vinyl — one knob for how much, an ON pill to switch it in or out.',
             'Macro 4 rides WOBBLE live: it pushes the amount up and switches the module on while the macro is above zero.'],
      controls: ['Amount knob — depth of the pitch wobble', 'ON pill — switch the module in or out', 'Macro 4 rides WOBBLE'] },
    { slug: 'distort', full: 'Distort', img: '/assets/mod-chronos-distort.png',
      desc: 'Drive and grit, from warmth to crunch.',
      body: ['DISTORT is drive and grit, from warmth to crunch — one knob for how much, an ON pill to switch it in or out.',
             'Macro 3 rides DISTORT: it pushes the amount up and switches the module on while the macro is above zero.'],
      controls: ['Amount knob — warmth to crunch', 'ON pill — switch the module in or out', 'Macro 3 rides DISTORT'] },
    { slug: 'digital', full: 'Digital', img: '/assets/mod-chronos-digital.png',
      desc: 'Bit-crush and sample-hold grit from early digital gear.',
      body: ['DIGITAL is bit-crush and sample-hold grit from early digital gear — one knob for how much, an ON pill to switch it in or out.',
             'Pair it with the sequencer’s PITCH or STUTTER lanes and the retro colour turns rhythmic.'],
      controls: ['Amount knob — depth of the crush', 'ON pill — switch the module in or out'] },
    { slug: 'space', full: 'Space', img: '/assets/mod-chronos-space.png',
      desc: 'A reverb space that opens up behind the sound.',
      body: ['SPACE is a reverb space that opens up behind the sound — one knob for how much, an ON pill to switch it in or out. Macro 2 rides SPACE: it pushes the amount up and switches the module on while the macro is above zero.',
             'SPACE is also half of the XY Morph pad: the pad morphs MAGNET and SPACE together between four corner targets, so one drag can open the space while the deck ages — or dry both out.'],
      controls: ['Amount knob — how much space opens up', 'ON pill — switch the module in or out', 'Macro 2 rides SPACE · XY Morph blends SPACE against MAGNET'] },
    { slug: 'magnetic', full: 'Magnetic', img: '/assets/mod-chronos-magnetic.png',
      desc: 'Magnetic tape character and saturation.',
      body: ['MAGNETIC is magnetic tape character and saturation — one knob for how much, an ON pill to switch it in or out.',
             'Do not confuse it with the MAGNET clock below the deck: MAGNETIC is one of the six colours; MAGNET is the master amount — and the engage — for the whole color chain.'],
      controls: ['Amount knob — tape character and saturation', 'ON pill — switch the module in or out'] },
    { slug: 'magnet', full: 'MAGNET — The Master Clock', img: '/assets/mod-chronos-magnet.png',
      desc: 'The master amount for the whole color chain, drawn as the clock dial — and as it rises, the face itself ages.',
      body: ['Below the six color knobs sits the MAGNET clock — the master amount for the whole color chain, drawn as the clock dial. Its hand is live: it shows the MAGNET value. With MAGNET at zero the six modules stay silent no matter how their knobs are set — turn the clock up and the deck comes alive. Every factory preset stores its own MAGNET value, and Macro 1 rides MAGNET live.',
             'Run the master hard and the machine shows it: a wear layer — fine grain, micro-scratches, grime held in the recesses — fades in with the MAGNET amount, like a deck that has been worked for years. It is display only: it changes no sound, it is strongest at full MAGNET, and at MAGNET 0 it is exactly zero — the face at rest is the locked face, untouched. The clock’s dial face itself never ages; only its bezel wears, so the numerals and the MAGNET lettering stay as crisp as the day they were restored.'],
      controls: ['Master amount + engage for the whole color chain', 'The live clock hand shows the MAGNET value', 'Face patina fades in with MAGNET — display only; the audio never knows', 'Macro 1 rides MAGNET'] },
    { slug: 'sequencer', full: 'The 32-Step Sequencer', img: '/assets/mod-chronos-sequencer.png',
      desc: 'The game board: 32 steps × 9 FX lanes plus a lane per color module — paint steps, set amounts, chain patterns A–H.',
      body: ['The centre board is time. Paint steps — click a cell to switch it on or off; drag to paint a run of steps. Set a step’s amount with the mouse wheel over a cell (the wheel also switches the step on); a block’s brightness is its amount. SEQ ON, top right of the board, switches the whole sequencer in or out, and the HUD above the board shows the live step (STEP n/32) and the current swing. The nine lanes: STUTTER repeats a slice of the step; REVERSE plays the previous step’s audio backwards; SCRATCH scrubs like a hand on vinyl; TAPE-STOP spins the step down to a stop; X-LOOP repeats the step’s slice in a tight loop; GATE chops the step silent; HALF-TIME reads the previous slice at half speed; FILTER fires the filter move; PITCH shifts pitch on its steps, each step carrying a semitone offset up to ±12.',
             'Eight pattern pads A–H live under the board (with the Tone EQ strip between board and pads on the face): click a pad to switch patterns on a step boundary, chain patterns to play in sequence (verse → hook → drop, chain length 2 to 8), and let the DICE — the Smart Randomizer — propose a musical pattern as a ghost; nothing changes until you accept it. The CAPTURE button arms a Loop FX capture. Vocal Mode and Drum Mode retune the board’s behaviour per preset: in Vocal Mode a gate step never fully mutes and time-warp amounts soften; in Drum Mode the gate stays shut to 95% of the step and stutters shorten. Deeper still: every step carries a probability of firing — seeded, so the same pattern performs the same chances every render; each lane can swing its own odd steps and span ×0.25 to ×2 of the global step for polyrhythm; and a tenth Freeze lane can hold the audio sample-still for a step’s whole span.'],
      controls: ['Paint by click/drag · wheel sets a step’s amount · SEQ ON switches the board', '9 lanes: Stutter · Reverse · Scratch · Tape-Stop · X-Loop · Gate · Half-Time · Filter · Pitch', 'Per-step probability (seeded) · per-lane swing · per-lane length ×0.25–×2 · Freeze lane', 'Pattern pads A–H with chaining (2–8) · DICE ghost proposals · CAPTURE arms Loop FX', 'Vocal Mode and Drum Mode lane tunings'] },
    { slug: 'tone-eq', full: 'The Tone EQ Strip', img: '/assets/mod-chronos-toneeq.png',
      desc: 'Under the board: HP/LP knobs with slope selectors and three shape-switching bands, with a live true-response curve.',
      body: ['The strip under the board: HI-PASS and LO-PASS cutoff knobs with a slope chip under each — click the chip to cycle 12 / 24 / 48 dB per octave — and three gain bands, BELL 1 · 2 · 3. Click a band’s knob to select it; the FREQ and Q knobs and the readout follow your selection. Each band’s chip sets its shape: BELL · L-SH (low shelf) · H-SH (high shelf) · NOTCH — the bands shape-shift.',
             'The LIVE CURVE display draws the true combined shape of all five bands, live. And labels tell the truth: every shape on this strip is measured against the maths its label promises before a build ships — a shelf measures as a shelf, a notch as a notch. That is a standing KSAK law, and it is regression-tested on every build. EQ ON, top left of the strip, is the strip’s own on/off.'],
      controls: ['HI-PASS / LO-PASS — cutoff knobs with slope chips (12 / 24 / 48 dB/oct)', 'BELL 1 · 2 · 3 — gain knobs; click a band to select it', 'Shape chips per band: BELL · L-SH · H-SH · NOTCH', 'FREQ + Q knobs follow the selected band', 'LIVE CURVE — the true combined response, drawn live', 'EQ ON — the strip’s own switch'] },
    { slug: 'pitch-tuning', full: 'Pitch & Tuning', img: '/assets/mod-chronos-pitch.png',
      desc: 'Correction in Natural or Hard Tune mode, formant preserve and real formant shift, tuned to 440, 432 or 444 Hz plus cents.',
      body: ['The pitch rail: the big display shows the note the engine hears — note name, exact frequency, and cents error — updated live. The selectors under it set the correction mode (Natural / Hard), the key, the scale and the tuning reference (440 Hz shown; 432 / 442 / 444 Hz are in the same menu). Natural keeps the singer’s own voice: the formants are preserved, so a corrected note does not turn chipmunk or dark — measured: on a corrected tone, Natural held the first formant at 592 Hz against a 600 Hz source, where Hard mode dragged it to 632 Hz with the pitch. Hard Tune is the classic instant, stepped correction: formants ride with the pitch. RETUNE is how fast and how hard the correction pulls to the target note; HUMANIZE loosens the correction so a performance keeps its human wobble.',
             'FORMANT — the real thing: it shifts the voice’s character — its spectral envelope — without moving the pitch. Down darkens and deepens; up brightens and thins. With correction idle, the formant stage is a bit-exact bypass — it costs nothing when it is not working. One honest note from the manual: while the formant stage is engaged it adds about 29 ms (1280 samples at 44.1 kHz) of processing latency, which this build does not yet report to the host. The Pitch Quantizer snaps pitch-lane steps and correction targets to the key and scale you set, with glide stretching the approach to a quantized note instead of jumping — the difference between a ladder and a ramp — and a tempo-synced pitch LFO adds vibrato / wobble / chorus-detune movement under the hood.'],
      controls: ['Readout — note name, exact frequency, cents error, live', 'Selectors: correction mode (Natural / Hard) · key · scale · tuning reference (440 / 432 / 442 / 444 Hz) + cents', 'RETUNE — how fast and hard the correction pulls', 'HUMANIZE — loosens the correction to keep the human wobble', 'FORMANT — shifts the spectral envelope without moving the pitch', 'PITCH ON — the block’s own switch', 'Pitch Quantizer — key/scale snap + glide'] },
    { slug: 'loop-fx', full: 'Loop FX — The Loop Lab', img: '/assets/mod-chronos-loopfx.png',
      desc: 'Capture a beat or whole bars, slice them onto the 32 steps, and tune and colour the loop separately from the dry.',
      body: ['CAPTURE grabs the audio playing through CHRONOS, click-free with crossfaded edges. Lengths: 1 Beat · 1 Bar · 2 Bars · 4 Bars · 8 Bars — measured exact (1 bar at 120 BPM is precisely 88,200 samples; 1 beat is 22,050). FREE, the length selector’s sixth entry, captures with no fixed length: press CAPTURE to start, press again to end — the loop is exactly the span between your two presses, measured to the sample, with a 40-second buffer cap. With the Time Quantizer on, the capture starts on the grid. LOOP ON plays the captured loop; LOOP MIX (a preset/host parameter, ridden by Macro 7) blends loop against dry. A printed capture carries the post-chain signal — capture the sound with the FX chain baked in — and you can drag from the waveform window straight into your DAW to export the loop as a 16-bit WAV file.',
             'Modes: Normal (the loop, straight) · Reverse · Ping-Pong (forward, then backwards, alternating) · Half-Speed (pitched down an octave) · Double-Speed (pitched up an octave) · Slice — the loop chopped and its slices mapped to the 32 steps, editable on the SLICES page (which slice plays 1–32, MUTE, REV per slice, and a pitch slider −12…+12 semitones). FREEZE holds the loop in time — at full LOOP MIX the output is the loop alone, frozen. OVERDUB layers new audio into the loop while it plays, with UNDO on a right-click or long-press of the OVERDUB button. With MIDI Play on, notes 45 and 48–55 restart the loop, quantized to the next step boundary.'],
      controls: ['CAPTURE — 1 Beat · 1 Bar · 2 Bars · 4 Bars · 8 Bars · FREE (press-to-press, sample-exact)', 'Modes: Normal · Reverse · Ping-Pong · Half-Speed · Double-Speed · Slice', 'LOOP ON · LOOP MIX (Macro 7) · Capture/Print with the FX chain baked in · drag-out WAV', 'FREEZE — hold the loop in time · OVERDUB + UNDO · MIDI retrigger', 'SLICES page — per-step slice, MUTE, REV, pitch −12…+12 semitones'] },
    { slug: 'fx-chain', full: 'FX Batch — The Reorderable Chain', img: '/assets/chronos.png',
      desc: '25 more effect groups in one chain beyond the color deck and the board — order is yours, and order matters. (Full face: the chain lives on the SETTINGS → FX CHAIN page.)',
      body: ['Beyond the color deck and the board, CHRONOS carries 25 more effect groups in one chain (SETTINGS → FX CHAIN: the four mode selectors on top, then the 25 chain groups — position, name, ON, amount, move arrows and trigger assignment — in one scrolling page). Order matters — wavefold into bitcrush is not bitcrush into wavefold — and the order is yours: use the arrows on any row to move a group through the chain. Every group has an ON switch, an Amount, and a trigger assignment: run in the Chain always, or fire only on Gate steps, Stutter steps or Filter steps. A group whose lane is off is skipped sample-exactly — it costs nothing.',
             'The 25 groups: Granular Chop · Buffer Shuffle · Slip · Stretch · Repeat Decay · DJ Filter · Filter Sweep · Feedback · Multiband Distortion · Wavefold · Bitcrush Drop · Reverbs · Spectral Freeze/Blur · Texture Layer · Chorus/Flanger/Phaser · Tremolo · Auto-Pan · Stereo Flip · Ring Mod / Frequency Shift · Vowel Filter · Width Sequencer · Haas · Mid-Side per Step · Pump Sequencer · Transient Chop. The four mode selectors pick the flavour of four groups: REVERB TYPE — Shimmer / Reverse / Gated / Spring / Plate · MODULATION — Chorus / Flanger / Phaser · SPECTRAL — Freeze / Blur · RING / SHIFT — Ring Mod / Frequency Shift. And Stereo Flip’s Amount is a true crossfade, not a switch: 0 = dry stereo (bit-identical), 1 = the full channel swap, every value between the exact mix.'],
      controls: ['25 groups, reorderable with the move arrows', 'Per group: ON · Amount · trigger (Chain always / Gate steps / Stutter steps / Filter steps)', 'Mode selectors: REVERB TYPE · MODULATION · SPECTRAL · RING / SHIFT', 'Stereo Flip — a true blend crossfade, measured at 0 / 0.25 / 0.5 / 0.75 / 1'] },
    { slug: 'quantizer', full: 'The Dual Quantizer', img: '/assets/mod-chronos-quantizer.png',
      desc: 'The Time Quantizer strip: grid, strength and swing keep loop captures and steps honest to the beat.',
      body: ['The Quantizer strip sits at the bottom left of the face. QUANT is the Time Quantizer on/off. GRID — 1/4 · 1/8 · 1/8T · 1/16 · 1/16T · 1/32 (T = triplet). STRENGTH — how hard timing snaps to the grid: at full strength a loop capture starts on the grid; at zero it starts the moment you press. SWING pushes the off-steps later for groove; the HUD shows the live percentage.',
             'The dual Quantizer keeps time and pitch honest: its other half, the Pitch Quantizer, lives in the Pitch & Tuning block — pitch-lane steps and correction targets snap to the key and scale you set, and glide stretches the approach to a quantized note instead of jumping.'],
      controls: ['QUANT — the Time Quantizer on/off', 'GRID — 1/4 · 1/8 · 1/8T · 1/16 · 1/16T · 1/32', 'STRENGTH — how hard timing snaps to the grid', 'SWING — pushes the off-steps later; the HUD shows the live %', 'Pitch Quantizer — key/scale snap + glide (in the pitch block)'] },
    { slug: 'macros', full: 'Macros 1–8', img: '/assets/mod-chronos-macros.png',
      desc: 'Eight performance knobs that ride the board’s headline targets — neutral at zero, and they only ever push toward full.',
      body: ['Macros are a performance layer on top of the preset, never a rewrite of it. A macro only ever pushes its target from where the preset put it toward full — at 0 it changes nothing, exactly. Factory presets store all macros at 0 and render bit-identical with the macro stage in place. Macros and XY moves are recordable as host automation.',
             'The eight: M1 MAGNET — pushes MAGNET toward full, and engages the color chain with it. M2 SPACE — pushes the SPACE amount up; switches SPACE on while above zero. M3 DISTORT — same pattern. M4 WOBBLE — same pattern. M5 RETUNE — pushes pitch correction toward full strength. M6 SEQ DRIVE — pushes every step amount on the board toward full, all lanes at once. M7 LOOP MIX — pushes the loop’s mix toward full. M8 MIX RIDE — rides the wet/dry mix toward dry: at full macro the output is bit-exact the dry signal.'],
      controls: ['M1 MAGNET · M2 SPACE · M3 DISTORT · M4 WOBBLE', 'M5 RETUNE · M6 SEQ DRIVE · M7 LOOP MIX · M8 MIX RIDE', 'Neutral at zero — a macro only ever pushes its target toward full', 'Recordable as host automation'] },
    { slug: 'xy-morph', full: 'XY Morph', img: '/assets/mod-chronos-xy.png',
      desc: 'Drag the dot: the pad morphs MAGNET and SPACE together between four corner targets — every in-between point a true blend.',
      body: ['Drag the dot on the XY pad: the pad morphs MAGNET and SPACE together, blending between four corner targets — bottom-left dry, bottom-right full MAGNET, top-left full SPACE, top-right both. Every in-between point is a true bilinear blend, and the position is automatable. Its crosshair sits exactly on the pad artwork’s own centre cross.',
             'Edit the corners on the XY page of the SETTINGS drawer: eight sliders — a MAGNET and a SPACE target for each corner (00 · 10 · 01 · 11). The defaults are the musical ones — corner 00 dry, 10 full MAGNET, 01 full SPACE, 11 both — and every slider writes into saved state.'],
      controls: ['XY pad — a bilinear morph of MAGNET × SPACE', 'Four corner targets: 00 dry · 10 full MAGNET · 01 full SPACE · 11 both', 'Corners editable on the XY page (eight sliders)', 'Position is automatable'] },
    { slug: 'ai-suite', full: 'The AI Suite', img: '/assets/mod-chronos-ai.png',
      desc: 'Nine local engines propose — ghost patterns, written summaries — and your sound does not change until you press ACCEPT.',
      body: ['The standing law, in plain words: AI proposes, you dispose. Every AI feature works the same way — it studies your audio or your board and shows you a proposal (a ghost pattern on the board, plus a written summary). Accept is the single moment anything changes; Reject throws the idea away. And it is all local: every engine runs on your machine, and nothing — no audio, no data — ever leaves it. The AI ASSIST master gate governs the suite.',
             'The nine engines, behind the AI button at the top centre of the face: Source ID listens and labels your material — the starting point the other engines build on. Pattern Builder builds a sequencer pattern that fits your source, biased by your Style Memory. Fill & Transition Builder writes a fill into the last four steps only (28–31) — the rest of your pattern is untouched. Smart Randomizer is the DICE engine: downbeats anchored, pitch steps kept in your key. Text-to-FX turns “lofi crush”, “hard tune shimmer”, “wide freeze” into proposed settings. Loop Finder estimates the loop length in your material and arms a quantized capture on accept. Pitch Brain estimates the key of a phrase and proposes the correction settings to match. Clean-Up hears a problem — rumble, mud — and proposes the fix. Style Memory remembers the proposals you accepted and biases future Pattern Builder ideas toward your taste; view it or erase it any time in SETTINGS.'],
      controls: ['Nine engines: Source ID · Pattern Builder · Fill & Transition Builder · Smart Randomizer', 'Text-to-FX · Loop Finder · Pitch Brain · Clean-Up · Style Memory', 'Ghost proposals — ACCEPT is the single moment anything changes', 'AI ASSIST master gate · all local — nothing ever leaves the machine'] },
  ],
};


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
.ptabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}
.ptab{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:8px 16px;font-size:14px;color:var(--muted);cursor:pointer;font:inherit}
.ptab:hover{color:var(--text);border-color:var(--em)}
.ptab.on{color:#02130a;background:var(--em);border-color:var(--em);font-weight:700}
.spotwrap{position:relative;overflow:hidden;border-radius:20px}
.spottrack{display:flex;transition:transform .55s ease}
.spot{min-width:100%}
.spot .feature{margin:0}
.spotdots{display:flex;gap:8px;justify-content:center;padding:14px 0 2px}
.spotbtn{position:absolute;top:34%;width:46px;height:46px;border-radius:50%;border:1px solid var(--line);background:rgba(2,10,7,.82);color:var(--text);font-size:22px;cursor:pointer;line-height:1;z-index:2}
.spotbtn:hover{border-color:var(--em);color:var(--mint)}
@media (prefers-reduced-motion: reduce){.spottrack{transition:none}}
.modnav{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 22px}
.modnav a{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:7px 14px;font-size:14px;color:var(--muted);text-decoration:none}
.modnav a:hover{color:var(--text);border-color:var(--em)}
.modnav a.on{color:#02130a;background:var(--em);border-color:var(--em);font-weight:700}
.modimg{width:100%;max-width:760px;border-radius:16px;border:1px solid var(--line);display:block}
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
<a href="/plugins">Plugins</a><a href="/downloads">Downloads</a><a href="/company">Company</a>
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
  const spotOrder = ['chronos', 'pre', 'delay', 'reverb', 'omega', 'colossus'];
  const spotSlides = spotOrder.map((pid, si) => {
    const p = PLUGINS.find(x => x.id === pid);
    const num = String(PLUGINS.indexOf(p) + 1).padStart(2, '0');
    const trialBtn = p.trial === false
      ? '<button class="btn locked" disabled>Trial coming soon</button>'
      : (req.user
        ? `<button class="btn ghost" data-dl="${p.id}">Download trial</button>`
        : `<a class="btn ghost" href="/auth?notice=${encodeURIComponent('Create an account or sign in to download trials.')}">🔒 Sign in to download</a>`);
    return `
    <div class="spot" role="group" aria-label="Spotlight ${si + 1} of ${spotOrder.length}: ${esc(p.name)}">
      <div class="feature">
        <img class="spotimg" src="${p.img}" alt="${esc(p.name)} plugin interface" loading="lazy">
        <div>
          <div class="tag">Spotlight · ${num} · ${esc(p.sub)} · ${p.version}${p.trial === false ? '' : ' · 30-Day Trial'}</div>
          <h2 style="color:${p.accent}">${esc(p.name)}</h2>
          <p class="hook">${esc(p.hook)}</p>
          <p>${esc(DETAILS[p.id].teaser)}</p>
          <div class="chips">${p.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
          <div class="row">
            <a class="btn" href="/plugins/${p.slug}">Explore ${esc(p.name)} →</a>
            ${trialBtn}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  const spotDots = spotOrder.map((pid, si) => `<button class="cdot${si === 0 ? ' on' : ''}" data-spot="${si}" aria-label="Spotlight: ${esc(PLUGINS.find(x => x.id === pid).name)}"></button>`).join('');
  const chronosFeature = `
  <section class="wrap" id="chronos-feature">
    <div class="spotwrap" id="spotWrap">
      <div class="spottrack" id="spotTrack">${spotSlides}</div>
      <button class="spotbtn cprev" id="spotPrev" aria-label="Previous spotlight plugin">‹</button>
      <button class="spotbtn cnext" id="spotNext" aria-label="Next spotlight plugin">›</button>
    </div>
    <div class="spotdots">${spotDots}</div>
    <script>
    (function(){
      var track=document.getElementById('spotTrack'),total=track.children.length,i=0,timer=null;
      var dots=document.querySelectorAll('[data-spot]');
      var reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function go(n){i=(n+total)%total;track.style.transform='translateX('+(-i*100)+'%)';dots.forEach(function(d,k){d.classList.toggle('on',k===i);});}
      function stop(){if(timer){clearInterval(timer);timer=null;}}
      function auto(){stop();if(!reduced){timer=setInterval(function(){go(i+1);},5500);}}
      document.getElementById('spotNext').addEventListener('click',function(){go(i+1);auto();});
      document.getElementById('spotPrev').addEventListener('click',function(){go(i-1);auto();});
      dots.forEach(function(d){d.addEventListener('click',function(){go(+d.dataset.spot);auto();});});
      var w=document.getElementById('spotWrap');
      w.addEventListener('mouseenter',stop);w.addEventListener('mouseleave',auto);
      w.addEventListener('focusin',stop);w.addEventListener('focusout',auto);
      auto();
    })();
    </script>
  </section>`;
  const explorerPlugins = PLUGINS.map(p => ({ id: p.id, slug: p.slug, name: p.name, accent: p.accent, modules: (EXPLORERS[p.id] || []).map((m, i) => ({ n: i + 1, slug: m.slug, full: m.full, desc: m.desc, img: m.img })) }));
  const preExplorer = explorerPlugins[0];
  const nodes = preExplorer.modules.map((m, i) => `${i ? '<span class="arrow">›</span>' : ''}<button class="node${i === 0 ? ' on' : ''}" data-i="${i}" aria-label="Module ${m.n} ${esc(m.full)}">${m.n}</button>`).join('');
  const ptabs = explorerPlugins.map((ep, i) => `<button class="ptab${i === 0 ? ' on' : ''}" data-p="${ep.id}" aria-label="Explore ${esc(ep.name)} modules">${esc(ep.name)}</button>`).join('');
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
  <section class="wrap blk" id="explorer">
    <h2>Explore the modules</h2>
    <p class="sub">Pick a plugin, then tap a module to cycle it. KSAK-Pre opens the tour — its exact fresh-load order, Loudness last on purpose.</p>
    <div class="ptabs">${ptabs}</div>
    <div class="chain" id="chainNodes">${nodes}</div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
      <img class="chainimg" id="chainImg" src="${preExplorer.modules[0].img}" alt="Module panel">
      <div><div class="tag" id="chainTag">Module 1 of 10 · KSAK-Pre</div><h3 id="chainName" style="margin:6px 0;font-size:28px">${preExplorer.modules[0].full}</h3>
      <p class="muted" id="chainDesc" style="max-width:300px">${preExplorer.modules[0].desc}</p></div>
    </div>
    <script>
    var EXPLORERS=${JSON.stringify(explorerPlugins)};
    (function(){
      var cur=EXPLORERS[0],mi=0;
      var img=document.getElementById('chainImg'),nameEl=document.getElementById('chainName'),tagEl=document.getElementById('chainTag'),descEl=document.getElementById('chainDesc'),nodesEl=document.getElementById('chainNodes');
      function drawNodes(){nodesEl.innerHTML=cur.modules.map(function(m,i){return (i?'<span class="arrow">›</span>':'')+'<button class="node'+(i===mi?' on':'')+'" data-i="'+i+'" aria-label="Module '+m.n+' '+m.full+'">'+m.n+'</button>';}).join('');nodesEl.querySelectorAll('.node').forEach(function(b){b.addEventListener('click',function(){pick(+b.dataset.i);});});}
      function pick(i){mi=i;var m=cur.modules[mi];img.src=m.img;nameEl.textContent=m.full;tagEl.textContent='Module '+m.n+' of '+cur.modules.length+' · '+cur.name;descEl.textContent=m.desc;nodesEl.querySelectorAll('.node').forEach(function(x,k){x.classList.toggle('on',k===mi);});}
      document.querySelectorAll('.ptab').forEach(function(t){t.addEventListener('click',function(){document.querySelectorAll('.ptab').forEach(function(x){x.classList.remove('on');});t.classList.add('on');cur=EXPLORERS.filter(function(e){return e.id===t.dataset.p;})[0];mi=0;drawNodes();pick(0);});});
    })();
    </script>
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

/* ---------- plugins index: the Plugins tab's own page ---------- */
app.get('/plugins', (req, res) => {
  const cards = PLUGINS.map((p, i) => `
  <article class="card">
    <img src="${p.img}" alt="${esc(p.name)} plugin interface" loading="lazy">
    <div class="in">
      <div class="tag">${String(i + 1).padStart(2, '0')} · ${esc(p.sub)} · ${p.version}${p.trial === false ? '' : ' · 30-Day Trial'}</div>
      <h3 style="color:${p.accent}">${esc(p.name)}</h3>
      <p class="hook">${esc(p.hook)}</p>
      <div class="chips">${p.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <a class="cardlink" href="/plugins/${p.slug}">Full details →</a>
    </div>
  </article>`).join('');
  res.send(page('Plugins — The KSAK Suite', `
  <section class="wrap" style="padding:36px 20px 10px">
    <div class="tag">The KSAK Audio Effects Plugin Suite</div>
    <h1 style="font-size:46px;line-height:1.08;margin:8px 0 10px">Six plugins. One suite.</h1>
    <p class="sub muted" style="margin:0 0 22px">A complete vocal chain, two feel-first essentials, and three flagships. Open any plugin for its full story — every trial runs 30 days, then locks.</p>
    ${showcaseCarousel()}
    <div class="grid" style="margin-top:28px">${cards}</div>
  </section>`));
});

/* ---------- company: the Company tab's own page ---------- */
app.get('/company', (req, res) => {
  const suite = PLUGINS.map(p => `
    <li><a href="/plugins/${p.slug}"><b style="color:${p.accent}">${esc(p.name)}</b></a> <span class="muted">— ${esc(p.sub)}. ${esc(p.hook)}</span></li>`).join('');
  res.send(page('Company — KSAK Audio', `
  <section class="wrap" style="padding:36px 20px 10px">
    <div class="tag">The Company</div>
    <h1 style="font-size:46px;line-height:1.08;margin:8px 0 10px">KSAK Audio</h1>
    <p class="sub" style="font-size:19px;margin:0 0 18px">The plugins of the future.</p>
    <div class="bio">
      <p>KSAK Audio builds professional audio plugins. Its product line is the KSAK Audio Effects Plugin Suite — six VST3 plugins for Windows that cover the whole vocal chain and beyond: a complete channel strip, two feel-first essentials, and three flagships.</p>
      <p>Every plugin in the suite is an original design, built to one house standard: low CPU usage with powerful results. A CPU budget is part of each plugin's spec from the start — power is never bought by thinning the sound.</p>
    </div>
    <h2 style="font-size:30px;margin:30px 0 14px">The suite</h2>
    <ul class="feat">${suite}</ul>
    <p class="sub muted">Browse the full suite on the <a href="/plugins">Plugins page</a> — every plugin has its own page with its full story.</p>
    <h2 style="font-size:30px;margin:30px 0 14px">How KSAK Audio works</h2>
    <div class="bio">
      <p><b>30-day trials, right here.</b> KSAK plugins are tried free for 30 days through this site. Downloads are members-only: create a free account and the trials unlock — no account, no download.</p>
      <p><b>Free updates for life.</b> Every KSAK Audio license includes lifetime free updates for the licensed product: buy once, and every future version is free. Updates and new versions are delivered through your KSAK account on this site — sign in and they are there.</p>
      <p><b>Built to a CPU budget.</b> Low CPU usage with powerful results is a flagship feature of every plugin in the suite — both halves, or neither.</p>
    </div>
    <p style="margin-top:26px"><a class="btn" href="/downloads">Get the 30-day trials</a> <a class="btn ghost" href="/auth?mode=signup">Create account</a></p>
  </section>`));
});

/* ---------- downloads: the Downloads tab's own page ---------- */
app.get('/downloads', (req, res) => {
  const rows = PLUGINS.map(p => dlRow(p, req.user)).join('');
  res.send(page('30-Day Trial Downloads', `
  <section class="wrap" style="padding:36px 20px 10px">
    <div class="tag">Members-only trials</div>
    <h1 style="font-size:46px;line-height:1.08;margin:8px 0 10px">30-Day Trial Downloads</h1>
    <p class="sub muted" style="margin:0 0 18px">${req.user ? 'Signed in — downloads are unlocked. Links expire 15 minutes after you tap.' : 'Downloads are members-only. Create a free account — it takes a minute — and the trials unlock. No account, no download: that is the rule.'}</p>
    ${rows}
    <p class="muted" style="font-size:13px">Each trial is a separate build with no unlock inside it: on day 31 it goes silent and locks. Updates and new versions are delivered only through your KSAK account.</p>
    <div id="dlmsg"></div>
    ${req.user ? `<meta name="csrf" content="${esc(req.session.csrf)}">${DL_SCRIPT}` : ''}
  </section>`));
});

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
      <a href="/downloads">All downloads</a>
      <a href="/plugins/${nxt.slug}">${esc(nxt.name)} →</a>
    </div>
  </section>`));
});

/* ---------- showcase carousel: lives on /plugins (the merged Plugins tab) ---------- */
function showcaseCarousel() {
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
  return `
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
    </script>`;
}

/* ---------- showcase: merged into the Plugins tab — old links land on /plugins ---------- */
app.get('/showcase', (req, res) => res.redirect(301, '/plugins'));

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
