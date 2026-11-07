'use strict';
/* End-to-end verification for the KSAK site gate. Boots a throwaway server. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = '/tmp/ksak-verify';
const PORT = 3219;
const BASE = `http://127.0.0.1:${PORT}`;
const EXPECTED = { pre: 10259266, colossus: 15731331 };
const FILES = {
  pre: '/home/hatch/workspace/goals/ksak-pre-vocal-plugin/files/KSAK-Pre-Setup-v0.3.8-TRIAL.exe',
  delay: '/home/hatch/workspace/goals/ksak-simple-delay/files/KSAK-Simple-Delay-Setup-v0.1.6-TRIAL.exe',
  reverb: '/home/hatch/workspace/goals/ksak-simple-reverb/files/KSAK-Simple-Reverb-Setup-v0.1.5-TRIAL.exe',
  omega: '/home/hatch/workspace/goals/ksak-omega-eq/files/KSAK-Omega-EQ-Setup-v0.1.4-TRIAL.exe',
  colossus: '/home/hatch/workspace/goals/ksak-ultimate-compressor/files/KSAK-Colossus-Setup-v0.1.3-TRIAL.exe',
};
let failures = 0;
const results = [];
function check(name, ok, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
}
class Jar {
  constructor() { this.c = new Map(); }
  absorb(res) { (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach(s => { const [kv] = s.split(';'); const i = kv.indexOf('='); this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }); }
  header() { return [...this.c.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
}
async function req(jar, url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (jar && jar.header()) headers.cookie = jar.header();
  const res = await fetch(BASE + url, { redirect: 'manual', ...opts, headers });
  if (jar) jar.absorb(res);
  return res;
}
const form = (obj) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj).toString() });

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, 'downloads'), { recursive: true });
  for (const f of Object.values(FILES)) fs.symlinkSync(f, path.join(TMP, 'downloads', path.basename(f)));

  const srv = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(TMP, 'ksak.db'), DOWNLOADS_DIR: path.join(TMP, 'downloads'), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let booted = false;
  for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + '/'); if (r.ok) { booted = true; break; } } catch { await new Promise(r => setTimeout(r, 200)); } }
  check('Server boots and serves /', booted);
  if (!booted) { srv.kill(); report(); return; }

  try {
    const home = await (await req(null, '/')).text();
    check('Showcase lists all 6 plugins', ['KSAK-Pre', 'Simple Delay', 'Simple Reverb', 'OMEGA EQ', 'COLOSSUS', 'CHRONOS'].every(n => home.includes(n)));
    check('Signed-out home exposes no /dl/ URL', !home.includes('/dl/'));
    check('Home has zero personal-reference strings', !/kurt|moneyman|stratford|shoot for|johnstown/i.test(home));
    check('Home features the CHRONOS spotlight section', home.includes('id="chronos-feature"') && home.includes('RC-20 meets Effectrix on steroids'));
    check('Home hero has no duplicate Pre image (Pre face appears once, in its roster card)', (home.match(/<img src="\/assets\/pre\.png" alt="KSAK-Pre plugin interface"/g) || []).length === 1 && !home.includes('class="heroimg"'));
    check('Shared layout carries side rails + wide-screen breakpoints (hidden on phones)', home.includes('class="rail rail-l"') && home.includes('class="rail rail-r"') && home.includes('@media(min-width:1280px)') && home.includes('@media(min-width:1560px)') && home.includes('@media(min-width:1760px)') && home.includes('overflow:hidden;display:none'));
    check('Home spotlight + cards link to all 6 plugin pages', ['ksak-pre', 'simple-delay', 'simple-reverb', 'omega-eq', 'colossus', 'ksak-chronos'].every(s => home.includes(`/plugins/${s}`)));

    const PAGES = [
      ['ksak-pre', 'KSAK-Pre', 'whole vocal chain'],
      ['simple-delay', 'Simple Delay', 'slapback voice'],
      ['simple-reverb', 'Simple Reverb', 'five spaces one click apart'],
      ['omega-eq', 'OMEGA EQ', '64 fully independent bands'],
      ['colossus', 'COLOSSUS', 'Seven circuits'],
      ['ksak-chronos', 'KSAK CHRONOS', 'MAGNET clock'],
    ];
    for (const [slug, name, marker] of PAGES) {
      const pr = await req(null, `/plugins/${slug}`);
      const body = await pr.text();
      check(`Plugin page /plugins/${slug} serves with name + bio`, pr.status === 200 && body.includes(name) && body.includes(marker), `status ${pr.status}`);
      check(`Plugin page ${slug}: no forbidden strings, no /dl/ leak, links across pages`, !/kurt|moneyman|stratford|shoot for|johnstown/i.test(body) && !body.includes('/dl/') && body.includes('/plugins/'));
    }
    const chrPage = await (await req(null, '/plugins/ksak-chronos')).text();
    check('CHRONOS page keeps Trial coming soon, no download wiring', chrPage.includes('Trial coming soon') && !chrPage.includes('data-dl="chronos"'));
    check('Plugin pages carry the shared side rails', chrPage.includes('class="rail rail-l"') && chrPage.includes('class="rail rail-r"'));
    const badPage = await req(null, '/plugins/nope');
    check('Unknown plugin slug 404s', badPage.status === 404, `status ${badPage.status}`);

    const showRes = await req(null, '/showcase');
    const show = await showRes.text();
    check('Showcase page serves with all 6 plugins in the slides', showRes.status === 200 && ['KSAK-Pre', 'Simple Delay', 'Simple Reverb', 'OMEGA EQ', 'COLOSSUS', 'KSAK CHRONOS'].every(n => show.includes(n)), `status ${showRes.status}`);
    check('Showcase has working carousel markup + video slot', show.includes('id="ksakCarousel"') && show.includes('id="ksakPrev"') && show.includes('id="ksakNext"') && show.includes('Showcase videos coming soon'));
    check('Showcase links every slide to its plugin page, no forbidden strings, no /dl/ leak', ['ksak-pre', 'simple-delay', 'simple-reverb', 'omega-eq', 'colossus', 'ksak-chronos'].every(s => show.includes(`/plugins/${s}`)) && !/kurt|moneyman|stratford|shoot for|johnstown/i.test(show) && !show.includes('/dl/'));
    check('Nav links to the Showcase page', home.includes('href="/showcase"'));

    // --- Module explorer: all six plugins + per-plugin module data ---
    const EXPECT_COUNTS = { pre: 10, delay: 6, reverb: 6, omega: 8, colossus: 13, chronos: 16 };
    const expMatch = home.match(/var EXPLORERS=(\[.*?\]);/s);
    let EX = null;
    try { EX = JSON.parse(expMatch[1]); } catch { EX = null; }
    check('Homepage explorer embeds all six plugins with correct module counts',
      !!EX && EX.length === 6 && EX.every(ep => ep.modules && ep.modules.length === EXPECT_COUNTS[ep.id]),
      EX ? EX.map(ep => `${ep.id}:${(ep.modules || []).length}`).join(' ') : 'no EXPLORERS match');
    check('Explorer defaults to KSAK-Pre module 1 server-side (Pre UX unchanged)',
      home.includes('id="chainImg" src="/assets/module01.png"') && home.includes('Module 1 of 10 · KSAK-Pre') && home.includes('data-p="pre"') && home.includes('data-p="chronos"'));

    // --- Revolving spotlight: six slides, CHRONOS first ---
    const spotStart = home.indexOf('id="spotTrack"');
    const spotEnd = spotStart >= 0 ? home.indexOf('</section>', spotStart) : -1;
    const spot = spotStart >= 0 && spotEnd > spotStart ? home.slice(spotStart, spotEnd) : '';
    check('Spotlight carousel: 6 slides, CHRONOS slide first, controls + script present',
      (spot.match(/class="spot"/g) || []).length === 6 && spot.indexOf('KSAK CHRONOS') >= 0 && spot.indexOf('KSAK CHRONOS') < spot.indexOf('KSAK-Pre') && home.includes('id="spotPrev"') && home.includes('id="spotNext"') && home.includes('data-spot="5"') && home.includes('prefers-reduced-motion'));
    check('Spotlight slides carry every plugin teaser + page link',
      ['ksak-pre', 'simple-delay', 'simple-reverb', 'omega-eq', 'colossus', 'ksak-chronos'].every(s => spot.includes(`/plugins/${s}`)) && ['whole vocal chain in a single window', 'tape-style echo', 'Five spaces one click apart', '64 fully independent bands', 'Seven circuits, three architectures'].every(t => spot.includes(t)));
    check('Spotlight CHRONOS slide keeps Trial coming soon, no data-dl wiring',
      spot.includes('Trial coming soon') && !spot.includes('data-dl="chronos"'));

    // --- Module pages: one per module (59 total) ---
    let modPagesOk = true, modDetail = '';
    const allImgs = new Set();
    if (EX) for (const ep of EX) {
      const pr = await (await req(null, `/plugins/${ep.slug}`)).text();
      const links = (pr.match(new RegExp(`/plugins/${ep.slug}/modules/`, 'g')) || []).length;
      if (links < ep.modules.length) { modPagesOk = false; modDetail += `${ep.id}:links=${links} `; }
      for (const md of ep.modules) {
        allImgs.add(md.img);
        const mr = await req(null, md.href);
        const mb = await mr.text();
        const mbText = mb.replace(/&amp;/g, '&');
        const okm = mr.status === 200 && mbText.includes(md.full) && mb.includes(ep.name)
          && !/kurt|moneyman|stratford|shoot for|johnstown/i.test(mb) && !mb.includes('/dl/')
          && !mb.includes('data-dl="chronos"');
        if (!okm) { modPagesOk = false; modDetail += `${md.href}:${mr.status} `; }
      }
    }
    check('All 59 module pages serve with module + plugin name, clean, correctly wired; plugin pages link them all', modPagesOk, modDetail);
    const badMod = await req(null, '/plugins/ksak-pre/modules/nope');
    const badMod2 = await req(null, '/plugins/nope/modules/nope');
    check('Unknown module slugs 404', badMod.status === 404 && badMod2.status === 404, `${badMod.status}/${badMod2.status}`);

    let expImgOk = true;
    for (const u of allImgs) { const r = await fetch(BASE + u); if (!r.ok) expImgOk = false; await r.arrayBuffer(); }
    check('All explorer/module images serve', expImgOk, `${allImgs.size} unique images`);

    let allImg = true;
    for (const a of ['pre', 'delay', 'reverb', 'omega', 'colossus', 'chronos', 'module01', 'module02', 'module03', 'module04', 'module05', 'module06', 'module07', 'module08', 'module09', 'module10']) {
      const r = await fetch(`${BASE}/assets/${a}.png`); if (!r.ok) allImg = false; await r.arrayBuffer();
    }
    check('All 16 images serve (6 faces + 10 modules)', allImg);

    const anon = await req(null, '/api/download-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plugin: 'pre' }) });
    const anonBody = await anon.text();
    check('Signed-out download attempt blocked', anon.status === 401 && !anonBody.includes('/dl/'), `status ${anon.status}`);

    const owner = new Jar();
    let r = await req(owner, '/auth/signup', form({ name: 'Site Owner', email: 'owner@example.test', password: 'owner-pass-123' }));
    check('Owner (first account) signs up → /account', r.status === 302 && (r.headers.get('location') || '').includes('/account'));
    r = await req(owner, '/owner');
    check('Owner can open /owner', r.status === 200);

    const dup = new Jar();
    r = await req(dup, '/auth/signup', form({ name: 'Copy Cat', email: 'owner@example.test', password: 'whatever-123' }));
    check('Duplicate email rejected', (r.headers.get('location') || '').includes('already%20exists') || decodeURIComponent(r.headers.get('location') || '').includes('already exists'));
    r = await req(dup, '/auth/signin', form({ email: 'owner@example.test', password: 'wrong-password' }));
    check('Wrong password rejected', decodeURIComponent(r.headers.get('location') || '').includes('incorrect'));

    const member = new Jar();
    r = await req(member, '/auth/signup', form({ name: 'Test Member', email: 'member@example.test', password: 'member-pass-123' }));
    check('Member signs up', r.status === 302);
    r = await req(member, '/owner');
    check('Owner view refuses member', r.status === 403);
    const acct = await (await req(member, '/account')).text();
    const csrf = (acct.match(/meta name="csrf" content="([a-f0-9]+)"/) || [])[1];
    check('Account page carries CSRF token', !!csrf);

    for (const pid of ['pre', 'colossus']) {
      const linkRes = await req(member, '/api/download-link', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ plugin: pid }) });
      const j = await linkRes.json();
      check(`Signed-in link minted for ${pid}`, !!j.url && j.url.startsWith('/dl/'));
      const dl = await fetch(BASE + j.url);
      const buf = await dl.arrayBuffer();
      check(`Signed-in download of ${pid} is byte-exact`, dl.status === 200 && buf.byteLength === EXPECTED[pid], `${buf.byteLength} B vs expected ${EXPECTED[pid]} B`);
    }

    const chrRes = await req(member, '/api/download-link', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ plugin: 'chronos' }) });
    const chrBody = await chrRes.text();
    check('CHRONOS has no trial download yet (503, no URL)', chrRes.status === 503 && !chrBody.includes('/dl/'), `status ${chrRes.status}`);

    const ownerView = await (await req(owner, '/owner')).text();
    check('Owner view lists both accounts', ownerView.includes('owner@example.test') && ownerView.includes('member@example.test'));
    check('Owner view shows download activity', /KSAK-Pre/.test(ownerView) && /COLOSSUS/.test(ownerView) && /Download activity/.test(ownerView));

    await req(member, '/auth/signout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf }).toString() });
    const after = await req(member, '/api/download-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plugin: 'pre' }) });
    check('After sign-out, downloads re-lock', after.status === 401);
  } finally { srv.kill(); }
  report();
}
function report() {
  console.log(results.join('\n'));
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
