import { db } from '../db.js';
import { warrantyStatus } from './warranty.js';

export function getProductBySerial(serial) {
  return db.prepare('SELECT * FROM product WHERE serial = ?').get(serial);
}

export function getProductByToken(token) {
  return db.prepare('SELECT * FROM product WHERE public_token = ?').get(token);
}

export function getProductionForProduct(productId) {
  return db
    .prepare('SELECT * FROM production_registration WHERE product_id = ?')
    .get(productId);
}

export function getInstallationForProduct(productId) {
  return db
    .prepare('SELECT * FROM installation_registration WHERE product_id = ?')
    .get(productId);
}

export function getWarrantyForProduct(productId) {
  return db.prepare('SELECT * FROM warranty WHERE product_id = ?').get(productId);
}

// Photos for a product, optionally filtered by kind ('PRODUCTION' | 'INSTALLATION').
export function getPhotos(productId, kind) {
  if (!productId) return [];
  if (kind) {
    return db
      .prepare('SELECT * FROM photo WHERE product_id = ? AND kind = ? ORDER BY angle')
      .all(productId, kind);
  }
  return db.prepare('SELECT * FROM photo WHERE product_id = ? ORDER BY kind, angle').all(productId);
}

// Assemble the full bundle + computed status for one product.
export function getFullProduct(serial) {
  const product = getProductBySerial(serial);
  if (!product) return null;
  const production = getProductionForProduct(product.id);
  const installation = getInstallationForProduct(product.id);
  const warranty = getWarrantyForProduct(product.id);
  const productionPhotos = getPhotos(product.id, 'PRODUCTION');
  const installationPhotos = getPhotos(product.id, 'INSTALLATION');
  const status = warrantyStatus({
    product,
    production,
    installation,
    warranty,
    instPhotoCount: installationPhotos.length,
  });
  return { product, production, installation, warranty, productionPhotos, installationPhotos, status };
}

// Dashboard list with optional search + status filter.
export function listProducts({ q = '', filter = '' } = {}) {
  const rows = db
    .prepare(
      `SELECT p.*,
              pr.product_tag, pr.custom_description, pr.production_date,
              pr.team_member_name AS production_user, pr.notes AS production_notes,
              ir.installer_name, ir.installer_company, ir.installer_email, ir.installer_phone,
              ir.site_name, ir.site_address, ir.installation_date, ir.notes AS installation_notes,
              ir.source AS installer_source,
              w.start_date AS warranty_start, w.end_date AS warranty_end, w.length_years
       FROM product p
       LEFT JOIN production_registration pr ON pr.product_id = p.id
       LEFT JOIN installation_registration ir ON ir.product_id = p.id
       LEFT JOIN warranty w ON w.product_id = p.id
       ORDER BY p.created_at DESC, p.id DESC`
    )
    .all();

  const photoCountStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM photo WHERE product_id = ? AND kind = ?'
  );

  const enriched = rows.map((r) => {
    const prodPhotoCount = photoCountStmt.get(r.id, 'PRODUCTION').n;
    const instPhotoCount = photoCountStmt.get(r.id, 'INSTALLATION').n;
    const status = warrantyStatus({
      product: r,
      production: r.production_date ? r : null,
      installation: r.installer_name ? r : null,
      warranty: r.warranty_end ? { end_date: r.warranty_end } : null,
      instPhotoCount,
    });
    return { ...r, status, prodPhotoCount, instPhotoCount };
  });

  let result = enriched;

  if (q) {
    const needle = q.toLowerCase();
    result = result.filter((r) =>
      [
        r.serial, r.installer_name, r.site_name, r.site_address,
        r.product_tag, r.custom_description, r.installer_company,
        r.installer_email, r.production_user, r.status,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }

  if (filter) {
    const map = {
      created: (r) => r.status === 'Awaiting Production',
      manufactured: (r) => r.status === 'Ready for Installation',
      installed: (r) => ['Active', 'Expired', 'Incomplete'].includes(r.status),
      active: (r) => r.status === 'Active',
      expired: (r) => r.status === 'Expired',
      incomplete: (r) => r.status === 'Incomplete',
      cancelled: (r) => r.status === 'Cancelled',
    };
    if (map[filter]) result = result.filter(map[filter]);
  }

  return result;
}
