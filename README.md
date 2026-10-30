# KSAK Audio — Plugins Website

Public showcase + custom accounts + gated 30-day trial downloads for the
KSAK Audio Effects Plugin Suite (KSAK-Pre, Simple Delay, Simple Reverb,
OMEGA EQ, COLOSSUS). Node.js + Express + SQLite (better-sqlite3) — one small
app, no build step.

## Run it locally

```bash
npm install
mkdir -p downloads data
# put the 5 TRIAL installers in downloads/ (exact names):
#   KSAK-Pre-Setup-v0.3.6-TRIAL.exe
#   KSAK-Simple-Delay-Setup-v0.1.4-TRIAL.exe
#   KSAK-Simple-Reverb-Setup-v0.1.3-TRIAL.exe
#   KSAK-Omega-EQ-Setup-v0.1.4-TRIAL.exe
#   KSAK-Colossus-Setup-v0.1.3-TRIAL.exe
cp .env.example .env   # set SESSION_SECRET to a long random string
DOWNLOADS_DIR=./downloads DB_PATH=./data/ksak.db npm start
# http://localhost:3000
```

The first account created becomes the **owner** account — create it first.
Owners get `/owner` (all accounts + download activity). Passwords are
scrypt-hashed; sessions are server-side tokens in httpOnly cookies.

Verify everything end-to-end (boots a throwaway instance, creates test
accounts, exercises the gate): `npm run verify`

## How the gate works

- Signed-out visitors see locked download buttons. No download URL exists
  anywhere in the pages or API for them.
- Signed-in members tap Download → the server checks the session, mints a
  one-plugin link that expires in **15 minutes** (unguessable random token),
  and the file streams from `/dl/<token>`. Every download is logged
  (account, plugin, time) and shows in My Account and the owner view.

## Deploy notes

Any host that runs a small Node app with a persistent disk works:

- **Render / Railway / Fly.io**: use the included `Dockerfile` (or the Node
  runtime with `npm start`). Set env vars from `.env.example`. Attach a
  **persistent volume** mounted at `/app/data` (SQLite) — without it,
  accounts vanish on redeploy. Put the 5 installers in `/app/downloads`
  (or point `DOWNLOADS_DIR` at wherever they live) — total ≈ 51 MB.
- **VPS**: `git clone`, `npm ci`, run under systemd/pm2 with the same env
  vars, reverse-proxy (nginx/Caddy) for HTTPS.

### DNS (at Porkbun, when deploy day comes)

Exact records come from the chosen host's docs; typically one of:

- Root domain on a host that supports ALIAS/ANAME or a static IP:
  `A  @  <host IP>` (or ALIAS `@` → host target), plus
  `CNAME  www  <host target>` so `www.ksakaudio.com` lands on the app too.
- Hosts that give a target hostname (Render/Railway/Fly custom domains):
  follow their custom-domain screen — it shows the exact CNAME/A values to
  paste into Porkbun DNS, then wait for their HTTPS certificate to issue
  before announcing the site.

Do not change DNS until the host is chosen and the app is verified running
on the host's own URL first.
