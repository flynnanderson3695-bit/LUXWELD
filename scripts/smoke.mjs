// Self-contained smoke test. Boots the server on a throwaway DB + upload dir,
// runs the checks, then tears everything down. Run with: npm run smoke
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const ROOT = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'lux-smoke-'));

const env = {
  ...process.env,
  PORT: String(PORT),
  DB_PATH: join(tmp, 'app.db'),
  UPLOAD_ROOT: join(tmp, 'uploads'),
  ADMIN_PASSWORD: 'admin123',
  COOKIE_SECRET: 'smoke-secret',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
    '89000000000a49444154789c6300010000050001' +
    '0d0a2db4000000004945' +
    '4e44ae426082',
  'hex'
);

function addYears(isoDate, years) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + Number(years));
  return d.toISOString().slice(0, 10);
}
const today = new Date().toISOString().slice(0, 10);

let server, pass = 0, fail = 0;
const results = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
function cookieFrom(res) {
  const c = (res.headers.getSetCookie?.() || []).find((x) => x.startsWith('uid='));
  return c ? c.split(';')[0] : '';
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/login`); if (r.ok) return; } catch {}
    await sleep(100);
  }
  throw new Error('server did not start in time');
}
async function login(identifier, password) {
  // Local login is by email (the `email` field also accepts a username).
  const body = new URLSearchParams({ email: identifier, password });
  const res = await fetch(`${BASE}/login`, { method: 'POST', body, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') || '', cookie: cookieFrom(res), res };
}
function photoForm(fields, angles) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const a of angles) fd.set(a, new Blob([PNG], { type: 'image/png' }), `${a}.png`);
  return fd;
}

async function run() {
  // 1. admin login
  const admin = await login('admin', 'admin123');
  ok('admin login → /admin', admin.status === 302 && admin.location.endsWith('/admin'), `${admin.status} ${admin.location}`);

  // 2. production user login
  const prod = await login('mike', 'mike123');
  ok('production login → /production', prod.status === 302 && prod.location.endsWith('/production'), `${prod.status} ${prod.location}`);

  // 3. wrong password fails
  const bad = await login('mike', 'WRONG');
  ok('wrong password → 401', bad.status === 401, String(bad.status));

  // 4. logged-out production route blocked
  const guard = await fetch(`${BASE}/production`, { redirect: 'manual' });
  ok('logged-out /production → /login', guard.status === 302 && /\/login/.test(guard.headers.get('location') || ''));

  // 5. admin dashboard works
  ok('admin dashboard 200', (await fetch(`${BASE}/admin`, { headers: { cookie: admin.cookie } })).status === 200);

  // 5b. OAuth: Google hidden + route safely disabled when no creds
  const loginHtml = await (await fetch(`${BASE}/login`)).text();
  ok('login hides Google when unconfigured', !/Continue with Google/.test(loginHtml));
  ok('login hides Apple when unconfigured', !/Continue with Apple/.test(loginHtml));
  const gOff = await fetch(`${BASE}/auth/google`, { redirect: 'manual' });
  ok('/auth/google disabled → /login?error=google-off', gOff.status === 302 && /google-off/.test(gOff.headers.get('location') || ''));

  // 5c. role gating: production blocked from admin, admin manages users
  ok('production blocked from /admin (403)', (await fetch(`${BASE}/admin`, { headers: { cookie: prod.cookie }, redirect: 'manual' })).status === 403);
  ok('admin users page 200', (await fetch(`${BASE}/admin/users`, { headers: { cookie: admin.cookie } })).status === 200);

  // generate 1 product
  const gen = await fetch(`${BASE}/admin/generate`, {
    method: 'POST', headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ count: '1', warranty_years: '10' }),
  });
  const serial = ((await gen.text()).match(/SKY-[0-9A-Z]{8}/) || [])[0];
  ok('generated a serial', Boolean(serial), serial || 'none');

  // production form: batch/size gone, tags present
  const formHtml = await (await fetch(`${BASE}/p/${serial}/production`, { headers: { cookie: prod.cookie } })).text();
  ok('production form has no Batch number', !/batch/i.test(formHtml));
  ok('production form has no Size/dimensions', !/size\s*\/\s*dimensions/i.test(formHtml));
  ok('production form shows tags Tile/M25/Custom', /Tile/.test(formHtml) && /M25/.test(formHtml) && /Custom/.test(formHtml));
  ok('production date defaults to today', formHtml.includes(today), today);

  // 10. installer blocked before production
  const earlyInstall = await fetch(`${BASE}/p/${serial}/install`, {
    method: 'POST', body: photoForm({
      installer_name: 'B', installer_company: 'C', installer_phone: '1', installer_email: 'b@b.co',
      site_name: 'S', site_address: 'A', installation_date: today,
    }, ['front', 'back', 'left', 'right']), redirect: 'manual',
  });
  ok('install blocked before production', earlyInstall.status === 302 && /not-yet-manufactured/.test(earlyInstall.headers.get('location') || ''), String(earlyInstall.status));

  // 9a. production with 3 photos rejected
  const prod3 = await fetch(`${BASE}/p/${serial}/production`, {
    method: 'POST', headers: { cookie: prod.cookie },
    body: photoForm({ product_tag: 'Tile' }, ['front', 'back', 'left']), redirect: 'manual',
  });
  ok('production with 3 photos → 400', prod3.status === 400, String(prod3.status));

  // 8. Custom tag requires description
  const prodCustom = await fetch(`${BASE}/p/${serial}/production`, {
    method: 'POST', headers: { cookie: prod.cookie },
    body: photoForm({ product_tag: 'Custom' }, ['front', 'back', 'left', 'right']), redirect: 'manual',
  });
  ok('Custom tag without description → 400', prodCustom.status === 400, String(prodCustom.status));

  // production complete (Tile + 4 photos)
  const prodOk = await fetch(`${BASE}/p/${serial}/production`, {
    method: 'POST', headers: { cookie: prod.cookie },
    body: photoForm({ product_tag: 'Tile', notes: 'ok' }, ['front', 'back', 'left', 'right']), redirect: 'manual',
  });
  ok('production with 4 photos → 302', prodOk.status === 302, String(prodOk.status));

  // 11a. install with 3 photos rejected
  const inst3 = await fetch(`${BASE}/p/${serial}/install`, {
    method: 'POST', body: photoForm({
      installer_name: 'Bob', installer_company: 'BuildCo', installer_phone: '021', installer_email: 'bob@b.co',
      site_name: 'Site', site_address: '1 St', installation_date: today,
    }, ['front', 'back', 'left']), redirect: 'manual',
  });
  ok('install with 3 photos → 400', inst3.status === 400, String(inst3.status));

  // install complete
  const inst4 = await fetch(`${BASE}/p/${serial}/install`, {
    method: 'POST', body: photoForm({
      installer_name: 'Bob', installer_company: 'BuildCo', installer_phone: '021', installer_email: 'bob@b.co',
      site_name: 'Site', site_address: '1 St', installation_date: today,
    }, ['front', 'back', 'left', 'right']), redirect: 'manual',
  });
  ok('install with 4 photos → 302', inst4.status === 302, String(inst4.status));

  // 12. warranty dates from production date
  const detail = await (await fetch(`${BASE}/admin/products/${serial}`, { headers: { cookie: admin.cookie } })).text();
  ok('warranty start = production date (today)', detail.includes(today), today);
  ok('warranty end = today + 10y', detail.includes(addYears(today, 10)), addYears(today, 10));

  // 13. admin views production + installation photos
  const prodPhoto = await fetch(`${BASE}/uploads/${serial}/prod-front.png`, { headers: { cookie: admin.cookie } });
  const instPhoto = await fetch(`${BASE}/uploads/${serial}/inst-front.png`, { headers: { cookie: admin.cookie } });
  ok('production photo served to admin', prodPhoto.status === 200, String(prodPhoto.status));
  ok('installation photo served to admin', instPhoto.status === 200, String(instPhoto.status));
  ok('photos not public (no cookie → 302)', (await fetch(`${BASE}/uploads/${serial}/prod-front.png`, { redirect: 'manual' })).status === 302);

  // 14. CSV export (incl. installer_source)
  const csv = await (await fetch(`${BASE}/admin/export.csv`, { headers: { cookie: admin.cookie } })).text();
  ok('CSV has product_tag + serial, no batch/size', /product_tag/.test(csv) && csv.includes(serial) && !/batch_number|^size,|,size,/m.test(csv));
  ok('CSV has installer_source column', /installer_source/.test(csv));
  ok('installation source defaulted to web', /Submitted via/.test(detail) && /web/i.test(detail));

  // 15. QR png
  const qr = await fetch(`${BASE}/qr/${serial}.png`);
  ok('QR png served', qr.status === 200 && (qr.headers.get('content-type') || '').includes('png'));

  // duplicate install blocked
  const dup = await fetch(`${BASE}/p/${serial}/install`, {
    method: 'POST', body: photoForm({
      installer_name: 'X', installer_company: 'Y', installer_phone: '1', installer_email: 'x@y.co',
      site_name: 'S', site_address: 'A', installation_date: today,
    }, ['front', 'back', 'left', 'right']), redirect: 'manual',
  });
  ok('duplicate install blocked', dup.status === 302 && /already-installed/.test(dup.headers.get('location') || ''));

  // --- Archive / self-describing bundles / cloud ---
  const infoPath = join(tmp, 'uploads', serial, 'info.json');
  ok('info.json written next to photos', existsSync(infoPath) && /installer_name/.test(existsSync(infoPath) ? readFileSync(infoPath, 'utf8') : ''));
  ok('archive page renders', (await fetch(`${BASE}/admin/archive`, { headers: { cookie: admin.cookie } })).status === 200);
  const bundle = await fetch(`${BASE}/admin/products/${serial}/bundle.zip`, { headers: { cookie: admin.cookie } });
  const bbuf = Buffer.from(await bundle.arrayBuffer());
  ok('per-record bundle.zip is a zip', bundle.status === 200 && bbuf.slice(0, 2).toString() === 'PK');
  const arch = await fetch(`${BASE}/admin/archive.zip`, { headers: { cookie: admin.cookie } });
  const abuf = Buffer.from(await arch.arrayBuffer());
  ok('full archive.zip is a zip', arch.status === 200 && abuf.slice(0, 2).toString() === 'PK');
  const sync = await fetch(`${BASE}/admin/cloud/sync`, { method: 'POST', headers: { cookie: admin.cookie }, redirect: 'manual' });
  ok('cloud sync gracefully disabled when unconfigured', sync.status === 302 && /cloud-disabled/.test(sync.headers.get('location') || ''));

  // --- Cloud / PWA / app endpoints ---
  const health = await fetch(`${BASE}/health`);
  ok('/health returns ok', health.status === 200 && /"status":"ok"/.test(await health.text()));

  const appPage = await fetch(`${BASE}/app`);
  ok('/app landing renders', appPage.status === 200 && /optional/i.test(await appPage.text()));

  const alias = await fetch(`${BASE}/install/${serial}`, { redirect: 'manual' });
  ok('/install/:serial redirects to /p/:serial', alias.status === 302 && (alias.headers.get('location') || '').endsWith(`/p/${serial}`));

  const manifest = await fetch(`${BASE}/manifest.webmanifest`);
  ok('manifest served', manifest.status === 200 && /LUXWELD Warranty/.test(await manifest.text()));
  ok('service worker served', (await fetch(`${BASE}/sw.js`)).status === 200);
  ok('icon-192 served', (await fetch(`${BASE}/icon-192.png`)).status === 200);

  // install form has remember checkbox + app CTA + source field
  const freshForm = await (async () => {
    // generate + register production on a new unit, then GET its install form
    const g = await fetch(`${BASE}/admin/generate`, { method: 'POST', headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ count: '1', warranty_years: '10' }) });
    const s2 = ((await g.text()).match(/SKY-[0-9A-Z]{8}/g) || []).pop();
    await fetch(`${BASE}/p/${s2}/production`, { method: 'POST', headers: { cookie: prod.cookie }, body: photoForm({ product_tag: 'M25' }, ['front', 'back', 'left', 'right']), redirect: 'manual' });
    return (await fetch(`${BASE}/p/${s2}/install`)).text();
  })();
  ok('install form has Remember-my-details', /Remember my details/i.test(freshForm));
  ok('install form has app CTA', /Get the app/i.test(freshForm) && /Install often/i.test(freshForm));
  ok('install form has hidden source field', /name="source"/.test(freshForm));
}

(async () => {
  server = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try { await waitUp(); await run(); }
  catch (e) { fail++; results.push(`  FAIL  harness error: ${e.message}`); }
  finally { server.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log('\nLUXWELD smoke test:\n' + results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
