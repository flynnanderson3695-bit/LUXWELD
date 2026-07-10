// Automatic backup to the admin's Google Drive — as a SEARCHABLE mirror.
// One-time: the admin clicks "Connect Google Drive" -> OAuth -> we store a
// refresh token. Then every warranty record is mirrored into Drive as its own
// folder, named with everything Jono would search for:
//   SKY-ABC12345 · Corrugated · produced 2026-05-01 · installed 2026-06-20 ·
//   John Smith (Roofco) · 12 Site St Somewhere
// Inside: all photos (readable names) + record.txt (Drive full-text-searches
// its contents) + info.json, plus a database snapshot at the top level. So the
// "UI" for the CEO is Drive's own search bar — serial, installer, date or site
// all find the folder with everything linked.
// Sync is incremental (per-record content hash in app_settings): unchanged
// records cost nothing; changed/new records are re-uploaded. Runs daily, on
// "Back up now", and is pushed per-record right after each registration/edit.
// Uses least-privilege `drive.file` scope (we only see files we created).
// Best-effort: failures are captured and reported, never crash the app.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { db, getSetting, setSetting } from '../db.js';
import { recordInfo, recordText } from './records.js';
import {
  DRIVE_CONFIGURED, DRIVE_CALLBACK_URL, DRIVE_FOLDER_NAME,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, UPLOAD_ROOT, DB_PATH,
} from './config.js';

const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic',
};

export function driveStatus() {
  const folderId = getSetting('drive_folder_id');
  return {
    configured: DRIVE_CONFIGURED,
    connected: Boolean(getSetting('drive_refresh_token')),
    email: getSetting('drive_email'),
    lastBackup: getSetting('drive_last_backup'),
    lastStatus: getSetting('drive_last_status'),
    folderId,
    // Direct link to the backup folder. Opens for whoever is signed into the
    // connected Google account (private to them — not a public share).
    folderUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : null,
  };
}

export function buildAuthUrl() {
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: DRIVE_CALLBACK_URL,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token every time
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

function decodeJwtEmail(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    return payload.email || null;
  } catch { return null; }
}

// Exchange the OAuth code for tokens and store the refresh token.
export async function connectWithCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: DRIVE_CALLBACK_URL, grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.refresh_token) {
    throw new Error(data.error_description || data.error || 'No refresh token returned (revoke access and reconnect).');
  }
  setSetting('drive_refresh_token', data.refresh_token);
  if (data.id_token) setSetting('drive_email', decodeJwtEmail(data.id_token) || '');
  // Wipe mirror state so the (possibly new) account gets a full fresh upload.
  db.prepare("DELETE FROM app_settings WHERE key LIKE 'drive_rec_%' OR key IN ('drive_folder_id','drive_db_file_id')").run();
}

async function accessToken() {
  const refresh = getSetting('drive_refresh_token');
  if (!refresh) throw new Error('Google Drive is not connected.');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Could not refresh Google token (reconnect Drive).');
  }
  return data.access_token;
}

// ---- Small Drive API helpers ----
async function createFolder(token, parentId, name) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(data.error?.message || 'Could not create a Drive folder.');
  return data.id;
}

async function uploadFile(token, folderId, name, buf, mime) {
  // 1) create the file metadata inside the folder
  const meta = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const metaData = await meta.json();
  if (!meta.ok || !metaData.id) throw new Error(metaData.error?.message || 'Could not create the Drive file.');
  // 2) upload the bytes
  const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${metaData.id}?uploadType=media`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': mime || 'application/octet-stream' },
    body: buf,
  });
  if (!up.ok) throw new Error((await up.json())?.error?.message || 'Could not upload to Drive.');
  return metaData.id;
}

async function fileAlive(token, id) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  return !(await res.json()).trashed;
}

// Trash (not hard-delete) so an accidental overwrite is recoverable for 30 days.
async function trashFile(token, id) {
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  } catch { /* best-effort */ }
}

async function ensureRootFolder(token) {
  const existing = getSetting('drive_folder_id');
  if (existing && await fileAlive(token, existing)) return existing;
  const id = await createFolder(token, null, DRIVE_FOLDER_NAME);
  setSetting('drive_folder_id', id);
  return id;
}

// ---- The searchable mirror ----
function clean(s) {
  // Strip path separators and control characters; keep hyphens, commas, etc.
  // (written without backslash escapes on purpose - see fix history)
  const BS = String.fromCharCode(92); // backslash
  let out = '';
  for (const ch of String(s ?? '')) {
    out += (ch === '/' || ch === BS || ch.charCodeAt(0) < 32) ? ' ' : ch;
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

// Folder name = everything Jono would type into Drive search.
export function recordFolderName(info) {
  const parts = [info.serial];
  const tag = info.product.tag === 'Custom'
    ? (info.product.custom_description || 'Custom')
    : info.product.tag;
  if (tag) parts.push(tag);
  if (info.production) parts.push(`produced ${info.production.production_date}`);
  if (info.installation) {
    const i = info.installation;
    parts.push(`installed ${i.installation_date}`);
    parts.push(`${i.installer_name} (${i.installer_company})`);
    parts.push(`${i.site_name} — ${i.site_address}`);
  }
  if (info.status === 'CANCELLED') parts.push('CANCELLED');
  let name = parts.map(clean).filter(Boolean).join(' · ');
  if (name.length > 220) name = `${name.slice(0, 219)}…`;
  return name;
}

// Content fingerprint — excludes generated_at (changes on every call).
export function recordFingerprint(info) {
  const { generated_at, ...rest } = info;
  return createHash('sha1').update(JSON.stringify(rest)).digest('hex');
}

// Mirror ONE record: skip if unchanged, else replace its Drive folder.
async function syncSerial(token, rootId, serial, { force = false } = {}) {
  const info = recordInfo(serial);
  if (!info) return { skipped: true };
  const hash = recordFingerprint(info);
  const key = `drive_rec_${serial}`;
  let state = null;
  try { state = JSON.parse(getSetting(key) || 'null'); } catch { /* re-upload */ }

  if (state?.hash === hash) {
    if (!force) return { uploaded: false };
    if (await fileAlive(token, state.folderId)) return { uploaded: false };
  }

  if (state?.folderId) await trashFile(token, state.folderId);
  const folderId = await createFolder(token, rootId, recordFolderName(info));
  await uploadFile(token, folderId, `${serial} — record.txt`, Buffer.from(recordText(info)), 'text/plain');
  await uploadFile(token, folderId, `${serial} — info.json`, Buffer.from(JSON.stringify(info, null, 2)), 'application/json');

  const photos = [
    ...(info.production?.photos || []).map((p) => ({ ...p, label: 'production' })),
    ...(info.installation?.photos || []).map((p) => ({ ...p, label: 'installed' })),
  ];
  for (const p of photos) {
    const local = resolve(UPLOAD_ROOT, serial, p.file);
    if (!existsSync(local)) continue;
    const ext = extname(p.file).toLowerCase();
    const name = `${serial} ${p.label} ${p.angle.toLowerCase()}${ext}`;
    await uploadFile(token, folderId, name, await readFile(local), MIME[ext]);
  }

  setSetting(key, JSON.stringify({ folderId, hash }));
  return { uploaded: true };
}

// Small, updated-in-place copy of the SQLite DB at the top of the Drive folder.
async function uploadDbSnapshot(token, rootId) {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); // fold WAL into the main file first
    const buf = await readFile(DB_PATH);
    const existing = getSetting('drive_db_file_id');
    if (existing) {
      const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body: buf,
      });
      if (up.ok) return;
    }
    const id = await uploadFile(token, rootId, 'LUXWELD database snapshot.db', buf, 'application/octet-stream');
    setSetting('drive_db_file_id', id);
  } catch (e) {
    console.warn('DB snapshot to Drive failed:', e.message);
  }
}

let syncing = false; // one full sync at a time (boot catch-up vs. button)

// Full incremental sync: every record + DB snapshot. `force` re-verifies that
// unchanged records still exist in Drive (used by "Back up now").
export async function backupToDrive({ force = false } = {}) {
  if (!DRIVE_CONFIGURED) return { ok: false, error: 'Google Drive is not set up (missing Google credentials).' };
  if (!getSetting('drive_refresh_token')) return { ok: false, error: 'Google Drive is not connected yet.' };
  if (syncing) return { ok: false, error: 'A backup is already running — try again in a minute.' };
  syncing = true;
  try {
    const token = await accessToken();
    const rootId = await ensureRootFolder(token);
    const serials = db.prepare('SELECT serial FROM product ORDER BY serial').all().map((r) => r.serial);
    let uploaded = 0;
    let failed = 0;
    for (const serial of serials) {
      try {
        if ((await syncSerial(token, rootId, serial, { force })).uploaded) uploaded++;
      } catch (e) {
        failed++;
        console.warn(`Drive mirror failed for ${serial}:`, e.message);
      }
    }
    await uploadDbSnapshot(token, rootId);
    setSetting('drive_last_backup', new Date().toISOString());
    const msg = `OK — ${serials.length} records checked, ${uploaded} uploaded${failed ? `, ${failed} FAILED` : ''}, DB snapshot saved`;
    setSetting('drive_last_status', msg);
    return { ok: failed === 0, checked: serials.length, uploaded, failed, error: failed ? `${failed} record(s) failed — see logs` : undefined };
  } catch (e) {
    setSetting('drive_last_status', `FAILED — ${e.message}`);
    console.warn('Drive backup failed:', e.message);
    return { ok: false, error: e.message };
  } finally {
    syncing = false;
  }
}

// Fire-and-forget push of one record right after a registration/edit, so the
// cloud copy is seconds behind, not a day. Never blocks or throws to a save.
export function mirrorSerialToDriveAsync(serial) {
  if (!DRIVE_CONFIGURED || !getSetting('drive_refresh_token')) return;
  setImmediate(async () => {
    try {
      const token = await accessToken();
      const rootId = await ensureRootFolder(token);
      await syncSerial(token, rootId, serial);
    } catch (e) {
      console.warn(`Drive push failed for ${serial} (daily sync will retry):`, e.message);
    }
  });
}

export function disconnectDrive() {
  db.prepare("DELETE FROM app_settings WHERE key LIKE 'drive_%'").run();
}
