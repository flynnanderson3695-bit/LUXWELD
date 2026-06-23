---
name: run-luxweld-warranty
description: Build, launch, drive, screenshot and smoke-test the LUXWELD Warranty web app (Node + Express + EJS + built-in node:sqlite). Use when asked to run, start, serve, build, test, smoke-test, or take a screenshot of the LUXWELD warranty/insurance registration site, the admin dashboard, the installer QR page, or the production registration flow.
---

# Run: LUXWELD Warranty

Server-rendered web app: **Express + EJS + Tailwind (CDN) + Node's built-in
`node:sqlite`**. No build step, no native modules. QR codes open `/p/:serial`;
production staff and admins log in, installers register with no login.

**How it's driven (two harnesses, both verified):**
- **Logic / end-to-end:** `npm run smoke` → `scripts/smoke.mjs`. It boots the
  real server on a throwaway DB and drives the whole app over HTTP (login, QR
  generation, production registration with 4 photos, installer registration with
  4 photos, CSV, `/health`, PWA assets). **This is the primary agent path.**
- **Visual / screenshots:** the Claude Preview MCP + `.claude/launch.json`
  (config name `luxweld`) — start the app, then `preview_fill` / `preview_click`
  / `preview_screenshot`.

All paths below are relative to the unit root (this repo root).

## Prerequisites

- **Node 24.x** (pinned in `package.json` engines + `.nvmrc`). `node:sqlite`
  requires Node ≥ 22.5 and runs **unflagged** on 24 — older majors will fail to
  import it. No `apt-get`, no xvfb, no Chromium install needed (it's a
  server-rendered site; screenshots go through the Preview MCP).

```bash
node -v          # v24.x
```

## Build / setup

```bash
npm install      # ~120 packages, 0 native builds, 0 vulnerabilities
```

## Run — agent path (primary): drive the app over HTTP

```bash
npm run smoke
```

Spawns the server on a temp DB + upload dir, runs 35 assertions, tears down, and
exits non-zero on any failure. Last lines look like:

```
  PASS  install form has hidden source field

35 passed, 0 failed
```

Use this after any change — it exercises every route and the photo-upload paths.

## Run — agent path (visual): screenshot real pages

Free the port, then launch via the Preview MCP using the committed
`.claude/launch.json` config named `luxweld` (runs `npm start` on port 3000):

```bash
# Windows: free port 3000 first (pkill -f does NOT match node on Windows)
powershell -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
```

Then with the Preview MCP tools:

1. `preview_start` name `luxweld` → returns a `serverId` (serves on `:3000`).
2. `preview_screenshot` → the login page (premium black/gold).
3. Log in as admin and screenshot the dashboard:
   - `preview_fill` `input[name="username"]` = `admin`
   - `preview_fill` `input[name="password"]` = `admin123`
   - `preview_click` `button[type="submit"]`
   - `preview_screenshot` → "Warranty records" dashboard.
4. Installer (no-login) page — navigate to any `Ready for Installation` serial:
   - `preview_eval` `window.location.href = '/p/<SERIAL>/install'`
   - `preview_screenshot` → installer form (4 photo inputs, remember-me, app CTA).

Screenshots render inline in this environment (the Preview MCP is the browser
harness here; it does not write a file to disk).

## Run — human path

```bash
npm start                       # http://localhost:3000  (Ctrl-C to stop)
```

Open the URL, sign in. **Seeded logins (dev):** `admin`/`admin123` (admin),
`mike`/`mike123`, `sara`/`sara123` (production). Installers don't log in.

## Direct checks (curl)

```bash
curl -s http://localhost:3000/health        # {"status":"ok","time":...}
```

## Test

`npm run smoke` **is** the test suite (there is no separate `npm test`). It is
self-contained and safe to run repeatedly.

## Gotchas (battle scars from this container)

- **One writer at a time.** The DB is a single SQLite file (`data/app.db`, WAL
  mode). A server left running from a previous step holds port 3000 **and** the
  DB. Always free port 3000 (PowerShell one-liner above) before `preview_start`
  / `npm start`, or you get `EADDRINUSE`. `npm run smoke` is immune — it uses its
  own temp DB on port 3199.
- **Windows process killing:** `pkill -f "node src/server.js"` does **not** work
  here; use the `Get-NetTCPConnection … Stop-Process` PowerShell line.
- **Photos are admin-gated, by design.** `GET /uploads/:serial/:file` returns
  `302 → /login` without an admin cookie — not a bug; that's the access control.
- **4 photos are mandatory** for both production and installer registration.
  `scripts/smoke.mjs` fabricates 1×1 PNGs via `FormData` + `Blob` to satisfy this
  — copy that pattern if you script uploads.
- **Secure cookies in production mode** (`NODE_ENV=production`) won't round-trip
  over plain `http://localhost` with curl (the cookie is `Secure`). For local
  driving stay in dev mode (the default); use prod mode only behind HTTPS.
- **`npm start` loads `.env` only if present** (`--env-file-if-exists`). With no
  `.env` it uses dev defaults — that's why the seeded logins above just work.
- **`node:sqlite`, not better-sqlite3.** An earlier attempt at better-sqlite3
  failed with a `node-gyp` build error (no MSVC build tools); the app
  deliberately uses the built-in `node:sqlite` so there is **no** native compile.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE: :::3000` | A server is already running — free port 3000 (PowerShell line above). |
| smoke: `harness error: server did not start in time` | Port 3199 busy or a syntax error in `src/` — run `node src/server.js` once to see the stack. |
| `/uploads/...` returns 302 in a browser | Expected without an admin session; log in as admin first. |
| `Cannot find module 'node:sqlite'` / import error | Node is older than 22.5 — use Node 24 (`.nvmrc`). |
