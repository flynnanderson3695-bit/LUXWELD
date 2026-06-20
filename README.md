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
| `ADMIN_PASSWORD` | password for the seeded `admin` user (first boot only) |

## Seeded logins

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` (or `ADMIN_PASSWORD`) | Admin — full access |
| `mike` | `mike123` | Production |
| `sara` | `sara123` | Production |

**Change these in production** (Admin → Users → Reset). Installers need **no login**.
Add/disable/reset staff under **Admin → Users**.

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

## Deployment checklist (website first)

Launch the website before touching the apps. In order:

1. **Deploy the Node app online** — Node 18+ host (Render, Railway, Fly.io, VPS)
   with a **persistent disk** for the database and uploads. `npm install && npm start`.
2. **Set `BASE_URL`** to your real HTTPS domain (e.g. `https://warranty.luxweld.com.au`)
   so QR codes encode a public URL, not localhost.
3. **Set `SESSION_SECRET`** to a long random string (and `NODE_ENV=production`,
   which enables HTTPS-only cookies + `trust proxy`).
4. **Set database & upload persistence** — `DB_PATH=/data/app.db`,
   `UPLOAD_DIR=/data/uploads` on the persistent disk. The DB auto-migrates on boot.
5. **Test `/health`** → should return `{"status":"ok"}`.
6. **Generate QR** labels in the admin dashboard.
7. **Scan the QR from a phone** → it opens the live `/p/:serial` page.
8. **Complete the installer form in the phone browser** (no app/login needed),
   including the 4 camera photos.
9. **Then build the Android/iOS wrappers** (see below) pointing at the same domain.

Put HTTPS in front (platform TLS or nginx/Caddy). Back up the persistent disk.

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
