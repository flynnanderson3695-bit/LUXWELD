// Automatic backup to the admin's Google Drive.
// One-time: the admin clicks "Connect Google Drive" -> OAuth -> we store a
// refresh token. Then, daily (and on demand), we build the archive, zip it, and
// upload it to a "LUXWELD Warranty Archive" folder in their Drive. Uses the
// least-privilege `drive.file` scope (we only ever see files we created).
// Best-effort: failures are captured and reported, never crash the app.
import { mkdtempSync, rmSync, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import archiver from 'archiver';
import { getSetting, setSetting, deleteSetting } from '../db.js';
import { buildArchiveSite } from './archive-site.js';
import {
  DRIVE_CONFIGURED, DRIVE_CALLBACK_URL, DRIVE_FOLDER_NAME,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
} from './config.js';

const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';

export function driveStatus() {
  return {
    configured: DRIVE_CONFIGURED,
    connected: Boolean(getSetting('drive_refresh_token')),
    email: getSetting('drive_email'),
    lastBackup: getSetting('drive_last_backup'),
    lastStatus: getSetting('drive_last_status'),
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
  deleteSetting('drive_folder_id'); // recreate folder for the (possibly new) account
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

async function ensureFolder(token) {
  const existing = getSetting('drive_folder_id');
  if (existing) {
    const check = await fetch(`https://www.googleapis.com/drive/v3/files/${existing}?fields=id,trashed`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (check.ok) { const d = await check.json(); if (!d.trashed) return existing; }
  }
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(data.error?.message || 'Could not create the Drive folder.');
  setSetting('drive_folder_id', data.id);
  return data.id;
}

async function uploadZip(token, folderId, name, buf) {
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
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
    body: buf,
  });
  if (!up.ok) throw new Error((await up.json())?.error?.message || 'Could not upload to Drive.');
  return metaData.id;
}

function zipDir(dir, zipPath) {
  return new Promise((res, rej) => {
    const out = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    out.on('close', res);
    archive.on('error', rej);
    archive.pipe(out);
    archive.directory(dir, false);
    archive.finalize();
  });
}

// Build the archive, zip it, and upload it to Drive. Best-effort.
export async function backupToDrive() {
  if (!DRIVE_CONFIGURED) return { ok: false, error: 'Google Drive is not set up (missing Google credentials).' };
  if (!getSetting('drive_refresh_token')) return { ok: false, error: 'Google Drive is not connected yet.' };

  let workdir;
  try {
    workdir = mkdtempSync(join(tmpdir(), 'lux-drive-'));
    const siteDir = resolve(workdir, 'site');
    const zipPath = resolve(workdir, 'archive.zip');
    buildArchiveSite(siteDir);
    await zipDir(siteDir, zipPath);
    const buf = await readFile(zipPath);

    const token = await accessToken();
    const folderId = await ensureFolder(token);
    const name = `luxweld-archive-${new Date().toISOString().slice(0, 10)}.zip`;
    await uploadZip(token, folderId, name, buf);

    const when = new Date().toISOString();
    setSetting('drive_last_backup', when);
    setSetting('drive_last_status', `OK — uploaded ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
    return { ok: true, name, bytes: buf.length };
  } catch (e) {
    setSetting('drive_last_status', `FAILED — ${e.message}`);
    console.warn('Drive backup failed:', e.message);
    return { ok: false, error: e.message };
  } finally {
    if (workdir) { try { rmSync(workdir, { recursive: true, force: true }); } catch {} }
  }
}

export function disconnectDrive() {
  ['drive_refresh_token', 'drive_email', 'drive_folder_id', 'drive_last_backup', 'drive_last_status']
    .forEach(deleteSetting);
}
