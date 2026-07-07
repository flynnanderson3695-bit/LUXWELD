// Centralised runtime configuration (env-driven, deployment-friendly).
// Dependency-free so any module can import it without cycles.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url)); // src/lib
const projectRoot = resolve(__dirname, '../..');

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PROD = NODE_ENV === 'production';

export const PORT = process.env.PORT || 3000;

// Public origin used to build QR links. Empty = derive from the request host.
export const BASE_URL = process.env.BASE_URL || '';

// Cookie signing secret. SESSION_SECRET is preferred; COOKIE_SECRET kept for
// backward compatibility with existing deployments.
export const SESSION_SECRET =
  process.env.SESSION_SECRET || process.env.COOKIE_SECRET || 'dev-insecure-secret-change-me';

// SQLite file path. DATABASE_URL accepted as an alias (treated as a file path
// for this SQLite-backed MVP); DB_PATH also supported.
export const DB_PATH =
  process.env.DATABASE_URL || process.env.DB_PATH || resolve(projectRoot, 'data/app.db');

// Where uploaded photos are stored. Must be a persistent volume in production.
export const UPLOAD_ROOT =
  process.env.UPLOAD_DIR || process.env.UPLOAD_ROOT || resolve(projectRoot, 'data/uploads');

// Cookie options, hardened automatically in production (HTTPS-only).
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 1000 * 60 * 60 * 12, // 12h
  };
}

// ---- Cloud archive (Cloudflare R2 / any S3-compatible object storage) ----
// Photos + a per-warranty info.json are mirrored here as a durable, versioned
// second copy. Cloudflare R2 endpoint looks like:
//   https://<accountid>.r2.cloudflarestorage.com
// Generic S3 works too via S3_ENDPOINT (omit for real AWS S3 + S3_REGION).
export const CLOUD_ENDPOINT = process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || '';
export const CLOUD_BUCKET = process.env.R2_BUCKET || process.env.S3_BUCKET || '';
export const CLOUD_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '';
export const CLOUD_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '';
export const CLOUD_REGION = process.env.S3_REGION || 'auto';
export const CLOUD_PREFIX = process.env.CLOUD_PREFIX || 'warranties';
// R2 requires an endpoint; AWS S3 requires a region + bucket (no endpoint).
export const CLOUD_ENABLED = Boolean(
  CLOUD_BUCKET && CLOUD_ACCESS_KEY_ID && CLOUD_SECRET_ACCESS_KEY && (CLOUD_ENDPOINT || process.env.S3_REGION)
);

// ---- Admin bootstrap (first-run seeding only) ----
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@luxweld.local').toLowerCase();
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PROD ? '' : 'admin123');

// ---- Role allowlists (comma-separated emails) ----
// Emails here are auto-assigned on first OAuth/local sign-in. Roles are still
// stored in (and can be overridden from) the database — the provider is never
// trusted for role on its own.
function emailList(v) {
  return (v || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
export const ADMIN_EMAILS = emailList(process.env.ADMIN_EMAILS);
export const PRODUCTION_EMAILS = emailList(process.env.PRODUCTION_EMAILS);

// ---- Google OAuth ----
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
export const GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL || (BASE_URL ? `${BASE_URL}/auth/google/callback` : '');
export const GOOGLE_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

// ---- Apple OAuth (Sign in with Apple) ----
export const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || ''; // Services ID
export const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || '';
export const APPLE_KEY_ID = process.env.APPLE_KEY_ID || '';
// Private key: accept inline PEM (with \n) or a file path.
export const APPLE_PRIVATE_KEY = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
export const APPLE_CALLBACK_URL =
  process.env.APPLE_CALLBACK_URL || (BASE_URL ? `${BASE_URL}/auth/apple/callback` : '');
export const APPLE_ENABLED = Boolean(
  APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY
);
