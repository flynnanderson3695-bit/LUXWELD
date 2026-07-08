import { Router } from 'express';
import { resolve, join } from 'node:path';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import archiver from 'archiver';
import QRCode from 'qrcode';
import { stringify } from 'csv-stringify/sync';
import { customAlphabet } from 'nanoid';
import { db, tx } from '../db.js';
import {
  requireRole, listUsers, createLocalUser, setRole, setPassword, toggleActive,
  getUserByEmail, ROLES,
} from '../lib/auth.js';
import { listProducts, getFullProduct, getProductBySerial, getPhotos } from '../lib/queries.js';
import { addYears } from '../lib/warranty.js';
import { PRODUCT_TAGS } from '../lib/constants.js';
import { UPLOAD_ROOT, BASE_URL, CLOUD_BUCKET } from '../lib/config.js';
import { recordInfo, recordText, writeLocalInfo } from '../lib/records.js';
import { cloudEnabled, mirrorSerialAsync, syncAll, backupDatabase } from '../lib/cloud.js';
import { buildArchiveSite } from '../lib/archive-site.js';
import { driveStatus, buildAuthUrl, connectWithCode, backupToDrive, disconnectDrive } from '../lib/drive.js';
import { DRIVE_CONFIGURED } from '../lib/config.js';

const serialId = customAlphabet('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 8);
const tokenId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

function baseUrl(req) {
  return BASE_URL || `${req.protocol}://${req.get('host')}`;
}

const router = Router();

// ---- Dashboard ----
router.get('/admin', requireRole('admin'), (req, res) => {
  const q = req.query.q || '';
  const filter = req.query.filter || '';
  const rows = listProducts({ q, filter });
  res.render('admin-dashboard', { rows, q, filter, baseUrl: baseUrl(req) });
});

// ---- Bulk generate ----
router.get('/admin/generate', requireRole('admin'), (req, res) => {
  res.render('admin-generate', { created: null, baseUrl: baseUrl(req) });
});

router.post('/admin/generate', requireRole('admin'), (req, res) => {
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 1, 1), 500);
  const warrantyYears = Math.max(parseInt(req.body.warranty_years, 10) || 10, 1);

  const insert = db.prepare(
    'INSERT INTO product (serial, public_token, warranty_years) VALUES (?,?,?)'
  );
  const created = [];
  tx(() => {
    for (let i = 0; i < count; i++) {
      let serial;
      do { serial = `SKY-${serialId()}`; } while (getProductBySerial(serial));
      insert.run(serial, tokenId(), warrantyYears);
      created.push(serial);
    }
  });

  res.render('admin-generate', { created, baseUrl: baseUrl(req) });
});

// ---- Printable QR label sheet ----
router.get('/admin/qr-sheet', requireRole('admin'), (req, res) => {
  const serials = (req.query.serials || '').split(',').map((s) => s.trim()).filter(Boolean);
  res.render('admin-qr-sheet', { serials, baseUrl: baseUrl(req) });
});

// ---- QR image (PNG). Encodes the public product URL. ----
router.get('/qr/:serial.png', async (req, res) => {
  const product = getProductBySerial(req.params.serial);
  if (!product) return res.status(404).end();
  const url = `${baseUrl(req)}/p/${product.serial}`;
  try {
    res.type('png');
    res.end(await QRCode.toBuffer(url, { width: 320, margin: 1 }));
  } catch {
    res.status(500).end();
  }
});

// ---- Product detail ----
router.get('/admin/products/:serial', requireRole('admin'), (req, res) => {
  const data = getFullProduct(req.params.serial);
  if (!data) return res.status(404).render('not-found', { serial: req.params.serial });
  res.render('admin-detail', {
    ...data,
    tags: PRODUCT_TAGS,
    baseUrl: baseUrl(req),
    saved: req.query.saved || null,
  });
});

// ---- Correct a record (production + installation + warranty length) ----
router.post('/admin/products/:serial/edit', requireRole('admin'), (req, res) => {
  const product = getProductBySerial(req.params.serial);
  if (!product) return res.status(404).render('not-found', { serial: req.params.serial });
  const b = req.body || {};

  tx(() => {
    if (b.warranty_years) {
      db.prepare('UPDATE product SET warranty_years = ? WHERE id = ?')
        .run(Math.max(parseInt(b.warranty_years, 10) || product.warranty_years, 1), product.id);
    }

    const prod = db.prepare('SELECT * FROM production_registration WHERE product_id = ?').get(product.id);
    if (prod) {
      const tag = PRODUCT_TAGS.includes(b.product_tag) ? b.product_tag : prod.product_tag;
      db.prepare(
        `UPDATE production_registration
         SET product_tag=?, custom_description=?, production_date=?, team_member_name=?, notes=?
         WHERE product_id=?`
      ).run(
        tag,
        tag === 'Custom' ? ((b.custom_description || '').trim() || null) : null,
        b.production_date || prod.production_date,
        (b.team_member_name ?? prod.team_member_name) || prod.team_member_name,
        (b.notes_prod || '').trim() || null,
        product.id
      );
    }

    const inst = db.prepare('SELECT * FROM installation_registration WHERE product_id = ?').get(product.id);
    if (inst) {
      db.prepare(
        `UPDATE installation_registration
         SET installer_name=?, installer_company=?, installer_phone=?, installer_email=?,
             site_name=?, site_address=?, installation_date=?, notes=?
         WHERE product_id=?`
      ).run(
        b.installer_name ?? inst.installer_name, b.installer_company ?? inst.installer_company,
        b.installer_phone ?? inst.installer_phone, b.installer_email ?? inst.installer_email,
        b.site_name ?? inst.site_name, b.site_address ?? inst.site_address,
        b.installation_date || inst.installation_date,
        (b.notes_inst || '').trim() || null, product.id
      );
    }

    // Re-snapshot warranty dates from (possibly updated) production date + length.
    const updatedProduct = db.prepare('SELECT * FROM product WHERE id = ?').get(product.id);
    const updatedProd = db.prepare('SELECT * FROM production_registration WHERE product_id = ?').get(product.id);
    const warranty = db.prepare('SELECT * FROM warranty WHERE product_id = ?').get(product.id);
    if (warranty && updatedProd) {
      const start = updatedProd.production_date;
      db.prepare('UPDATE warranty SET start_date=?, end_date=?, length_years=? WHERE product_id=?')
        .run(start, addYears(start, updatedProduct.warranty_years), updatedProduct.warranty_years, product.id);
    }
  });

  // Refresh the self-describing info + cloud mirror after an admin correction.
  writeLocalInfo(product.serial);
  mirrorSerialAsync(product.serial);

  res.redirect(`/admin/products/${product.serial}?saved=1`);
});

// ---- Reset installation (admin override for duplicate/incorrect registration) ----
router.post('/admin/products/:serial/reset-installation', requireRole('admin'), (req, res) => {
  const product = getProductBySerial(req.params.serial);
  if (!product) return res.status(404).render('not-found', { serial: req.params.serial });
  tx(() => {
    db.prepare("DELETE FROM photo WHERE product_id = ? AND kind = 'INSTALLATION'").run(product.id);
    db.prepare('DELETE FROM warranty WHERE product_id = ?').run(product.id);
    db.prepare('DELETE FROM installation_registration WHERE product_id = ?').run(product.id);
    if (product.status === 'INSTALLED')
      db.prepare("UPDATE product SET status = 'MANUFACTURED' WHERE id = ?").run(product.id);
  });
  writeLocalInfo(product.serial);
  mirrorSerialAsync(product.serial);
  res.redirect(`/admin/products/${product.serial}?saved=1`);
});

// ---- Cancel / restore a unit ----
router.post('/admin/products/:serial/cancel', requireRole('admin'), (req, res) => {
  const product = getProductBySerial(req.params.serial);
  if (!product) return res.status(404).render('not-found', { serial: req.params.serial });
  if (req.body.action === 'restore') {
    const hasInst = db.prepare('SELECT 1 FROM installation_registration WHERE product_id=?').get(product.id);
    const hasProd = db.prepare('SELECT 1 FROM production_registration WHERE product_id=?').get(product.id);
    const status = hasInst ? 'INSTALLED' : hasProd ? 'MANUFACTURED' : 'CREATED';
    db.prepare('UPDATE product SET status=?, cancelled_reason=NULL WHERE id=?').run(status, product.id);
  } else {
    db.prepare("UPDATE product SET status='CANCELLED', cancelled_reason=? WHERE id=?")
      .run((req.body.reason || '').trim() || 'Cancelled by admin', product.id);
  }
  res.redirect(`/admin/products/${product.serial}?saved=1`);
});

// ---- CSV export ----
router.get('/admin/export.csv', requireRole('admin'), (req, res) => {
  const rows = listProducts({ q: req.query.q || '', filter: req.query.filter || '' });
  const records = rows.map((r) => ({
    serial: r.serial,
    status: r.status,
    product_tag: r.product_tag || '',
    custom_description: r.custom_description || '',
    production_date: r.production_date || '',
    production_user: r.production_user || '',
    production_notes: r.production_notes || '',
    installer_name: r.installer_name || '',
    installer_company: r.installer_company || '',
    installer_phone: r.installer_phone || '',
    installer_email: r.installer_email || '',
    site_name: r.site_name || '',
    site_address: r.site_address || '',
    installation_date: r.installation_date || '',
    installer_source: r.installer_source || '',
    warranty_start: r.warranty_start || '',
    warranty_end: r.warranty_end || '',
    warranty_years: r.length_years || r.warranty_years || '',
    production_photos: r.prodPhotoCount,
    installation_photos: r.instPhotoCount,
  }));
  const csv = stringify(records, { header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="luxweld-warranties-${Date.now()}.csv"`);
  res.send(csv);
});

// ---- User management ----
router.get('/admin/users', requireRole('admin'), (req, res) => {
  res.render('admin-users', {
    users: listUsers(),
    roles: ROLES,
    error: req.query.error || null,
    saved: req.query.saved || null,
  });
});

// Create a local (email/password) account with a role.
router.post('/admin/users', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  const email = (b.email || '').trim().toLowerCase() || null;
  const role = ROLES.includes(b.role) ? b.role : 'installer';
  const password = b.password || '';

  if (!name || !email || password.length < 6)
    return res.redirect('/admin/users?error=invalid');
  if (getUserByEmail(email)) return res.redirect('/admin/users?error=exists');

  createLocalUser({ name, email, password, role });
  res.redirect('/admin/users?saved=1');
});

// Assign / change a user's role (DB-controlled, not the OAuth provider).
router.post('/admin/users/:id/role', requireRole('admin'), (req, res) => {
  setRole(Number(req.params.id), req.body.role);
  res.redirect('/admin/users?saved=1');
});

router.post('/admin/users/:id/password', requireRole('admin'), (req, res) => {
  const password = req.body.password || '';
  if (password.length < 6) return res.redirect('/admin/users?error=invalid');
  setPassword(Number(req.params.id), password);
  res.redirect('/admin/users?saved=1');
});

router.post('/admin/users/:id/toggle', requireRole('admin'), (req, res) => {
  toggleActive(Number(req.params.id));
  res.redirect('/admin/users?saved=1');
});

// ---- Archive / Records Vault: gallery of every warranty with its photos + info ----
router.get('/admin/archive', requireRole('admin'), (req, res) => {
  const q = req.query.q || '';
  const filter = req.query.filter || '';
  const rows = listProducts({ q, filter }).map((r) => ({ ...r, photos: getPhotos(r.id) }));
  res.render('admin-archive', {
    rows, q, filter, baseUrl: baseUrl(req),
    cloudEnabled, cloudBucket: CLOUD_BUCKET,
    synced: req.query.synced || null,
    drive: driveStatus(),
    driveMsg: req.query.drive || null,
  });
});

// ---- Google Drive automatic backup ----
router.get('/admin/drive/connect', requireRole('admin'), (req, res) => {
  if (!DRIVE_CONFIGURED) return res.redirect('/admin/archive?drive=not-configured');
  res.redirect(buildAuthUrl());
});

router.get('/admin/drive/callback', requireRole('admin'), async (req, res) => {
  if (!req.query.code) return res.redirect('/admin/archive?drive=cancelled');
  try {
    await connectWithCode(req.query.code);
    res.redirect('/admin/archive?drive=connected');
  } catch (e) {
    res.redirect('/admin/archive?drive=' + encodeURIComponent('error: ' + e.message));
  }
});

router.post('/admin/drive/backup-now', requireRole('admin'), async (req, res) => {
  const r = await backupToDrive();
  res.redirect('/admin/archive?drive=' + encodeURIComponent(r.ok ? 'backed up ' + r.name : 'failed: ' + r.error));
});

router.post('/admin/drive/disconnect', requireRole('admin'), (req, res) => {
  disconnectDrive();
  res.redirect('/admin/archive?drive=disconnected');
});

// Stream a zip where each serial is a self-describing folder (photos + info).
function streamBundle(res, serials, filename) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (e) => { console.error('zip error:', e); try { res.status(500).end(); } catch {} });
  archive.pipe(res);
  for (const serial of serials) {
    const info = recordInfo(serial);
    if (!info) continue;
    archive.append(JSON.stringify(info, null, 2), { name: `${serial}/info.json` });
    archive.append(recordText(info), { name: `${serial}/record.txt` });
    const photos = [...(info.production?.photos || []), ...(info.installation?.photos || [])];
    for (const p of photos) {
      const local = resolve(UPLOAD_ROOT, serial, p.file);
      if (existsSync(local)) archive.file(local, { name: `${serial}/${p.file}` });
    }
  }
  archive.finalize();
}

router.get('/admin/products/:serial/bundle.zip', requireRole('admin'), (req, res) => {
  const product = getProductBySerial(req.params.serial);
  if (!product) return res.status(404).render('not-found', { serial: req.params.serial });
  streamBundle(res, [product.serial], `luxweld-${product.serial}.zip`);
});

router.get('/admin/archive.zip', requireRole('admin'), (req, res) => {
  const rows = listProducts({ q: req.query.q || '', filter: req.query.filter || '' });
  streamBundle(res, rows.map((r) => r.serial), `luxweld-archive-${Date.now()}.zip`);
});

// Download the full standalone LUXWELD-styled archive WEBSITE (open index.html).
router.get('/admin/archive-site.zip', requireRole('admin'), (req, res) => {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'lux-site-'));
    buildArchiveSite(dir);
  } catch (e) {
    console.error('archive-site build failed:', e);
    return res.status(500).end();
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="luxweld-archive-site-${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (e) => { console.error('zip error:', e); try { res.status(500).end(); } catch {} });
  archive.on('close', () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  archive.pipe(res);
  archive.directory(dir, false);
  archive.finalize();
});

// ---- Cloud mirror actions ----
router.post('/admin/cloud/sync', requireRole('admin'), async (req, res) => {
  const r = await syncAll();
  const msg = r.skipped ? 'cloud-disabled' : `synced ${r.mirrored} records, ${r.photos} photos`;
  res.redirect('/admin/archive?synced=' + encodeURIComponent(msg));
});

router.post('/admin/cloud/backup-db', requireRole('admin'), async (req, res) => {
  const r = await backupDatabase();
  const msg = r.skipped ? 'cloud-disabled' : r.ok ? 'database backed up to cloud' : 'backup failed';
  res.redirect('/admin/archive?synced=' + encodeURIComponent(msg));
});

// ---- Serve uploaded photos (admin only; not publicly listable) ----
router.get('/uploads/:serial/:file', requireRole('admin'), (req, res) => {
  const filePath = resolve(UPLOAD_ROOT, req.params.serial, req.params.file);
  if (!filePath.startsWith(resolve(UPLOAD_ROOT)) || !existsSync(filePath))
    return res.status(404).end();
  res.sendFile(filePath);
});

export default router;
