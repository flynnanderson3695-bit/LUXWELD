// Role-based auth for LUXWELD.
// Each staff member (admin or production) has their own account in the `users`
// table with a scrypt-hashed password. Installers need NO login — they reach
// the install form via the QR link.
import { db } from '../db.js';
import { hashPassword, verifyPassword } from './password.js';
import { SESSION_SECRET, sessionCookieOptions } from './config.js';

export { hashPassword, verifyPassword, SESSION_SECRET, sessionCookieOptions };

// ---- User lookup ----
export function getUserByUsername(username) {
  return db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?) AND active = 1')
    .get(String(username || '').trim());
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(id);
}

// Authenticate credentials; returns the user row or null.
export function authenticate(username, password) {
  const user = getUserByUsername(username);
  if (!user) return null;
  return verifyPassword(password, user.password_hash) ? user : null;
}

// ---- Session helpers (signed `uid` cookie) ----
export function currentUser(req) {
  const uid = req.signedCookies?.uid;
  if (!uid) return null;
  return getUserById(Number(uid)) || null;
}

export function currentRole(req) {
  return currentUser(req)?.role || null;
}

// Admin implicitly has production rights too.
export function hasRole(req, role) {
  const current = currentRole(req);
  if (!current) return false;
  if (current === 'admin') return true;
  return current === role;
}

// Where each role should land after logging in.
export function roleLanding(role) {
  return role === 'production' ? '/production' : '/admin';
}

// Can a given role reach a given path? Used to validate a post-login `next`.
export function roleCanAccess(role, path) {
  if (!role || !path) return false;
  if (role === 'admin') return true;
  if (role === 'production') {
    return path === '/production' || path.startsWith('/p/');
  }
  return false;
}

export function requireRole(role) {
  return (req, res, next) => {
    if (hasRole(req, role)) return next();
    const next_ = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${next_}`);
  };
}
