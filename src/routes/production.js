import { Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { db, tx } from '../db.js';
import { requireRole, currentUser } from '../lib/auth.js';
import { getFullProduct, getProductBySerial } from '../lib/queries.js';
import { PRODUCT_TAGS, ANGLES } from '../lib/constants.js';
import { todayISO } from '../lib/warranty.js';
import { UPLOAD_ROOT } from '../lib/config.js';
import { writeLocalInfo } from '../lib/records.js';
import { mirrorSerialAsync } from '../lib/cloud.js';
import { mirrorSerialToDriveAsync } from '../lib/drive.js';

// Production photos are stored with a `prod-` prefix so they never collide
// with installation photos in the same product folder.
const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = resolve(UPLOAD_ROOT, req.params.serial);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `prod-${file.fieldname}${ext}`);
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

// Production landing: enter/scan a serial + see products awaiting production.
router.get('/production', requireRole('production'), (req, res) => {
  const pending = db
    .prepare(
      "SELECT serial, created_at FROM product WHERE status = 'CREATED' ORDER BY created_at DESC, id DESC LIMIT 100"
    )
    .all();
  res.render('production-home', { pending, error: req.query.error || null });
});

router.post('/production/find', requireRole('production'), (req, res) => {
  const raw = (req.body.serial || '').trim().toUpperCase();
  if (!raw) return res.redirect('/production?error=enter-serial');
  const match = raw.match(/SKY-[0-9A-Z]+/);
  const serial = match ? match[0] : raw;
  const product = getProductBySerial(serial);
  if (!product) return res.redirect('/production?error=not-found');
  if (product.status === 'CREATED') return res.redirect(`/p/${serial}/production`);
  return res.redirect(`/p/${serial}`);
});

router.get('/p/:serial/production', requireRole('production'), (req, res) => {
  const data = getFullProduct(req.params.serial);
  if (!data) return res.status(404).render('not-found', { serial: req.params.serial });

  if (data.product.status === 'CANCELLED')
    return res.redirect(`/p/${req.params.serial}?notice=cancelled`);
  if (data.product.status !== 'CREATED')
    return res.redirect(`/p/${req.params.serial}?notice=already-manufactured`);

  res.render('production-form', {
    product: data.product,
    tags: PRODUCT_TAGS,
    angles: ANGLES,
    today: todayISO(),
    values: {},
    error: null,
  });
});

router.post('/p/:serial/production', requireRole('production'), (req, res) => {
  upload(req, res, (err) => {
    const serial = req.params.serial;
    const product = getProductBySerial(serial);
    if (!product) return res.status(404).render('not-found', { serial });
    const user = currentUser(req);

    const rerender = (message) =>
      res.status(400).render('production-form', {
        product,
        tags: PRODUCT_TAGS,
        angles: ANGLES,
        today: todayISO(),
        values: req.body || {},
        error: message,
      });

    if (err) return rerender(err.message || 'Photo upload failed.');

    if (product.status === 'CANCELLED') return res.redirect(`/p/${serial}?notice=cancelled`);
    if (product.status !== 'CREATED')
      return res.redirect(`/p/${serial}?notice=already-manufactured`);

    const b = req.body || {};
    const tag = (b.product_tag || '').trim();
    if (!PRODUCT_TAGS.includes(tag)) return rerender('Please choose a product tag.');

    const customDescription = (b.custom_description || '').trim();
    if (tag === 'Custom' && !customDescription)
      return rerender('A custom product description is required when the tag is "Custom".');

    // All 4 production photos required (insurance evidence before shipping).
    const files = req.files || {};
    const missingPhotos = ANGLES.filter((a) => !files[a] || !files[a][0]);
    if (missingPhotos.length)
      return rerender(`All 4 production photos are required. Missing: ${missingPhotos.join(', ')}.`);

    // Production date = today (the day the QR is applied). Auto-filled, not typed.
    const productionDate = todayISO();

    try {
      tx(() => {
        db.prepare(
          `INSERT INTO production_registration
           (product_id, product_tag, custom_description, production_date,
            production_user_id, team_member_name, notes)
           VALUES (?,?,?,?,?,?,?)`
        ).run(
          product.id,
          tag,
          tag === 'Custom' ? customDescription : null,
          productionDate,
          user?.id ?? null,
          user?.name ?? 'Unknown',
          (b.notes || '').trim() || null
        );

        const photoStmt = db.prepare(
          'INSERT INTO photo (product_id, kind, angle, file_path, original_name) VALUES (?,?,?,?,?)'
        );
        for (const a of ANGLES) {
          const f = files[a][0];
          photoStmt.run(product.id, 'PRODUCTION', a.toUpperCase(), `${serial}/${f.filename}`, f.originalname);
        }

        db.prepare("UPDATE product SET status = 'MANUFACTURED' WHERE id = ?").run(product.id);
      });
    } catch (e) {
      return rerender('Could not save. This product may already be registered.');
    }

    // Write the self-describing info file next to the photos + mirror to cloud.
    writeLocalInfo(serial);
    mirrorSerialAsync(serial);
    mirrorSerialToDriveAsync(serial);

    res.redirect(`/p/${serial}?notice=manufactured-ok`);
  });
});

export default router;
