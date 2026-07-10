import express from 'express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { db } from './db.js'; // initialise schema on boot
import { currentUser, roleLanding } from './lib/auth.js';
import { SESSION_SECRET, IS_PROD, PORT, DB_PATH, UPLOAD_ROOT, STORAGE_PERSISTENT } from './lib/config.js';
import passport, { googleEnabled, appleEnabled } from './lib/passport.js';
import { statusBadgeClass } from './lib/warranty.js';
import { buildArchiveSite } from './lib/archive-site.js';
import { backupToDrive, driveStatus } from './lib/drive.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import productionRoutes from './routes/production.js';
import adminRoutes from './routes/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ---- Storage safety banner + guard (prevents silent data loss) ----
console.log(
  `Storage: db=${DB_PATH} · uploads=${UPLOAD_ROOT} · ` +
  (STORAGE_PERSISTENT ? 'PERSISTENT VOLUME ✓' : 'EPHEMERAL DISK ⚠️')
);
if (IS_PROD && !STORAGE_PERSISTENT) {
  console.error(
    '\n!!! REFUSING TO START — production storage is on a TEMPORARY disk.\n' +
    '!!! Data would be lost on the next deploy. Attach a persistent volume\n' +
    '!!! (Railway sets RAILWAY_VOLUME_MOUNT_PATH) or set DB_PATH + UPLOAD_DIR\n' +
    '!!! to an ABSOLUTE path on a persistent disk, then redeploy.\n'
  );
  process.exit(1);
}

// Behind a reverse proxy / load balancer in production so secure cookies and
// req.protocol (used for QR BASE_URL fallback) work over HTTPS.
if (IS_PROD) app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', resolve(__dirname, '../views'));

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(resolve(__dirname, '../public')));

// Short-lived session used ONLY for the OAuth handshake (state + `next`).
// The real app session is the signed `uid` cookie set after sign-in.
app.use(
  session({
    name: 'luxweld.oauth',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 10 * 60 * 1000 },
  })
);
app.use(passport.initialize());

// Health check for deployment platforms (no auth, verifies DB is reachable).
app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'error' });
  }
});

const LOGO_PATH = resolve(__dirname, '../public/luxweld-velux-trusted.svg');
const HAS_LOGO = existsSync(LOGO_PATH);

// Expose current user/role to all templates.
app.use((req, res, next) => {
  const user = currentUser(req);
  res.locals.user = user;
  res.locals.role = user?.role || null;
  res.locals.userName = user?.name || null;
  res.locals.path = req.path;
  res.locals.statusBadgeClass = statusBadgeClass;
  res.locals.hasLogo = HAS_LOGO;
  res.locals.googleEnabled = googleEnabled;
  res.locals.appleEnabled = appleEnabled;
  next();
});

app.get('/', (req, res) => {
  const user = currentUser(req);
  return res.redirect(user ? roleLanding(user.role) : '/login');
});

app.use(authRoutes);
app.use(publicRoutes);
app.use(productionRoutes);
app.use(adminRoutes);

// 404
app.use((req, res) => res.status(404).render('not-found', { serial: null }));

// Error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', { message: 'Something went wrong. Please try again.' });
});

// Rebuild the standalone LUXWELD archive site daily (a second, self-contained,
// browsable copy of every record + photos, kept on the persistent volume).
const DAY = 24 * 60 * 60 * 1000;
let lastArchiveBuild = 0;
function rebuildArchiveSite() {
  lastArchiveBuild = Date.now();
  try {
    const out = resolve(UPLOAD_ROOT, '..', 'archive-site');
    const r = buildArchiveSite(out);
    console.log(`Archive site rebuilt at ${out} (${r.records} records, ${r.photos} photos).`);
  } catch (e) {
    console.warn('Archive site rebuild failed:', e.message);
  }
}

// Hourly maintenance with STALENESS checks. (A plain 24h setInterval resets on
// every deploy, so if the app redeploys more often than daily the "daily"
// backup never fires. Drive staleness is tracked in the DB, so it survives
// restarts and catches up a missed backup within a minute of boot.)
async function maintenanceTick() {
  try {
    if (Date.now() - lastArchiveBuild > DAY) rebuildArchiveSite();
    const st = driveStatus();
    if (st.connected) {
      const last = Date.parse(st.lastBackup || '') || 0;
      if (Date.now() - last > DAY) {
        const r = await backupToDrive();
        console.log('Daily Drive backup:', r.ok
          ? `OK — ${r.uploaded} uploaded of ${r.checked} checked`
          : `FAILED — ${r.error}`);
      }
    }
  } catch (e) {
    console.warn('Maintenance tick failed:', e.message);
  }
}

const server = app.listen(PORT, () => {
  console.log(`LUXWELD Warranty running at http://localhost:${PORT}`);
  rebuildArchiveSite(); // local copy on boot (no upload)
  setTimeout(maintenanceTick, 60 * 1000).unref(); // catch-up pass shortly after boot
  setInterval(maintenanceTick, 60 * 60 * 1000).unref(); // then hourly
});

// ---- Graceful shutdown (stops the "deployment crashed" emails) ----
// On every redeploy Railway stops the old container with SIGTERM. With no
// handler, Node is killed mid-flight and the platform records a CRASH (→ alert
// email), even though nothing is wrong. Here we stop accepting connections,
// flush SQLite's WAL into the volume file, close cleanly, and exit(0) so the
// platform sees a normal stop. A short timer force-exits if a connection hangs.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal} — shutting down gracefully.`);
  const done = (code) => {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); db.close(); } catch {}
    console.log('Clean shutdown complete.');
    process.exit(code);
  };
  server.close(() => done(0));
  // A reverse proxy keeps connections alive; drop them so server.close() resolves
  // promptly and we exit(0) well within the platform's SIGTERM->SIGKILL window.
  try { server.closeIdleConnections(); } catch {}
  setTimeout(() => { try { server.closeAllConnections(); } catch {} }, 300).unref();
  setTimeout(() => done(0), 2500).unref(); // hard cap so a lingering socket can't wedge the deploy
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A stray rejection from a best-effort background task (Drive/cloud mirror)
// must never take the whole site down mid-install. Log, don't exit.
process.on('unhandledRejection', (reason) => {
  console.warn('Unhandled promise rejection (ignored, site stays up):', reason?.message || reason);
});
