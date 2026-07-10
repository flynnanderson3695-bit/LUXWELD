# LUXWELD Warranty — Project Handoff (full context)

> Paste-and-go context for a fresh Claude Code session. Read this file first,
> then continue with the OPEN ITEMS at the bottom.
> **Last updated: 2026-07-10** (end of the backup/crash-fix session).

## What this is
A warranty & insurance registration web app for **LUXWELD** skylight flashing.
Each physical flashing gets a QR code → opens a public web page → installers
register the install (details + 4 photos) with **no login**; production staff and
admins **do** log in. Premium **black/gold** LUXWELD UI, mobile-first.

- **Live site:** https://warranty.luxweld.com.au
- **GitHub:** github.com/flynnanderson3695-bit/LUXWELD (branch `main`) — ⚠️ **PUBLIC repo**
- **Host:** Railway, **Pro plan** (paid 2026-07-10), 1 replica, US West,
  persistent **Volume mounted at `/data`**. Auto-deploys on push to `main`.
  DNS via **Crazy Domains** (CNAME → Railway).
- **CEO:** Jono, `jono@luxweld.com.au` (the only admin account).
- **Owner/dev:** Flynn.

## 🔐 Secrets policy (the repo is PUBLIC)
Never commit: the admin password, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, or the
private Drive folder URL. Verified 2026-07-10: **no real secrets are in git history**
(`GOCSPX-` appears only as placeholder text in the guides). `.gitignore` correctly
excludes `data/` (customer photos + DB), `.env`, and `.claude/settings.local.json`
(which does contain the admin password locally, from allowlisted curl commands).
- **Jono's admin password:** Flynn has it. If ever lost → use `RESET_ADMIN_PASSWORD` (below).
- **Drive folder URL:** don't hardcode it — it renders on `/admin/archive`
  ("View backups in Drive"), sourced from `app_settings.drive_folder_id`.

## Tech stack
Node **24** (pinned via `.nvmrc` + package.json engines — required for built-in
`node:sqlite`). Express + EJS + Tailwind (CDN). No build step. Deps: `express`,
`ejs`, `cookie-parser`, `express-session`, `passport` + `passport-google-oauth20`
+ `passport-apple`, `multer`, `qrcode`, `csv-stringify`, `nanoid`,
`@aws-sdk/client-s3` + `@aws-sdk/lib-storage`, `archiver`. DB = **`node:sqlite`**
(built-in; we deliberately avoided better-sqlite3 — it failed to compile).

**Start command:** `railway.json` runs **`node --env-file-if-exists=.env src/server.js`
directly — NOT `npm start`** (npm as PID 1 swallowed SIGTERM; see crash-email section).
Locally `npm start` is still fine. Healthcheck `/health`.

## Repo structure
```
src/server.js          Express wiring, storage guard, maintenance tick, GRACEFUL SHUTDOWN
src/db.js              node:sqlite init, migrations, seeding, applyAdminReset(), settings kv
src/lib/config.js      ALL env config + storage-path resolution (critical) + RESET_ADMIN_PASSWORD
src/lib/auth.js        roles, sessions, user CRUD, OAuth upsert
src/lib/passport.js    Google/Apple strategies (registered only if configured)
src/lib/password.js    scrypt hashing
src/lib/queries.js     product/record queries, listProducts, getFullProduct
src/lib/warranty.js    warranty dates + live status
src/lib/records.js     recordInfo/recordText + writeLocalInfo (self-describing)
src/lib/cloud.js       R2/S3 mirror (best-effort, gated) — OFF unless R2_* set
src/lib/archive-site.js Builds the STANDALONE static archive website
src/lib/drive.js       Google Drive SEARCHABLE per-record folder mirror (see below)
src/routes/auth.js     login (email/pw), Google/Apple, /account, /pending, logout
src/routes/public.js   /p/:serial landing, install form + 4 photos, /app
src/routes/production.js production home + registration + 4 photos
src/routes/admin.js    dashboard, QR, detail/edit/cancel/reset, users, CSV, archive,
                       zips, cloud sync, DRIVE connect/backup-now/disconnect
views/*.ejs            all pages (LUXWELD black/gold, Michroma wordmark)
public/brand/          luxweld-logo-full.png (960x304 source), mark.png (cropped icon)
public/                manifest.webmanifest, sw.js, icon-192/512, apple-touch-icon
mobile/                Capacitor wrapper (com.luxweld.warranty) — thin shell
scripts/smoke.mjs      self-contained test suite (47 checks) — `npm run smoke`
scripts/build-archive.mjs      CLI to build the standalone archive site
scripts/gen-icons.mjs          PWA icon generator
scripts/set-app-url.mjs        sets mobile/www/app-config.js
scripts/build-jono-guide-pdf.py  regenerates the Jono PDF (needs `pip install reportlab`)
BACKUP-AND-RECOVERY.md   plain-English guide (Flynn + Jono): 3 copies, routines, recovery
JONO-SETUP.md            Jono's 5-step checklist
GOOGLE-DRIVE-SETUP.md    click-by-click Google Cloud OAuth walkthrough
JONO-EMAIL-INSTRUCTIONS.txt  plain-text emailable version (linear, with "wait for Flynn" steps)
LUXWELD-Setup-Guide-for-Jono.pdf  combined branded PDF (generated)
railway.json .nvmrc .env.example README.md
```

## Database (SQLite, schema version 4)
Tables: `users`, `product`, `production_registration`, `installation_registration`,
`photo` (`kind` = PRODUCTION|INSTALLATION, 4 angles each), `warranty`,
`app_settings` (key/value — Drive tokens, folder id, per-record sync hashes),
`product_type` (legacy/unused). Migrations in `src/db.js` (v0→2→3→4). **Auto-migrates on boot.**

Photos stored as FILES under `UPLOAD_DIR/<serial>/` (`prod-*`, `inst-*`); DB holds
only the path. Each serial folder also gets `info.json` + `record.txt` (self-describing).

⚠️ **The live production DB is currently EMPTY (0 records)** as of 2026-07-10 —
a fresh start after the data-loss incident. Nothing has been re-entered yet.

## Roles & auth
Roles: **admin, production, installer, pending** (in the DB, never trusted from the
OAuth provider). admin ⊇ production. New Google sign-ins → `installer` unless the
email is in `ADMIN_EMAILS`/`PRODUCTION_EMAILS`. Installers need **no login** for the
public QR flow.

- **Login:** email + password (local, scrypt) **and** Google OAuth (now enabled —
  `GOOGLE_CLIENT_ID`/`SECRET` are set). Apple hidden (unconfigured). App session =
  signed `uid` cookie; `express-session` only for the OAuth handshake (MemoryStore —
  fine for 1 replica).
- **Seeded admin:** only on first boot with an EMPTY users table (`seedUsers()`).
  ⚠️ Changing `ADMIN_PASSWORD` later does **NOT** reset an existing admin.
- **🔑 Admin lock-out recovery (`applyAdminReset()` in db.js, commit `a5974a5`):**
  set `RESET_ADMIN_PASSWORD=1` + `ADMIN_PASSWORD=<new>` in Railway → on boot it forces
  the `ADMIN_EMAIL` account's password + admin role + active flag (creates it if
  missing). Idempotent, inert unless set. **Unset it afterwards** (it re-fires each
  deploy while set). Currently `RESET_ADMIN_PASSWORD=0`.
- Admin can change any user's password at **/admin/users**.

## 🗄️ Backup architecture — THREE copies (the core deliverable)
| Copy | Where | How it updates | Status |
|---|---|---|---|
| 1. Live | Railway volume `/data` | Every save | ✅ |
| 2. Cloud | Jono's Google Drive | Instantly per registration + daily check | ✅ **LIVE** |
| 3. Physical | 24/7 factory PC + 2TB SSD | Google Drive for desktop (Mirror mode) | ⏳ **Monday** |

### Cloud: Google Drive searchable mirror (`src/lib/drive.js`, commit `0989663`)
Replaced the old daily-zip design (a zip is unsearchable in Drive). Now:
- **One Drive folder per record**, named with everything Jono would search:
  `SKY-XXXX · tag · produced DATE · installed DATE · Installer (Company) · Site — Address`
- Inside: all 8 photos (readable names) + `record.txt` (**Drive full-text-indexes it**,
  so any detail is searchable) + `info.json`. Plus a `LUXWELD database snapshot.db`
  updated in place at the folder root.
- **Incremental:** per-record content fingerprint (`recordFingerprint`, excludes
  `generated_at`) stored in `app_settings` as `drive_rec_<serial>`. Unchanged records
  are skipped. "Back up now" (`force:true`) additionally verifies unchanged folders
  still exist in Drive and re-uploads any that were deleted. Changed records get the
  old folder **trashed** (recoverable 30 days) and re-uploaded.
- **Instant push** after every registration/edit via `mirrorSerialToDriveAsync()`
  (best-effort `setImmediate`, never blocks or fails a save) + a daily full check.
- Scope `drive.file` (least privilege — only sees files it created).
- **Scheduler fix:** the old 24h `setInterval` reset on every deploy, so the "daily"
  backup could never fire. Now `maintenanceTick()` runs 60s after boot then hourly,
  and checks **staleness from the DB** (`drive_last_backup`), so a missed backup
  catches up within a minute of boot.
- Jono views it via **/admin/archive → "📂 View backups in Drive ↗"** (commit `2fd5bbc`),
  or Google Drive's own search bar.

**Google Cloud setup (done 2026-07-10):** project `luxweld-warranty`, Drive API
enabled, consent screen **Published/In production** (Testing mode expires refresh
tokens after 7 days!), OAuth Web client with redirect URIs
`/admin/drive/callback` **and** `/auth/google/callback`. Creds live only in Railway.

### Physical: Google Drive for desktop relay (chosen over a custom agent)
A website **cannot push into a home PC** (NAT/firewall). So: install Google Drive for
desktop on the always-on factory PC, sign in as the LUXWELD Google account, choose
**Mirror files** (not Stream), point the folder at the 2TB SSD, disable sleep. It
continuously mirrors the same archive down to the drive. Destination is changed in
that app's Preferences (not via the website). Steps in `BACKUP-AND-RECOVERY.md`.

### Also available
- **Manual physical snapshot:** gold "Physical backup" panel at the top of
  `/admin/archive` → **⬇ Download everything (.zip)** = the self-contained archive
  website; unzip → open `index.html` → browses offline, no login (commit `8af5eed`).
- **R2/S3 mirror** (`src/lib/cloud.js`): built, **OFF** (no `R2_*` creds).

## 📏 Storage sizing (for the physical drive)
**No compression anywhere** — photos are stored exactly as the phone captures them
(`accept="image/*" capture="environment"`, no `sharp`, no client-side canvas).
Per-photo cap: **12 MB** (`multer limits`), 8 photos/flashing. Text (`info.json` +
`record.txt`) is ~3–5 KB — negligible.
- Typical phone JPEG ≈ 3.5 MB → **~28 MB/flashing** → **~2.8 GB per 100**
- **Safe planning budget: ~40 MB/flashing → ~4 GB per 100**
- Worst case (all photos at the 12 MB cap): 96 MB/flashing → ~9.6 GB per 100
- 2 TB ≈ **~50,000 flashings** (~5+ years). Formula: `flashings × 8 × avg photo MB`.
- Optional future win: resize on upload (cap long edge ~2000px) → 5–10× smaller.

## 🔴 The data-loss incident (institutional memory — never repeat)
`DB_PATH`/`UPLOAD_DIR` in Railway were **relative** (`./data/...`), so SQLite + photos
were written into the app's code dir (`/app/data`), which Railway **wipes on every
deploy**. The volume at `/data` was mounted but never used. A deploy wiped everything;
no backups existed. **Data was unrecoverable.**

**Fixed (commit `94296ce`):** `src/lib/config.js` forces storage onto the volume
(prefers `RAILWAY_VOLUME_MOUNT_PATH`, else `/data` in prod) and **ignores** a relative
`DB_PATH`/`UPLOAD_DIR`. `src/server.js` **refuses to start** in production if storage
is ephemeral. Boot log must read: `Storage: db=/data/app.db · uploads=/data/uploads · PERSISTENT VOLUME ✓`.
Railway vars are now correctly absolute.

## 📧 Deploy-crash emails — CONFIRMED root cause & fix (2026-07-10)
Flynn's "deployment crashed / site is down" emails on every work session were NOT
billing and NOT a steady-state crash. **Root cause (found in the superseded deploy's
logs: `npm error signal SIGTERM`):** the container started via `npm start`, so **npm
was PID 1**. Railway's SIGTERM hit npm, which exits with an error **without cleanly
forwarding the signal to Node** — the graceful handler never ran, so Railway logged
the old container as **CRASHED** → alert email.

**Fix (commit `aa5adf0`):**
1. `railway.json` `startCommand` → `node --env-file-if-exists=.env src/server.js`
   (Node is PID 1 and receives SIGTERM directly).
2. Hardened handler in `server.js` (commit `4238698` + `aa5adf0`): `server.close()`,
   `closeIdleConnections()` immediately, `closeAllConnections()` after 300ms,
   `wal_checkpoint(TRUNCATE)` + `db.close()`, `exit(0)`, 2.5s hard-exit cap.
   Plus an `unhandledRejection` logger so best-effort Drive/cloud rejections can
   never take the site down mid-install.

**PROVEN in production** (controlled `railway redeploy`): the outgoing node-direct
container logged `Received SIGTERM → Clean shutdown complete` and its deployment
status was **REMOVED (clean), not CRASHED**. Confirmed again on the next real deploy.

⚠️ **Inherent, not a bug:** volume-backed services can't run two containers at once,
so **every deploy has a ~30–60s unavailability gap** (true on any plan, Pro included).
The fix removes the *crash email*, not the brief gap. Batch changes; avoid deploying
while installers are on a roof.

## 🚂 Railway access & operations
CLI installed + logged in as `flynn.anderson3695@gmail.com`; project
**gracious-curiosity**, service **LUXWELD**, env `production`, linked in the repo dir.
Plan: **Pro** (paid 2026-07-10 — the free-credit shutdown cliff is gone).

- ⚠️ **Use PowerShell, not Git Bash, for `railway variable set` with path-like values**
  — MSYS rewrites leading-slash args (`/data/app.db` → `C:/Program Files/Git/data/app.db`).
- `railway variable set K=V --skip-deploys` stages vars for the next deploy (batching).
  `railway variable delete` has **no** `--skip-deploys`.
- Billing/plan changes **cannot** be done via CLI (dashboard only).
- Useful: `railway logs [DEPLOYMENT_ID] --lines N`, `railway deployment list`,
  `railway status --json`, `railway usage`, `railway redeploy -y`.
- Deployment *list* status (REMOVED/SUCCESS) differs from *instance* status
  (RUNNING/CRASHED). During a handoff the old instance may briefly show CRASHED.

## Environment variables (Railway) — current, verified
`NODE_ENV=production` · `BASE_URL=https://warranty.luxweld.com.au` (⚠️ was wrongly the
`.up.railway.app` domain — QR links + OAuth callbacks derive from it!) ·
`SESSION_SECRET` · `COOKIE_SECRET` (legacy) · `DB_PATH=/data/app.db` ·
`UPLOAD_DIR=/data/uploads` · `DATABASE_URL=/data/app.db` (redundant; was a website URL —
harmless now, could be deleted) · `ADMIN_EMAIL=jono@luxweld.com.au` · `ADMIN_PASSWORD` ·
`RESET_ADMIN_PASSWORD=0` · `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` ·
`LUXWELD_APP_URL`. Railway injects `RAILWAY_VOLUME_MOUNT_PATH=/data` + `PORT`.
Optional/unset: `ADMIN_EMAILS`, `PRODUCTION_EMAILS`, `GOOGLE_CALLBACK_URL`,
`DRIVE_CALLBACK_URL` (both derive from `BASE_URL`), `DRIVE_FOLDER_NAME`, `APPLE_*`,
`R2_*`/`S3_*`, `CLOUD_PREFIX`, `SEED_PRODUCTION_PASSWORD`.

## 🔒 Access control (verified 2026-07-10)
Every archive/backup route is `requireRole('admin')`: `/admin/archive`,
`/admin/drive/*`, `/admin/archive.zip`, `/admin/archive-site.zip`,
`/admin/products/:serial/bundle.zip`, **and `/uploads/:serial/:file`** (the photo files
themselves). Non-admin logged-in users get **403**; logged-out get redirected to login.
The "Archive" nav link only renders for `role === 'admin'`. Jono is the only admin.
The Drive folder link is private to the connected Google account (Google-enforced).

## 🎨 Branding
Source logo: `public/brand/luxweld-logo-full.png` (960×304, gold hex mark + extended
wordmark, gold→white gradient). `public/brand/mark.png` is the cropped mark used for
favicon + PWA/apple-touch icons (regenerated by `scripts/build-jono-guide-pdf.py`'s
sibling logic / a PowerShell crop — see commit `80acd52`). Every "LUXWELD" wordmark
uses the **Michroma** webfont with a gold→white gradient (`.brand-word`), with a
print-safe solid fallback on the QR label sheet.

## Dev workflow
- Run/test: `npm install`, `npm start` (localhost:3000), **`npm run smoke` (47/47 — must pass)**.
- Local dev admin: `admin@luxweld.example` (dev DB in `./data/`). Dev also seeds mike/sara.
- Preview: `.claude/launch.json` configs + Claude preview tools (browser can be flaky —
  prefer `curl` against `localhost:3000` for verification).
- Deploy: commit → `git push origin main` → Railway auto-builds & deploys (~1–2 min).
- Verify live: `curl https://warranty.luxweld.com.au/health` → `{"status":"ok"}`.
- Free port 3000 (Windows): `Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.

## 🧰 Tooling gotchas (cost real time — read these)
- **Git Bash mangles `/paths`** passed to native exes (see Railway section) → use PowerShell.
- **Backslash escapes get eaten**: writing JS regex like `\s` or a char class via the
  Write tool *or* a bash heredoc can decode one escape level, silently producing raw
  control bytes (this corrupted `clean()` in `drive.js` and stripped hyphens from
  serials). Prefer escape-free constructions (`String.fromCharCode(92)`, charCode
  comparisons) and verify: `grep -cP '[\x00-\x08\x0b\x0c\x0e-\x1f]' <file>` → must be 0.
- **Windows can't deliver SIGTERM** to a child for testing; test handlers with an
  in-process `process.emit('SIGTERM')`.
- Relative `import`s in scratchpad scripts resolve against the script's dir — use
  `pathToFileURL(resolve(...))`.

## Recent commits (newest first)
`2fd5bbc` View-backups-in-Drive link · `39d7a33` handoff (crash root cause) ·
`aa5adf0` **node-direct startCommand (real crash fix)** · `6c6c66d` plain-text Jono
instructions · `a4cc3c6` Jono PDF + generator · `cde85ef` Google Cloud guide ·
`35702e7` Jono checklist · `4238698` graceful shutdown · `80acd52` rebrand ·
`0989663` **Drive searchable mirror** · `8af5eed` physical backup panel ·
`a5974a5` **admin password recovery** · `94296ce` storage fix (volume).

## 🚧 OPEN ITEMS (do these next)
1. **▶ NEXT UP: Mobile app (Android + Apple).** A Capacitor scaffold exists in
   `mobile/` (appId `com.luxweld.warranty`) — a thin shell that loads `LUXWELD_APP_URL`.
   **Tracked:** `mobile/README.md`, `mobile/capacitor.config.json`,
   `mobile/www/index.html`, `mobile/www/app-config.js` (set via `npm run set-app-url`).
   **Gitignored/generated:** `mobile/android/`, `mobile/ios/`, `mobile/package.json`,
   `mobile/node_modules/`. The install form already tracks `source` =
   web/pwa/android/ios, so app installs are measurable on day one.
   Still needed: `npm i` in `mobile/` + `npx cap add android|ios`, app icons/splash
   from `public/brand/mark.png`, signing (Android keystore; Apple dev account +
   certs/provisioning), store listings, and privacy-policy URLs. Note the site is
   already an installable **PWA** — worth confirming with Flynn whether native store
   apps are truly needed, or whether the PWA + "Get the app" CTA suffices.
2. **⏳ Physical backup (Monday).** On the always-on factory PC with the 2TB SSD:
   install Google Drive for desktop → sign in as the LUXWELD Google account →
   **Mirror files** → point at the 2TB → disable sleep → verify the
   "LUXWELD Warranty Archive" folder populates. Steps in `BACKUP-AND-RECOVERY.md`.
3. **Prove the whole chain end-to-end.** The live DB is empty. The **first real
   flashing registration** doubles as the test: register one with photos → its folder
   should appear in Drive within seconds → (after item 2) on the 2TB.
4. **Nice-to-haves:** delete the redundant `DATABASE_URL` Railway var; replace
   express-session MemoryStore before scaling >1 replica; Apple sign-in unconfigured
   (button hidden — fine); consider on-upload image resizing if volume grows;
   consider making the GitHub repo private.

## Golden rules
- Never let production storage be relative/ephemeral (guard is in place).
- Every change: `npm run smoke` must pass (47/47), then push (Railway auto-deploys).
- **Never commit secrets** — the repo is public.
- Back up BEFORE trusting: don't tell the user data is safe until it's verified landing
  somewhere off-Railway, with a visible success signal.
- Batch deploys; each one briefly drops the site (~30–60s). Don't deploy while
  installers are mid-registration.
