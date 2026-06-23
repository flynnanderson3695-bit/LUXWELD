import { Router } from 'express';
import passport, { googleEnabled, appleEnabled } from '../lib/passport.js';
import {
  authenticate, upsertOAuthUser, roleLanding, roleCanAccess, sessionCookieOptions,
  currentUser, requireRole,
} from '../lib/auth.js';
import { db } from '../db.js';

const router = Router();

// Only same-site, absolute-path redirects (blocks open-redirect via `next`,
// e.g. "https://evil.com" or protocol-relative "//evil.com").
function isSafeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)/.test(next);
}

function signIn(res, user, next) {
  res.cookie('uid', String(user.id), sessionCookieOptions());
  const dest =
    isSafeNext(next) && roleCanAccess(user.role, next) ? next : roleLanding(user.role);
  res.redirect(dest);
}

const loginErrors = {
  invalid: 'Incorrect email or password.',
  oauth: 'Sign-in was cancelled or failed. Please try again.',
  'google-off': 'Google sign-in is not configured yet.',
};

// ---- Login page ----
router.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  res.render('login', {
    next: req.query.next || '',
    email: '',
    error: loginErrors[req.query.error] || null,
  });
});

// ---- Local email/password (admin recovery + admin-created accounts) ----
router.post('/login', (req, res) => {
  const user = authenticate(req.body.email, req.body.password);
  if (!user) {
    return res.status(401).render('login', {
      next: req.body.next || '',
      email: req.body.email || '',
      error: loginErrors.invalid,
    });
  }
  signIn(res, user, req.body.next);
});

// ---- Google ----
router.get('/auth/google', (req, res, next) => {
  if (!googleEnabled) return res.redirect('/login?error=google-off');
  req.session.oauthNext = req.query.next || '';
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get(
  '/auth/google/callback',
  (req, res, next) => {
    if (!googleEnabled) return res.redirect('/login?error=google-off');
    passport.authenticate('google', { session: false, failureRedirect: '/login?error=oauth' })(req, res, next);
  },
  (req, res) => {
    const user = upsertOAuthUser(req.user);
    signIn(res, user, req.session?.oauthNext || '');
  }
);

// ---- Apple (only mounted when configured; button hidden otherwise) ----
if (appleEnabled) {
  router.get('/auth/apple', (req, res, next) => {
    req.session.oauthNext = req.query.next || '';
    passport.authenticate('apple')(req, res, next);
  });
  router.post(
    '/auth/apple/callback',
    passport.authenticate('apple', { session: false, failureRedirect: '/login?error=oauth' }),
    (req, res) => {
      const user = upsertOAuthUser(req.user);
      signIn(res, user, req.session?.oauthNext || '');
    }
  );
}

// ---- Pending-approval landing ----
router.get('/pending', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.redirect('/login');
  if (user.role !== 'pending') return res.redirect(roleLanding(user.role));
  res.render('pending', { user });
});

// ---- Signed-in installer profile (saved details for repeat installers) ----
router.get('/account', requireRole('installer'), (req, res) => {
  res.render('account', { user: currentUser(req), saved: req.query.saved || null });
});

router.post('/account', requireRole('installer'), (req, res) => {
  const u = currentUser(req);
  const b = req.body || {};
  db.prepare('UPDATE users SET name = ?, phone = ?, company = ? WHERE id = ?').run(
    (b.name || u.name || '').trim() || u.name,
    (b.phone || '').trim() || null,
    (b.company || '').trim() || null,
    u.id
  );
  res.redirect('/account?saved=1');
});

router.post('/logout', (req, res) => {
  res.clearCookie('uid');
  if (req.session) return req.session.destroy(() => res.redirect('/login'));
  res.redirect('/login');
});

export default router;
