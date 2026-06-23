# LUXWELD — Warranty & Insurance Registration

Premium warranty/insurance registration for LUXWELD skylight flashing. Each
flashing gets a unique QR code (applied after powder coating). Production staff
register the product and take 4 insurance photos; installers scan on site and
register the installation with 4 more photos. Admins manage everything from a
black-and-gold dashboard.

## Stack

- **Node + Express** (single process, no build step)
- **SQLite** via Node's built-in `node:sqlite` (zero native deps; file `data/app.db`)
- **EJS + Tailwind** (Play CDN) — premium black/gold, mobile-first, no build step
- **multer** photo uploads · **qrcode** QR images · **csv-stringify** export
- **scrypt** (node:crypto) password hashing — per-user staff accounts

## Run

```bash
npm install
# optional: cp .env.example .env  and edit (auto-loaded by the scripts)
npm start            # http://localhost:3000
# or: npm run dev    (auto-restart on file changes)
# or: npm run smoke  (self-contained test suite — throwaway DB)
```

The database **migrates automatically on boot** (versioned via `PRAGMA
user_version`). Existing records are preserved.

## One shared cloud system

The website **is** the backend — one Express app, one database, one upload
store. The website, the installed PWA, and the Android/iOS wrappers all talk to
the **same hosted URL**, so they see identical records and photos. There is no
separate offline data store. QR codes always open a normal HTTPS web page
(`/p/:serial`), so installers can complete everything from a phone browser with
**no app, no account, no login**.

## Environment variables

| Var | Purpose |
|---|---|
| `NODE_ENV` | `production` enables HTTPS-only cookies + `trust proxy` |
| `PORT` | listen port (default 3000) |
| `BASE_URL` | public HTTPS origin baked into QR links + app target (not localhost) |
| `SESSION_SECRET` | cookie signing secret (long random in prod; `COOKIE_SECRET` still accepted) |
| `DB_PATH` / `DATABASE_URL` | SQLite file path (point at a persistent volume) |
| `UPLOAD_DIR` / `UPLOAD_ROOT` | photo storage dir (persistent volume) |
| `ADMIN_EMAIL` | email of the seeded admin recovery account (first boot only) |
| `ADMIN_PASSWORD` | password for the seeded admin (**required in production** — no default) |
| `ADMIN_EMAILS` / `PRODUCTION_EMAILS` | comma-separated allowlists auto-assigned on first OAuth sign-in |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (button hidden if unset) |
| `GOOGLE_CALLBACK_URL` | optional; defaults to `BASE_URL/auth/google/callback` |
| `APPLE_CLIENT_ID` / `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY` | Apple OAuth (button hidden if unset) |
| `APPLE_CALLBACK_URL` | optional; defaults to `BASE_URL/auth/apple/callback` |

## Sign-in & roles

Sign-in is via **Google** (and **Apple** if configured), with a **secure
email/password fallback** for admin recovery and admin-created accounts. There
are **no shared demo passwords in production** — `ADMIN_PASSWORD` is required at
first boot and seeds a single admin account.

**Roles (controlled in the DB, never by the OAuth provider):**

| Role | Access |
|---|---|
| `admin` | Everything: dashboard, generate QR, users/roles, all records & photos |
| `production` | Production screens only (register QR + 4 production photos) |
| `installer` | Public QR pages; signed-in installers get saved-profile autofill |
| `pending` | No access yet — waiting for an admin to assign a role |

New Google/Apple sign-ins arrive as **installer** unless their email is in
`ADMIN_EMAILS` / `PRODUCTION_EMAILS`. Admins assign/override roles under
**Admin → Users**. Installers never need to sign in to register a warranty.

**Dev only** (when `NODE_ENV` ≠ production): seeds `admin@luxweld.local`/`admin123`
plus production users `mike`/`mike123`, `sara`/`sara123` for local testing.

## Google OAuth setup

1. [Google Cloud Console](https://console.cloud.google.com) → create/select a project.
2. **APIs & Services → OAuth consent screen** → External → add app name, support
   email, and your domain; add yourself as a test user (or publish).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web**.
4. **Authorised redirect URI:** `https://warranty.luxweld.com.au/auth/google/callback`
   (and `http://localhost:3000/auth/google/callback` for local dev).
5. Copy the Client ID + Secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
   The button appears automatically once both are set.

## Apple OAuth setup (optional)

Requires an **Apple Developer account** ($99/yr). If you don't have one yet, leave
the `APPLE_*` vars blank — the Apple button stays hidden and nothing breaks.

1. [developer.apple.com](https://developer.apple.com) → Certificates, IDs & Profiles.
2. Create an **App ID**, then a **Services ID** (this is `APPLE_CLIENT_ID`) and
   enable "Sign in with Apple"; set the return URL to
   `https://warranty.luxweld.com.au/auth/apple/callback`.
3. Create a **Sign in with Apple key** → download the `.p8` → that's
   `APPLE_PRIVATE_KEY` (paste contents with `\n` for newlines); note the `APPLE_KEY_ID`.
4. Your `APPLE_TEAM_ID` is in the top-right of the developer portal.
5. Set all four `APPLE_*` vars; the button appears automatically.

## Branding / logo

Drop your logo file at **`public/luxweld-velux-trusted.svg`** and it appears in
the header and on the login screen automatically. Until then a styled "LUXWELD"
wordmark is shown. Palette: black/charcoal surfaces with warm gold accents.

## Real-world workflow

1. Flashing manufactured → powder coated → returned to factory.
2. Fabrication team applies the QR label (generated under **Admin → Generate QR**).
3. Production user signs in, scans/opens the QR, picks a **product tag**
   (Tile / Corrugated / M25 / M40 / Custom), adds notes, and takes **4 insurance
   photos** (front/back/left/right). Production date = today, auto-filled; the
   logged-in user is recorded automatically. Status → **Ready for Installation**.
4. Flashing shipped. Installer scans the QR on site (no login), enters their
   details + site details (installation date defaults to today, editable), and
   takes **4 installed photos**. Status → **Installed**, warranty activated.
5. Warranty record appears in the admin dashboard.

## Warranty logic

- Starts from the **production date**; length configurable (default **10 years**),
  set at QR generation and editable by admin.
- End date auto-calculated. Live status: **Awaiting Production → Ready for
  Installation → Active / Expired**, plus **Incomplete** and **Cancelled**.

## Roles & routes

| Path | Who | Purpose |
|---|---|---|
| `GET /p/:serial` | public | Smart landing (branches on status) |
| `GET /install/:serial` | public | Alias → `/p/:serial` |
| `GET/POST /p/:serial/install` | public | Installation + 4 photos (+ remember-me, source) |
| `GET /app` | public | Optional companion-app landing |
| `GET /health` | public | Health check (JSON, verifies DB) |
| `GET /production`, `POST /production/find` | production | Home: scan/enter serial + pending list |
| `GET/POST /p/:serial/production` | production | Production registration + 4 photos |
| `GET /admin` | admin | Dashboard (search `?q=`, filter `?filter=`) |
| `GET/POST /admin/generate` | admin | Bulk-create + QR labels |
| `GET /admin/qr-sheet?serials=` | admin | Printable LUXWELD QR labels |
| `GET /admin/products/:serial` | admin | Full record + both photo sets |
| `POST …/edit`, `…/cancel`, `…/reset-installation` | admin | Correct / cancel / reset |
| `GET /admin/export.csv` | admin | CSV export |
| `GET/POST /admin/users` (+ `/:id/password`, `/:id/toggle`) | admin | Manage staff users |
| `GET /uploads/:serial/:file` | admin | Photos (auth-gated, not public) |

## Photo storage

Stored on local disk under `data/uploads/<serial>/` (`prod-*` for production,
`inst-*` for installation), served only through the admin-gated `/uploads`
route — **not publicly listable**. Validation: images only, max 12 MB each,
all 4 angles required. (For production, move to S3/Blob with signed URLs.)

## Database

`users`, `product`, `production_registration` (tag, custom_description,
production_date, production_user), `installation_registration`, `photo`
(`kind` = PRODUCTION | INSTALLATION), `warranty`. See `src/db.js`.

## Testing the full flow

1. `npm start`, open http://localhost:3000.
2. Sign in as `admin` → **Generate QR** → **Open printable QR labels** (each
   label shows LUXWELD, the QR, the serial, and "Scan to register installation").
3. Sign in as `mike` (production) → scan/enter a serial → pick a tag → take 4
   photos → submit (date + your name auto-filled).
4. Open the product's `/p/:serial` (no login) → register installation with 4
   photos.
5. Back in admin → open the record: tag, production user, production date, both
   photo sets, installer/site details, warranty start/end. Export CSV.

### Phone QR testing

Set `BASE_URL` to your machine's LAN IP (e.g. `http://192.168.1.50:3000`) in
`.env` so QR codes encode a phone-reachable URL (phone + PC on same Wi-Fi). Or
use `ngrok http 3000` and set `BASE_URL` to the tunnel URL. The photo inputs use
`capture="environment"` to open the rear camera directly.

## Saved installer details

- **Website:** an optional "Remember my details on this device" checkbox stores
  only name/company/phone/email in `localStorage` and autofills next time. Site
  address and photos are never saved locally. Privacy wording is shown inline.
- **App:** the wrapper persists the same profile more reliably and autofills it;
  the installer still reviews before submitting.
- Submissions are tagged with a **source** (`web` / `pwa` / `android` / `ios`),
  shown on the admin record and in the CSV.

## PWA — install to home screen

The site ships a `manifest.webmanifest`, icons, apple-touch-icon, mobile meta
tags, and a **conservative** service worker that caches *only* static branding
assets (icons/manifest) — it never caches HTML, login, forms, QR pages, photos,
or warranty data, so it can't break submissions or leak private data.

- **Android (Chrome):** ⋮ → *Install app* / *Add to Home screen*.
- **iPhone (Safari):** Share → *Add to Home Screen*.

Requires HTTPS (or localhost) to install.

## Deployment checklist (website first) — Railway + Crazy Domains

Launch the website before touching the apps. In order:

1. **Push to GitHub**, then on [Railway](https://railway.app): **New Project →
   Deploy from GitHub repo**. Railway uses `railway.json` (Nixpacks, `npm start`,
   healthcheck `/health`) and `.nvmrc` (Node 24).
2. **Add a persistent volume** — Service → Settings → **Volumes → mount at `/data`**.
   This holds the SQLite DB + photos across deploys.
3. **Set environment variables** (Service → Variables):
   - `NODE_ENV=production`
   - `BASE_URL=https://warranty.luxweld.com.au` (use the Railway temp domain first)
   - `SESSION_SECRET=<long random>` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `DB_PATH=/data/app.db`, `UPLOAD_DIR=/data/uploads`
   - `ADMIN_EMAIL=...`, `ADMIN_PASSWORD=<strong>` (required — seeds the admin once)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (when ready)
   - `ADMIN_EMAILS`, `PRODUCTION_EMAILS` (optional allowlists)
   - Apple vars only if you have them; `LUXWELD_APP_URL` for the wrapper later.
   Don't set `PORT` — Railway injects it.
4. **Generate a temporary domain** — Service → Settings → Networking → Generate
   Domain. Set `BASE_URL` to it for now and confirm `/health` + login work.
5. **Add the custom domain in Railway** — Settings → Networking → **Custom Domain**
   → `warranty.luxweld.com.au`. Railway shows a **CNAME target** (e.g.
   `xxxx.up.railway.app`).
6. **Add the CNAME in Crazy Domains** — log in → **My Domains → luxweld.com.au →
   DNS / Manage DNS** → **Add record**: Type `CNAME`, Host/Name `warranty`,
   Value/Points to the Railway target, TTL default. Save. (Do **not** use an A
   record; Railway wants CNAME.) Wait for Railway to show the domain **Active**
   (TLS auto-issues; can take minutes to an hour).
7. **Update `BASE_URL`** to `https://warranty.luxweld.com.au` and redeploy.
8. **Update OAuth redirect URIs** to the final domain (Google/Apple consoles).
9. **Test `/health`** → `{"status":"ok"}`; sign in as admin; assign roles.
10. **Only now generate real QR labels** (so they bake in the final domain), scan
    from a phone, and complete an installer registration in the phone browser.
11. **Then** build the Android/iOS wrappers pointing at the same domain.

Back up the `/data` volume regularly.

### Phone QR testing (local, before you have a domain)

**localhost won't work from a phone.** Set `BASE_URL` to your machine's LAN IP
(e.g. `http://192.168.1.50:3000`, phone + PC on same Wi-Fi) or an HTTPS tunnel
(`ngrok http 3000` / `cloudflared`), and generate QR codes with that same
`BASE_URL`. Photo inputs use `capture="environment"` for the rear camera.

## Mobile apps (Capacitor wrappers)

Thin wrappers that load the deployed HTTPS site — same UI, same records, no
separate data store. App name **LUXWELD Warranty**, IDs **com.luxweld.warranty**.

**Set the target URL before building** (this is the one value you must set):

```bash
LUXWELD_APP_URL=https://warranty.luxweld.com.au npm run set-app-url
# or edit mobile/www/app-config.js directly
```

The shell (`mobile/www/index.html`) loads that URL; if it's unset/unreachable it
shows a **setup screen with a Retry button** (it never hangs). Full build steps —
including Android internal-test and iOS TestFlight — are in **`mobile/README.md`**.

### Do not submit to the stores until the live website works

Complete the deployment checklist above (through "installer form in phone
browser") first. Then for submission you'll also need: app icons/splash + store
listings/screenshots; Android signing keystore + `CAMERA` permission + Play
Console + privacy policy URL; iOS Apple Developer account + `NSCameraUsageDescription`
+ provisioning + App Privacy details. The website does **not** depend on store
approval.

## Next steps

- Move uploads to S3/Blob with signed URLs for horizontal scaling.
- Switch SQLite → Postgres for concurrent multi-user write load.
