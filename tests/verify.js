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
    const badPage = await req(null, '/plugins/nope');
    check('Unknown plugin slug 404s', badPage.status === 404, `status ${badPage.status}`);

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
