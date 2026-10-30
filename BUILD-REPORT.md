# KSAK Site — Build Report (portable deployable copy)

**Built:** 2026-10-30 · **Scope:** code + local verification only. Nothing deployed, no DNS touched, nothing published.
**Stack:** Node 22 / Express 5 / better-sqlite3 (SQLite) — single-file app at `src/server.js`, Docker-ready.

Replicates the approved Muse artifact `ksak-plugins-website-2`: visual-first dark showcase of
all 5 plugins with real screenshots, the KSAK-Pre tap-a-module signal-chain explorer (modules
appear ONLY there), custom accounts, and the 5 verified 30-day trial installers behind sign-in.
Zero personal references; no prices anywhere; footer "© KSAK Audio".

## Verification (local, `npm run verify` → tests/verify.js, throwaway DB + real installers via symlinks)

| Bar | Result |
|---|---|
| Server boots, serves showcase | PASS |
| All 5 plugins listed with real screenshots | PASS |
| All 15 images serve (5 faces + 10 module panels), no 404s | PASS |
| Signal-chain explorer swaps module panels (JS + real panel images) | PASS (code/render check; images byte-copied from booklet set) |
| First account becomes owner; owner opens /owner | PASS |
| Member account created | PASS |
| Duplicate email rejected | PASS |
| Wrong password rejected | PASS |
| Signed-out download attempt blocked (401, no URL in response) | PASS |
| Signed-out pages contain no `/dl/` URL anywhere | PASS |
| Signed-in download — KSAK-Pre byte-exact (10,259,035 B) | PASS |
| Signed-in download — COLOSSUS byte-exact (15,731,331 B) | PASS |
| Sign-out re-locks downloads (401) | PASS |
| Owner view lists both accounts + download activity | PASS |
| Owner view refuses member (403, server-side) | PASS |
| Personal-reference grep (`kurt\|moneyman\|stratford\|shoot for\|johnstown`) in site copy | PASS — zero (only hit in the whole tree is the test's own filter regex) |
| Download link expiry = 15 min | NOT MET as a *timed* test — expiry is enforced in code (`dl_tokens.expires_at`, checked on every `/dl/` hit); waiting 15 min in CI was out of scope. Verify once on deploy day by minting a link and re-hitting it after expiry. |

20/20 automated checks passed (`ALL PASS`).

## Run it locally

```bash
cd ~/workspace/ksak-site
npm install
mkdir -p downloads data
# copy/symlink the 5 TRIAL installers into downloads/ (exact names in README.md)
DOWNLOADS_DIR=./downloads DB_PATH=./data/ksak.db npm start   # http://localhost:3000
npm run verify   # full gate test suite
```

## Config (see .env.example)

`PORT`, `SESSION_SECRET`, `DOWNLOADS_DIR` (default `./downloads`), `DB_PATH`
(default `./data/ksak.db`), `NODE_ENV=production` turns on Secure cookies + HSTS.
Installers are referenced by directory, never copied into the project (`.gitignore`
excludes `downloads/`, `data/`, `.env`).

## Security notes

scrypt password hashing (per-user salt, timing-safe compare), server-side session
tokens stored hashed, httpOnly + SameSite=Lax cookies, CSRF tokens on authenticated
POSTs, rate limit on auth endpoints (30 / 15 min / IP), security headers on every
response, download tokens are 32-byte random, SHA-256 stored, 15-minute expiry,
downloads logged (account, plugin, time).

## Deploy day will need

1. **A host account** (Render / Railway / Fly.io / VPS — Dockerfile included) with a
   **persistent volume for the SQLite DB** and ~51 MB of installer files uploaded.
2. **DNS access at Porkbun** for ksakaudio.com — add the host's records (typically
   `CNAME www → <host target>` and an A/ALIAS for `@`; exact values come from the
   host's custom-domain screen), then wait for HTTPS issuance.
3. **Create the first (owner) account immediately** on the live site before
   sharing the link — first signup is automatically the owner.
4. Spot-check the 15-minute link expiry once live (see NOT MET note above).
