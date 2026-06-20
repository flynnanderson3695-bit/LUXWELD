import express from 'express';
import cookieParser from 'cookie-parser';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { db } from './db.js'; // initialise schema on boot
import { currentUser, roleLanding } from './lib/auth.js';
import { SESSION_SECRET, IS_PROD, PORT } from './lib/config.js';
import { statusBadgeClass } from './lib/warranty.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import productionRoutes from './routes/production.js';
import adminRoutes from './routes/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Behind a reverse proxy / load balancer in production so secure cookies and
// req.protocol (used for QR BASE_URL fallback) work over HTTPS.
if (IS_PROD) app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', resolve(__dirname, '../views'));

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(resolve(__dirname, '../public')));

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

app.listen(PORT, () => {
  console.log(`LUXWELD Warranty running at http://localhost:${PORT}`);
});
