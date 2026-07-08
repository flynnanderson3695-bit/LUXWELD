// Builds a SEPARATE, standalone, LUXWELD-styled archive website from the live
// data: an index (gallery + search) + one page per warranty with all info and
// photos, plus the photo files. Pure static HTML — opens in any browser, hosts
// anywhere, works offline. Rebuilt daily so it stays current.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { listProducts } from './queries.js';
import { recordInfo } from './records.js';
import { UPLOAD_ROOT } from './config.js';

const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function badge(status) {
  const map = {
    Active: 'ok', Expired: 'bad', 'Ready for Installation': 'warn',
    'Awaiting Production': 'mute', Incomplete: 'warn', Cancelled: 'mute',
  };
  return map[status] || 'mute';
}

const STYLE = `
:root{--ink:#0b0b0d;--s:#141417;--s2:#1d1d22;--b:#2c2c34;--g:#dcc06a;--g2:#c8a13e;--t:#e7e7ea;--m:#9a9aa2}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--t);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5}
a{color:var(--g);text-decoration:none}a:hover{text-decoration:underline}
.top{position:sticky;top:0;background:rgba(20,20,23,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--b);padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;z-index:5}
.logo{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-weight:900;color:var(--ink);background:linear-gradient(180deg,var(--g),var(--g2))}
.brand{letter-spacing:.25em;color:var(--g);font-weight:600}
.top small{color:var(--m);margin-left:auto}
.wrap{max-width:1100px;margin:0 auto;padding:20px}
h1{font-size:22px;margin:6px 0}.sub{color:var(--m);font-size:14px;margin:0 0 16px}
.search{width:100%;padding:12px 14px;font-size:16px;border:1px solid var(--b);border-radius:12px;background:#000;color:#fff;margin-bottom:16px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.card{background:var(--s);border:1px solid var(--b);border-radius:16px;padding:16px}
.card h3{margin:0;font-family:ui-monospace,monospace;font-size:15px}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.meta{font-size:12px;color:var(--m);margin:2px 0}.meta b{color:var(--t);font-weight:500}
.badge{font-size:11px;padding:3px 9px;border-radius:999px;white-space:nowrap}
.ok{background:rgba(16,185,129,.15);color:#6ee7b7}.bad{background:rgba(239,68,68,.15);color:#fca5a5}
.warn{background:rgba(245,158,11,.15);color:#fcd34d}.mute{background:rgba(120,120,128,.18);color:#c7c7cf}
.thumbs{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.thumbs img{width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid var(--b)}
.section{background:var(--s);border:1px solid var(--b);border-radius:16px;padding:18px;margin:14px 0}
.section h2{margin:0 0 12px;font-size:16px}
.kv{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;font-size:14px}
.kv .k{color:var(--m)}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:12px}
.photos a{display:block}.photos img{width:100%;border-radius:10px;border:1px solid var(--b)}
.photos .lbl{font-size:12px;color:var(--m);text-align:center;margin-top:4px}
.foot{color:#6b6b73;font-size:12px;padding:24px 20px;text-align:center}
.pill{display:inline-block;font-size:12px;color:var(--m);border:1px solid var(--b);border-radius:999px;padding:3px 10px}
`;

function head(title, builtAt, rel = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · LUXWELD Archive</title><link rel="stylesheet" href="${rel}style.css"></head><body>
<div class="top"><span class="logo">L</span><span class="brand">LUXWELD</span>
<span class="pill">Records Archive</span><small>Read-only backup · updated ${esc(builtAt)} UTC</small></div>`;
}
const foot = `<div class="foot">Standalone backup of warranty.luxweld.com.au — rebuilt automatically. Photos and info are self-contained in this archive.</div></body></html>`;

function photosBlock(serial, list) {
  if (!list?.length) return '';
  return `<div class="photos">${list.map((p) =>
    `<a href="../assets/${esc(serial)}/${esc(p.file)}" target="_blank"><img src="../assets/${esc(serial)}/${esc(p.file)}" alt="${esc(p.angle)}"><div class="lbl">${esc(p.angle)}</div></a>`
  ).join('')}</div>`;
}

function recordPage(info, builtAt) {
  const s = info.serial;
  const i = info.installation, pr = info.production, w = info.warranty;
  return head(s, builtAt, '../') + `<div class="wrap">
<a href="../index.html">← All records</a>
<div class="row" style="margin-top:10px"><h1 style="font-family:ui-monospace,monospace">${esc(s)}</h1>
<span class="badge ${badge(info.status)}">${esc(info.status)}</span></div>
<div class="section"><h2>Product</h2><div class="kv">
<div class="k">Tag</div><div>${esc(pr?.product_tag || info.product.tag || '—')}${info.product.custom_description ? ' (' + esc(info.product.custom_description) + ')' : ''}</div>
<div class="k">Warranty length</div><div>${esc(info.warranty_years)} years</div></div></div>
<div class="section"><h2>Production</h2>${pr ? `<div class="kv">
<div class="k">Production date</div><div>${esc(pr.production_date)}</div>
<div class="k">Registered by</div><div>${esc(pr.registered_by || '—')}</div>
<div class="k">Notes</div><div>${esc(pr.notes || '—')}</div></div>${photosBlock(s, pr.photos)}` : '<p class="meta">Not registered.</p>'}</div>
<div class="section"><h2>Installation</h2>${i ? `<div class="kv">
<div class="k">Installer</div><div>${esc(i.installer_name)}</div>
<div class="k">Company</div><div>${esc(i.installer_company)}</div>
<div class="k">Phone</div><div>${esc(i.installer_phone)}</div>
<div class="k">Email</div><div>${esc(i.installer_email)}</div>
<div class="k">Site</div><div>${esc(i.site_name)}</div>
<div class="k">Address</div><div>${esc(i.site_address)}</div>
<div class="k">Installation date</div><div>${esc(i.installation_date)}</div>
<div class="k">Submitted via</div><div>${esc(i.submitted_via)}</div>
<div class="k">Notes</div><div>${esc(i.notes || '—')}</div></div>${photosBlock(s, i.photos)}` : '<p class="meta">Not installed.</p>'}</div>
<div class="section"><h2>Warranty</h2>${w ? `<div class="kv">
<div class="k">Start</div><div>${esc(w.start_date)}</div>
<div class="k">End</div><div>${esc(w.end_date)}</div>
<div class="k">Length</div><div>${esc(w.length_years)} years</div>
<div class="k">Status</div><div>${esc(info.status)}</div></div>` : '<p class="meta">Not active.</p>'}</div>
</div>` + foot;
}

function indexPage(cards, count, builtAt) {
  return head('All records', builtAt) + `<div class="wrap">
<h1>Warranty Records Archive</h1>
<p class="sub">${count} record${count === 1 ? '' : 's'} · a complete, separate copy of every warranty, its photos and all details.</p>
<input class="search" id="q" placeholder="Search serial, installer, company, site, tag, status…" oninput="filter()">
<div class="grid" id="grid">${cards}</div></div>
<script>function filter(){var q=document.getElementById('q').value.toLowerCase();
document.querySelectorAll('#grid .card').forEach(function(c){c.style.display=c.dataset.k.indexOf(q)>-1?'':'none';});}</script>` + foot;
}

// Build the whole static site into `outDir`. Returns { records, photos }.
export function buildArchiveSite(outDir) {
  const builtAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(resolve(outDir, 'records'), { recursive: true });
  mkdirSync(resolve(outDir, 'assets'), { recursive: true });
  writeFileSync(resolve(outDir, 'style.css'), STYLE);

  const rows = listProducts({});
  let cards = '';
  let copied = 0;
  for (const r of rows) {
    const info = recordInfo(r.serial);
    if (!info) continue;
    const photos = [...(info.production?.photos || []), ...(info.installation?.photos || [])];
    if (photos.length) {
      mkdirSync(resolve(outDir, 'assets', r.serial), { recursive: true });
      for (const p of photos) {
        const src = resolve(UPLOAD_ROOT, r.serial, p.file);
        if (existsSync(src)) { copyFileSync(src, resolve(outDir, 'assets', r.serial, p.file)); copied++; }
      }
    }
    writeFileSync(resolve(outDir, 'records', `${r.serial}.html`), recordPage(info, builtAt));

    const tag = info.product.tag === 'Custom' ? (info.product.custom_description || 'Custom') : (info.product.tag || '—');
    const thumbs = photos.slice(0, 4).map((p) => `<img src="assets/${esc(r.serial)}/${esc(p.file)}" alt="">`).join('');
    const key = [r.serial, r.installer_name, r.installer_company, r.site_name, r.site_address, tag, r.status].filter(Boolean).join(' ').toLowerCase();
    cards += `<a class="card" href="records/${esc(r.serial)}.html" data-k="${esc(key)}">
<div class="row"><h3>${esc(r.serial)}</h3><span class="badge ${badge(r.status)}">${esc(r.status)}</span></div>
<div class="meta"><b>${esc(tag)}</b>${r.production_date ? ' · produced ' + esc(r.production_date) : ''}</div>
${r.installer_name ? `<div class="meta">Installer: <b>${esc(r.installer_name)}</b>${r.installer_company ? ' — ' + esc(r.installer_company) : ''}</div>
<div class="meta">Site: <b>${esc(r.site_name || '—')}</b>${r.installation_date ? ' · ' + esc(r.installation_date) : ''}</div>` : ''}
${r.warranty_end ? `<div class="meta">Warranty: ${esc(r.warranty_start)} → ${esc(r.warranty_end)}</div>` : ''}
${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}</a>`;
  }
  writeFileSync(resolve(outDir, 'index.html'), indexPage(cards, rows.length, builtAt));
  return { records: rows.length, photos: copied };
}
