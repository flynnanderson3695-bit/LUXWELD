// Builds a self-describing record for one warranty: all the installer /
// production / installation / warranty info, plus the list of photo files.
// Used for the per-serial info.json written next to the photos, the zip
// bundles, and the cloud mirror — so the info always travels WITH the pictures.
import { basename, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getFullProduct } from './queries.js';
import { UPLOAD_ROOT } from './config.js';

export function recordInfo(serial) {
  const data = getFullProduct(serial);
  if (!data) return null;
  const { product, production, installation, warranty, productionPhotos, installationPhotos, status } = data;

  const photo = (p) => ({ kind: p.kind, angle: p.angle, file: basename(p.file_path) });

  return {
    serial: product.serial,
    status,
    warranty_years: product.warranty_years,
    product: {
      tag: production?.product_tag || null,
      custom_description: production?.custom_description || null,
    },
    production: production
      ? {
          production_date: production.production_date,
          registered_by: production.team_member_name || null,
          notes: production.notes || null,
          photos: productionPhotos.map(photo),
        }
      : null,
    installation: installation
      ? {
          installer_name: installation.installer_name,
          installer_company: installation.installer_company,
          installer_phone: installation.installer_phone,
          installer_email: installation.installer_email,
          site_name: installation.site_name,
          site_address: installation.site_address,
          installation_date: installation.installation_date,
          notes: installation.notes || null,
          submitted_via: installation.source || 'web',
          photos: installationPhotos.map(photo),
        }
      : null,
    warranty: warranty
      ? { start_date: warranty.start_date, end_date: warranty.end_date, length_years: warranty.length_years }
      : null,
    generated_at: new Date().toISOString(),
  };
}

// Human-readable companion to info.json (drops into each folder as record.txt).
export function recordText(info) {
  if (!info) return '';
  const L = [];
  L.push('LUXWELD WARRANTY RECORD');
  L.push('=======================');
  L.push(`Serial:            ${info.serial}`);
  L.push(`Status:            ${info.status}`);
  L.push(`Product tag:       ${info.product.tag || '—'}${info.product.custom_description ? ' (' + info.product.custom_description + ')' : ''}`);
  L.push('');
  L.push('PRODUCTION');
  if (info.production) {
    L.push(`  Production date: ${info.production.production_date}`);
    L.push(`  Registered by:   ${info.production.registered_by || '—'}`);
    L.push(`  Notes:           ${info.production.notes || '—'}`);
    L.push(`  Photos:          ${info.production.photos.map((p) => p.file).join(', ') || '—'}`);
  } else L.push('  (not registered)');
  L.push('');
  L.push('INSTALLATION');
  if (info.installation) {
    const i = info.installation;
    L.push(`  Installer:       ${i.installer_name} — ${i.installer_company}`);
    L.push(`  Contact:         ${i.installer_phone} · ${i.installer_email}`);
    L.push(`  Site:            ${i.site_name}`);
    L.push(`  Address:         ${i.site_address}`);
    L.push(`  Install date:    ${i.installation_date}`);
    L.push(`  Submitted via:   ${i.submitted_via}`);
    L.push(`  Notes:           ${i.notes || '—'}`);
    L.push(`  Photos:          ${i.photos.map((p) => p.file).join(', ') || '—'}`);
  } else L.push('  (not installed)');
  L.push('');
  L.push('WARRANTY');
  if (info.warranty) {
    L.push(`  Start:           ${info.warranty.start_date}`);
    L.push(`  End:             ${info.warranty.end_date}`);
    L.push(`  Length:          ${info.warranty.length_years} years`);
  } else L.push('  (not active)');
  L.push('');
  L.push(`Generated: ${info.generated_at}`);
  return L.join('\n');
}

// Writes info.json + record.txt into the serial's local upload folder, so the
// folder on disk (Railway volume) is self-describing — the info sits next to
// the photos. Best-effort; never throws to the caller.
export function writeLocalInfo(serial) {
  try {
    const info = recordInfo(serial);
    if (!info) return null;
    const dir = resolve(UPLOAD_ROOT, serial);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'info.json'), JSON.stringify(info, null, 2));
    writeFileSync(resolve(dir, 'record.txt'), recordText(info));
    return info;
  } catch (e) {
    console.warn(`writeLocalInfo(${serial}) failed:`, e.message);
    return null;
  }
}
