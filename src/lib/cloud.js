// Durable cloud mirror (Cloudflare R2 / any S3-compatible bucket).
// Every warranty becomes a self-describing "folder" in the bucket:
//   warranties/<serial>/info.json
//   warranties/<serial>/record.txt
//   warranties/<serial>/prod-front.jpg ... inst-right.jpg
// plus periodic DB snapshots under backups/. All calls are BEST-EFFORT: a cloud
// failure is logged and swallowed so it can never block a registration.
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { db } from '../db.js';
import { recordInfo, recordText, writeLocalInfo } from './records.js';
import {
  CLOUD_ENABLED, CLOUD_ENDPOINT, CLOUD_BUCKET, CLOUD_ACCESS_KEY_ID,
  CLOUD_SECRET_ACCESS_KEY, CLOUD_REGION, CLOUD_PREFIX, UPLOAD_ROOT, DB_PATH,
} from './config.js';

export const cloudEnabled = CLOUD_ENABLED;

let _client = null;
async function client() {
  if (_client) return _client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  _client = new S3Client({
    region: CLOUD_REGION,
    ...(CLOUD_ENDPOINT ? { endpoint: CLOUD_ENDPOINT, forcePathStyle: true } : {}),
    credentials: { accessKeyId: CLOUD_ACCESS_KEY_ID, secretAccessKey: CLOUD_SECRET_ACCESS_KEY },
  });
  return _client;
}

function contentType(file) {
  const e = extname(file).toLowerCase();
  return e === '.png' ? 'image/png'
    : e === '.jpg' || e === '.jpeg' ? 'image/jpeg'
    : e === '.webp' ? 'image/webp'
    : e === '.json' ? 'application/json'
    : e === '.db' ? 'application/octet-stream'
    : 'text/plain';
}

async function put(key, body, type) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const c = await client();
  await c.send(new PutObjectCommand({ Bucket: CLOUD_BUCKET, Key: key, Body: body, ContentType: type }));
}

// Mirror one warranty (info + all its photos) to the bucket. Best-effort.
export async function mirrorSerial(serial) {
  if (!CLOUD_ENABLED) return { ok: false, skipped: true };
  try {
    const info = recordInfo(serial);
    if (!info) return { ok: false };
    const base = `${CLOUD_PREFIX}/${serial}`;
    await put(`${base}/info.json`, JSON.stringify(info, null, 2), 'application/json');
    await put(`${base}/record.txt`, recordText(info), 'text/plain');

    const photos = [...(info.production?.photos || []), ...(info.installation?.photos || [])];
    let count = 0;
    for (const p of photos) {
      try {
        const buf = await readFile(resolve(UPLOAD_ROOT, serial, p.file));
        await put(`${base}/${p.file}`, buf, contentType(p.file));
        count++;
      } catch (e) {
        console.warn(`cloud: photo ${serial}/${p.file} failed:`, e.message);
      }
    }
    return { ok: true, photos: count };
  } catch (e) {
    console.warn(`cloud: mirrorSerial(${serial}) failed:`, e.message);
    return { ok: false, error: e.message };
  }
}

// Upload a consistent snapshot of the SQLite DB. Best-effort.
export async function backupDatabase() {
  if (!CLOUD_ENABLED) return { ok: false, skipped: true };
  try {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
    const buf = await readFile(DB_PATH);
    const key = `backups/app-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    await put(key, buf, 'application/octet-stream');
    return { ok: true, key, bytes: buf.length };
  } catch (e) {
    console.warn('cloud: backupDatabase failed:', e.message);
    return { ok: false, error: e.message };
  }
}

// Backfill: mirror every serial + take a DB backup. Returns a summary.
export async function syncAll() {
  if (!CLOUD_ENABLED) return { ok: false, skipped: true };
  const serials = db.prepare('SELECT serial FROM product ORDER BY id').all().map((r) => r.serial);
  let mirrored = 0, photos = 0;
  for (const s of serials) {
    writeLocalInfo(s); // also make the local volume folder self-describing
    const r = await mirrorSerial(s);
    if (r.ok) { mirrored++; photos += r.photos || 0; }
  }
  const backup = await backupDatabase();
  return { ok: true, serials: serials.length, mirrored, photos, backup };
}

// Fire-and-forget mirror used from registration/edit handlers.
export function mirrorSerialAsync(serial) {
  if (!CLOUD_ENABLED) return;
  mirrorSerial(serial).catch((e) => console.warn('cloud: async mirror failed:', e.message));
}
