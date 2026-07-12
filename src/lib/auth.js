// Role-based auth for LUXWELD.
// App session = signed `uid` cookie (set after local OR OAuth sign-in).
// Roles (admin > production, plus installer / pending) live in the DB and are
// never taken from the OAuth provider alone. Installers use public QR pages
// without any login; a signed-in installer just gets saved-profile autofill.
import { db } from '../db.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  SESSION_SECRET, sessionCookieOptions, ADMIN_EMAILS, PRODUCTION_EMAILS,
} from './config.js';

export { hashPassword, verifyPassword, SESSION_SECRET, sessionCookieOptions };

export const ROLES = ['genius', 'admin', 'production', 'installer', 'pending'];

// Roles with full, unrestricted access. `genius` is the owner's personal tier —
// it behaves exactly like admin everywhere access is checked, and sits above it.
// Keep in sync with: the CHECK constraint in db.js and the admin-only view gates
// (res.locals.isAdmin in server.js).
export const SUPERUSER_ROLES = ['admin', 'genius'];
export const isSuperRole = (role) => SUPERUSER_ROLES.includes(role);

// ---- Lookups ----
export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
export function getUserByEmail(email) {
  if (!email) return null;
  return db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email).trim());
}
export function getUserByUsername(username) {
  if (!username) return null;
  return db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(String(username).trim());
}
export function getUserByProvider(provider, providerId) {
  return db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId);
}

// Local email/username + password sign-in (admin recovery + admin-created users).
export function authenticate(identifier, password) {
  const id = String(identifier || '').trim();
  const user = getUserByEmail(id) || getUserByUsername(id);
  if (!user || !user.active || !user.password_hash) return null;
  return verifyPassword(password, user.password_hash) ? user : null;
}

// Role for a brand-new sign-in, from the allowlists. Unknown → installer
// (installer has no privileged access; admin can promote later).
export function resolveSeedRole(email) {
  const e = String(email || '').toLowerCase();
  if (ADMIN_EMAILS.includes(e)) return 'admin';
  if (PRODUCTION_EMAILS.includes(e)) return 'production';
  return 'installer';
}

// Find-or-create a user from an OAuth profile. Links to an existing account by
// email if one exists (so an admin pre-created by email keeps their role).
export function upsertOAuthUser({ provider, providerId, email, name }) {
  let user = getUserByProvider(provider, providerId);
  if (user) return user;

  if (email) {
    const byEmail = getUserByEmail(email);
    if (byEmail) {
      db.prepare('UPDATE users SET provider = ?, provider_id = ? WHERE id = ?')
        .run(provider, providerId, byEmail.id);
      return getUserById(byEmail.id);
    }
  }

  const role = resolveSeedRole(email);
  const info = db.prepare(
    'INSERT INTO users (name, email, role, provider, provider_id) VALUES (?,?,?,?,?)'
  ).run(name || (email ? email.split('@')[0] : 'New user'), email || null, role, provider, providerId);
  return getUserById(info.lastInsertRowid);
}

// ---- Admin user management helpers ----
export function listUsers() {
  return db.prepare(
    'SELECT id, name, username, email, role, provider, active, created_at FROM users ORDER BY role, lower(email), id'
  ).all();
}
export function createLocalUser({ name, email, password, role }) {
  const r = ROLES.includes(role) ? role : 'installer';
  const info = db.prepare(
    'INSERT INTO users (name, email, role, password_hash, provider) VALUES (?,?,?,?,?)'
  ).run(name, email || null, r, hashPassword(password), 'local');
  return info.lastInsertRowid;
}
export function setRole(id, role) {
  if (!ROLES.includes(role)) return;
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, Number(id));
}
export function setPassword(id, password) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), Number(id));
}
export function toggleActive(id) {
  db.prepare('UPDATE users SET active = 1 - active WHERE id = ?').run(Number(id));
}

// ---- Session ----
export function currentUser(req) {
  const uid = req.signedCookies?.uid;
  if (!uid) return null;
  const u = getUserById(Number(uid));
  return u && u.active ? u : null;
}
export function currentRole(req) {
  return currentUser(req)?.role || null;
}

// admin implicitly has production rights.
export function hasRole(req, role) {
  const current = currentRole(req);
  if (!current) return false;
  if (isSuperRole(current)) return true;
  return current === role;
}

export function roleLanding(role) {
  if (isSuperRole(role)) return '/admin';
  if (role === 'production') return '/production';
  if (role === 'installer') return '/account';
  return '/pending';
}

export function roleCanAccess(role, path) {
  if (!role || !path) return false;
  if (isSuperRole(role)) return true;
  if (role === 'production') return path === '/production' || path.startsWith('/p/');
  if (role === 'installer') return path === '/account' || path.startsWith('/p/');
  return false;
}

export function requireRole(role) {
  return (req, res, next) => {
    if (hasRole(req, role)) return next();
    if (currentRole(req)) return res.status(403).render('forbidden', { needed: role });
    const next_ = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${next_}`);
  };
}
