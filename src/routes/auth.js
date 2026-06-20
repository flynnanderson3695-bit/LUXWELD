import { Router } from 'express';
import { authenticate, roleLanding, roleCanAccess, sessionCookieOptions } from '../lib/auth.js';

const router = Router();

router.get('/login', (req, res) => {
  res.render('login', {
    next: req.query.next || '',
    username: '',
    error: null,
  });
});

router.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const next = req.body.next || '';

  const user = authenticate(username, password);
  if (!user) {
    return res.status(401).render('login', {
      next,
      username,
      error: 'Incorrect username or password.',
    });
  }

  res.cookie('uid', String(user.id), sessionCookieOptions());

  const dest = next && roleCanAccess(user.role, next) ? next : roleLanding(user.role);
  res.redirect(dest);
});

router.post('/logout', (req, res) => {
  res.clearCookie('uid');
  res.redirect('/login');
});

export default router;
