import { Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { db, tx } from '../db.js';
import { getFullProduct, getProductBySerial } from '../lib/queries.js';
import { addYears, todayISO } from '../lib/warranty.js';
import { ANGLES } from '../lib/constants.js';
import { UPLOAD_ROOT } from '../lib/config.js';
import { currentUser } from '../lib/auth.js';
import { writeLocalInfo } from '../lib/records.js';
import { mirrorSerialAsync } from '../lib/cloud.js';
import { mirrorSerialToDriveAsync } from '../lib/drive.js';

const VALID_SOURCES = ['web', 'pwa', 'android', 'ios'];

// Installation photos stored with an `inst-` prefix (separate from production).
const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = resolve(UPLOAD_ROOT, req.params.serial);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `inst-${file.fieldname}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 4 },
  fileFilter(_req, file, cb) {
    cb(null, /^image\//.test(file.mimetype));
  },
}).fields(ANGLES.map((a) => ({ name: a, maxCount: 1 })));

const router = Router();

// Optional companion-app landing page.
router.get('/app', (req, res) => res.render('app-landing'));

// Alias so /install/:serial also works (QR codes use /p/:serial).
router.get('/install/:serial', (req, res) => res.redirect(`/p/${req.params.serial}`));

// Smart landing page — branches on product status.
router.get('/p/:serial', (req, res) => {
  const data = getFullProduct(req.params.serial);
  if (!data) return res.status(404).render('not-found', { serial: req.params.serial });
  res.render('product-landing', { ...data, notice: req.query.notice || null });
});

// Installation form (no login). Only valid when production is complete.
router.get('/p/:serial/install', (req, res) => {
  const data = getFullProduct(req.params.serial);
  if (!data) return res.status(404).render('not-found', { serial: req.params.serial });

  if (data.product.status === 'CREATED')
    return res.redirect(`/p/${req.params.serial}?notice=not-yet-manufactured`);
  if (data.product.status === 'INSTALLED')
    return res.redirect(`/p/${req.params.serial}?notice=already-installed`);
  if (data.product.status === 'CANCELLED')
    return res.redirect(`/p/${req.params.serial}?notice=cancelled`);

  // Prefill from a signed-in installer's saved profile (if any).
  const u = currentUser(req);
  const values = u
    ? { installer_name: u.name || '', installer_company: u.company || '', installer_phone: u.phone || '', installer_email: u.email || '' }
    : {};

  res.render('install-form', {
    product: data.product,
    production: data.production,
    angles: ANGLES,
    today: todayISO(),
    values,
    error: null,
  });
});

router.post('/p/:serial/install', (req, res) => {
  upload(req, res, (err) => {
    const serial = req.params.serial;
    const product = getProductBySerial(serial);
    if (!product) return res.status(404).render('not-found', { serial });

    const production = db
      .prepare('SELECT * FROM production_registration WHERE product_id = ?')
      .get(product.id);

    const rerender = (message) =>
      res.status(400).render('install-form', {
        product,
        production,
        angles: ANGLES,
        today: todayISO(),
        values: req.body || {},
        error: message,
      });

    if (err) return rerender(err.message || 'Photo upload failed.');

    // Guard: production must be complete; block duplicates / out-of-order scans.
    if (product.status === 'INSTALLED')
      return res.redirect(`/p/${serial}?notice=already-installed`);
    if (product.status === 'CANCELLED')
      return res.redirect(`/p/${serial}?notice=cancelled`);
    if (product.status !== 'MANUFACTURED')
      return res.redirect(`/p/${serial}?notice=not-yet-manufactured`);

    const required = [
      'installer_name', 'installer_company', 'installer_phone', 'installer_email',
      'site_name', 'site_address', 'installation_date',
    ];
    const b = req.body || {};
    const missing = required.filter((f) => !b[f] || !String(b[f]).trim());
    if (missing.length) return rerender(`Missing required fields: ${missing.join(', ')}.`);

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.installer_email))
      return rerender('Please enter a valid email address.');

    const files = req.files || {};
    const missingPhotos = ANGLES.filter((a) => !files[a] || !files[a][0]);
    if (missingPhotos.length)
      return rerender(`All 4 installed photos are required. Missing: ${missingPhotos.join(', ')}.`);

    // Warranty starts from the production date.
    const startDate = production.production_date;
    const endDate = addYears(startDate, product.warranty_years);
    const source = VALID_SOURCES.includes(b.source) ? b.source : 'web';

    try {
      tx(() => {
        db.prepare(
          `INSERT INTO installation_registration
           (product_id, installer_name, installer_company, installer_phone, installer_email,
            site_name, site_address, installation_date, notes, source)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).run(
          product.id, b.installer_name.trim(), b.installer_company.trim(),
          b.installer_phone.trim(), b.installer_email.trim(), b.site_name.trim(),
          b.site_address.trim(), b.installation_date, (b.notes || '').trim() || null, source
        );

        const photoStmt = db.prepare(
          'INSERT INTO photo (product_id, kind, angle, file_path, original_name) VALUES (?,?,?,?,?)'
        );
        for (const a of ANGLES) {
          const f = files[a][0];
          photoStmt.run(product.id, 'INSTALLATION', a.toUpperCase(), `${serial}/${f.filename}`, f.originalname);
        }

        db.prepare(
          'INSERT INTO warranty (product_id, start_date, end_date, length_years) VALUES (?,?,?,?)'
        ).run(product.id, startDate, endDate, product.warranty_years);

        db.prepare("UPDATE product SET status = 'INSTALLED' WHERE id = ?").run(product.id);
      });
    } catch (e) {
      return rerender('Could not save installation. It may have already been registered.');
    }

    // Write the self-describing info file next to the photos + mirror to cloud.
    writeLocalInfo(serial);
    mirrorSerialAsync(serial);
    mirrorSerialToDriveAsync(serial);

    res.redirect(`/p/${serial}?notice=installed-ok`);
  });
});

export default router;
