# LUXWELD Warranty — Project Handoff (full context)

> Paste-and-go context for a fresh Claude Code session. This captures everything
> built and discussed. Read this file first, then continue with the OPEN ITEMS.

## What this is
A warranty & insurance registration web app for **LUXWELD** skylight flashing.
Each physical flashing gets a QR code → opens a public web page → installers
register the install (details + 4 photos) with **no login**; production staff and
admins **do** log in. Premium **black/gold** LUXWELD UI, mobile-first.

- **Live site:** https://warranty.luxweld.com.au
- **GitHub:** github.com/flynnanderson3695-bit/LUXWELD (branch `main`)
- **Host:** Railway (auto-deploys on every push to `main`), 1 replica, US West,
  persistent **Volume mounted at `/data`**. DNS via **Crazy Domains** (CNAME →
  Railway).
- **CEO:** Jono, email `jono@luxweld.com.au` (the only admin account).
- **Owner/dev:** Flynn.

## Tech stack
Node **24** (pinned via `.nvmrc` + package.json engines — required for built-in
`node:sqlite`). Express + EJS + Tailwind (CDN). No build step. Deps: `express`,
`ejs`, `cookie-parser`, `express-session`, `passport` + `passport-google-oauth20`
+ `passport-apple`, `multer`, `qrcode`, `csv-stringify`, `nanoid`,
`@aws-sdk/client-s3` + `@aws-sdk/lib-storage`, `archiver`. DB = **`node:sqlite`**
(built-in; we deliberately avoided better-sqlite3 — it failed to compile).

Start: `npm start` (= `node --env-file-if-exists=.env src/server.js`). Railway
uses `railway.json` (Nixpacks, `npm start`, healthcheck `/health`).

## Repo structure
```
src/server.js          Express wiring, middleware, storage guard, daily scheduler
src/db.js              node:sqlite init, versioned migrations, seeding, settings kv
src/lib/config.js      ALL env config + storage-path resolution (critical)
src/lib/auth.js        roles, sessions, user CRUD, OAuth upsert
src/lib/passport.js    Google/Apple strategies (registered only if configured)
src/lib/password.js    scrypt hashing
src/lib/queries.js     product/record queries, listProducts, getFullProduct
src/lib/warranty.js    warranty dates + live status
src/lib/records.js     recordInfo/recordText + writeLocalInfo (self-describing)
src/lib/cloud.js       R2/S3 mirror (best-effort, gated) — OFF unless R2_* set
src/lib/archive-site.js Builds the STANDALONE static archive website
src/lib/drive.js       Google Drive automatic backup (OAuth + daily zip upload)
src/routes/auth.js     login (email/pw), Google/Apple, /account, /pending, logout
src/routes/public.js   /p/:serial landing, install form + 4 photos, /app, /health-ish
src/routes/production.js production home + registration + 4 photos
src/routes/admin.js    dashboard, generate QR, detail/edit/cancel/reset, users,
                       CSV, archive page, zips, cloud sync, DRIVE connect/backup
views/*.ejs            all pages (LUXWELD black/gold)
public/                manifest.webmanifest, sw.js, icons, (logo if added)
mobile/                Capacitor wrapper (com.luxweld.warranty) — thin shell
scripts/smoke.mjs      self-contained test suite (47 checks) — `npm run smoke`
scripts/build-archive.mjs  CLI to build the standalone archive site
scripts/gen-icons.mjs      PWA icon generator
scripts/set-app-url.mjs    sets mobile/www/app-config.js
.claude/skills/run-luxweld-warranty/  the /run skill
.claude/launch.json    preview servers: luxweld, archive-site, mobile-shell
railway.json .nvmrc .env.example README.md
```

## Database (SQLite, schema version 4)
Tables: `users`, `product`, `production_registration`, `installation_registration`,
`photo` (`kind` = PRODUCTION|INSTALLATION, 4 angles each), `warranty`,
`app_settings` (key/value — stores Drive tokens), `product_type` (legacy/unused).
Migrations live in `src/db.js` (v0→2→3→4). `app_settings` added via
CREATE IF NOT EXISTS (no version bump). **DB auto-migrates on boot.**

Photos are stored as FILES under `UPLOAD_DIR/<serial>/` (`prod-*`, `inst-*`), DB
holds only the path. Each serial folder also gets `info.json` + `record.txt`
(self-describing) written on every registration/edit.

## Roles & auth
Roles: **admin, production, installer, pending** (in the DB, never trusted from
the OAuth provider). admin ⊇ production. New Google/Apple sign-ins → `installer`
unless email is in `ADMIN_EMAILS`/`PRODUCTION_EMAILS`. Installers need **no
login** for the public QR flow.

- **Login:** email + password (local, scrypt) **and** Google OAuth (Apple hidden
  unless configured). App session = signed `uid` cookie; `express-session` is
  only for the OAuth handshake (MemoryStore — fine for 1 replica, replace if
  scaling).
- **Seeded admin:** on first boot with an EMPTY users table, seeds one admin from
  `ADMIN_EMAIL` (jono@luxweld.com.au) + `ADMIN_PASSWORD`. In production, NO admin
  is seeded if `ADMIN_PASSWORD` is unset. Dev also seeds mike/sara (production).
  ⚠️ `seedUsers()` only runs when the users table is empty — changing
  `ADMIN_PASSWORD` later does NOT reset an existing admin's password.

## Features built
- QR generation (admin) → serials `SKY-XXXXXXXX`; QR encodes `BASE_URL/p/:serial`;
  printable label sheet.
- Production registration: tag (Tile/Corrugated/M25/M40/Custom + required custom
  desc), auto today's date, auto signed-in user, **4 production photos required**.
- Installer registration (public): installer name/company/phone/email, site
  name/address, date (default today), notes, **4 installed photos required**;
  "Remember my details" (localStorage), "Get the app" CTA, source tracking
  (web/pwa/android/ios). Blocked before production; duplicates blocked (admin can
  reset).
- Warranty: starts from production date, default 10 years; statuses: Awaiting
  Production → Ready for Installation → Active/Expired, plus Incomplete/Cancelled.
- Admin dashboard: search/filter, product detail (both photo sets separately,
  edit, reset-installation, cancel/restore), CSV export, user/role management,
  generate QR.
- PWA: manifest + icons + apple-touch + conservative service worker; installable.
- Mobile wrapper: Capacitor scaffold in `mobile/` (appId `com.luxweld.warranty`);
  self-driving shell loads `LUXWELD_APP_URL`; `npm run set-app-url`.
- **Records Archive** (`/admin/archive`): LUXWELD gallery of every warranty +
  photos + info; downloads: per-record `bundle.zip`, all `archive.zip`, and the
  standalone `archive-site.zip`.
- **Standalone archive WEBSITE** (`src/lib/archive-site.js`): separate, self-
  contained static site (index + per-record pages + photos), LUXWELD-styled,
  rebuilt on boot + daily to `/data/archive-site`. Opens offline, host anywhere.
- **Cloud mirror (R2/S3)** (`src/lib/cloud.js`): best-effort per-warranty mirror
  + DB snapshots. **OFF** (no `R2_*` creds set). Gated, never blocks a save.
- **Google Drive backup** (`src/lib/drive.js`): admin clicks "Connect Google
  Drive" (OAuth `drive.file`), server then uploads the archive zip DAILY to a
  "LUXWELD Warranty Archive" folder; "Back up now" button reports success/fail.
  **Built but NOT configured/connected yet** (needs Google Cloud OAuth client).

## 🔴 The data-loss incident (institutional memory — never repeat)
Root cause: `DB_PATH` and `UPLOAD_DIR` in Railway were **relative** (`./data/...`),
so SQLite + photos were written into the app's code dir (`/app/data`), which
Railway **wipes on every deploy**. The Volume at `/data` was mounted but **never
used** (empty `lost+found` only). A deploy wiped everything; there were no backups
(not Railway Pro, no external backup configured, volume empty). **Data was
unrecoverable.** Recovery leads given to Flynn: any saved CSV export + installers'
phones (photo originals).

**Fix already shipped** (commit `94296ce`): `src/lib/config.js` now forces storage
onto the volume — prefers `RAILWAY_VOLUME_MOUNT_PATH` (or `/data` in prod) and
IGNORES a relative `DB_PATH`/`UPLOAD_DIR`. `src/server.js` **refuses to start** in
production if storage is on ephemeral disk (logs a big error). So this exact trap
can't silently recur. Verified locally (data lands on the volume; ephemeral prod
exits). The old relative Railway vars can stay (now ignored) but ideally set
`DB_PATH=/data/app.db` and `UPLOAD_DIR=/data/uploads` (absolute) and remove the
`./` ones.

## Environment variables (Railway)
Required/used: `NODE_ENV=production`, `BASE_URL=https://warranty.luxweld.com.au`,
`SESSION_SECRET` (or legacy `COOKIE_SECRET`), `DB_PATH` (should be `/data/app.db`),
`UPLOAD_DIR` (should be `/data/uploads`), `ADMIN_EMAIL=jono@luxweld.com.au`,
`ADMIN_PASSWORD`. Railway injects `RAILWAY_VOLUME_MOUNT_PATH=/data` and `PORT`.
Recovery: `RESET_ADMIN_PASSWORD=1` — on boot, forces the `ADMIN_EMAIL` account's
password to `ADMIN_PASSWORD` + admin role (creates it if missing). The escape
hatch for a locked-out admin. **Unset it after use** (it re-fires every deploy
while set). Inert unless set. Added in commit `a5974a5`.
Optional: `ADMIN_EMAILS`, `PRODUCTION_EMAILS`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `APPLE_*`, `R2_ENDPOINT`/`R2_BUCKET`/
`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (or `S3_*`), `CLOUD_PREFIX`,
`DRIVE_CALLBACK_URL`, `DRIVE_FOLDER_NAME`, `LUXWELD_APP_URL`,
`SEED_PRODUCTION_PASSWORD`. All documented in `.env.example` + README.

## Dev workflow
- Run/test: `npm install`, `npm start` (localhost:3000), `npm run smoke` (47/47).
- Preview (screenshots): `.claude/launch.json` configs + Claude preview tools, or
  the `/run-luxweld-warranty` skill.
- Deploy: commit → `git push origin main` → Railway auto-builds & deploys.
- Verify live: `curl https://warranty.luxweld.com.au/health` → `{"status":"ok"}`.
- Local Windows note: free port 3000 with PowerShell `Get-NetTCPConnection
  -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id
  $_.OwningProcess -Force }` (pkill doesn't match node on Windows).

## Recent commits (newest first)
`b32786b` Google Drive auto-backup · `c8926fd` standalone archive website ·
`94296ce` storage fix (volume) · `aba940e` records archive + R2 cloud mirror +
self-describing storage · `b68c59f` real auth (Google/Apple + 4 roles) ·
`0c35822` Railway-ready.

## Deploy-crash emails — CONFIRMED root cause & fix (2026-07-10)
Flynn's "deployment crashed / site is down" emails on every work session were
NOT credit/billing (usage $1.57, over-limit no) and NOT a steady-state crash
(deploys run SUCCESS/healthy). **True root cause (found via the superseded
deploy's logs: `npm error signal SIGTERM`):** the container started via
`npm start`, so **npm was PID 1**. On redeploy Railway's SIGTERM hit npm, which
exits with an error WITHOUT cleanly forwarding the signal to Node — so the
graceful handler never ran and Railway logged the old container as CRASHED →
alert email. The graceful-shutdown handler (commit `4238698`) was necessary but
not sufficient on its own because npm swallowed the signal.
**Fix (commit `aa5adf0`):** `railway.json` `startCommand` →
`node --env-file-if-exists=.env src/server.js` (Node is now PID 1 and receives
SIGTERM directly) + hardened handler (`closeIdleConnections()` immediately,
`closeAllConnections()` after 300ms, 2.5s hard-exit cap) so it exits(0) inside
the SIGKILL window. **PROVEN in production** via a controlled `railway redeploy`:
the outgoing node-direct container logged "Received SIGTERM → Clean shutdown
complete" and its deployment status was **REMOVED (clean), not CRASHED**. NOTE:
volume services still can't overlap, so every deploy has a ~30–60s unavailability
gap (inherent on any plan) — the fix removes the *crash email*, not the brief gap.

## Railway access & config state (2026-07-09)
Railway CLI installed + logged in as `flynn.anderson3695@gmail.com` on Flynn's
machine (project **gracious-curiosity**, service **LUXWELD**, env production,
linked in the repo dir). ⚠️ Use PowerShell (not Git Bash) for `railway variable
set` with path values — MSYS mangles leading-slash args. `--skip-deploys` stages
vars for the next deploy (batch changes = fewer deploy blips/emails).
Vars corrected this session: `BASE_URL` → `https://warranty.luxweld.com.au` (was
the `.up.railway.app` domain — QR links + OAuth callbacks derive from it!),
`DB_PATH`/`UPLOAD_DIR` → absolute `/data/...`, `DATABASE_URL` → `/data/app.db`
(was a website URL; ideally delete it someday — delete has no --skip-deploys).
`RESET_ADMIN_PASSWORD=0` is STAGED, applies on next deploy (closes the hatch).
💰 Credits emergency: free plan, ~$3 left — Flynn is upgrading to Hobby (site
stops at $0). Billing can't be done via CLI.

## 🚧 OPEN ITEMS (do these next)
1. **✅ LOGIN FIXED & VERIFIED LIVE (2026-07-09).** Root cause: `seedUsers()`
   only runs on an empty users table, so `ADMIN_PASSWORD` changes couldn't reset
   the locked-out admin. Fix `RESET_ADMIN_PASSWORD=1` (commit `a5974a5`) ran in
   production: deploy logs show the reset line; live POST /login as
   `jono@luxweld.com.au` returned 302 → /admin. Jono has a temp password (given
   to Flynn) and must set his own via **Users**. Hatch already staged closed.
2. **PHYSICAL + CLOUD backup — design settled, cloud shipped.** Cloud = Google
   Drive **searchable per-record folder mirror** (commit `0989663`, DEPLOYED):
   instant push after each registration + daily staleness check + DB snapshot;
   Jono searches Drive itself (serial/installer/site/date in folder names,
   record.txt full-text-indexed). Physical = **Google Drive for desktop relay**
   on a 24/7 PC mirroring to a big external drive (Flynn's choice over a custom
   agent) — setup steps in `BACKUP-AND-RECOVERY.md`. Manual gold "Physical
   backup" panel on `/admin/archive` (commit `8af5eed`) remains as a snapshot
   option. R2 mirror still available but off.
3. **Google Drive backup — finish setup.** App side is DONE + DEPLOYED. Needs a one-time
   Google Cloud OAuth client (free): enable Drive API, OAuth consent screen
   (External, **Publish to production**, add scope `.../auth/drive.file`), add
   redirect URI `https://warranty.luxweld.com.au/admin/drive/callback`, set
   `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in Railway, then Archive → **Connect
   Google Drive** (as Jono) → **Back up now** to verify a zip lands in his Drive.
   Full steps in README → "Google Drive backup".
4. **Prove the storage fix worked:** confirm deploy logs show PERSISTENT VOLUME ✓,
   then add one test entry, redeploy, confirm it survives. Optionally set the
   Railway `DB_PATH`/`UPLOAD_DIR` to absolute `/data/...` and drop the `./` ones.
5. Nice-to-haves: replace express-session MemoryStore before scaling to >1
   replica; Apple sign-in still not configured (button hidden — fine).

## Golden rules
- Never let production storage be relative/ephemeral (guard is in place).
- Every change: `npm run smoke` must pass, then push (Railway auto-deploys).
- Back up BEFORE trusting: don't tell the user data is safe until it's verified
  landing somewhere off-Railway (Drive/physical), with a visible success signal.
