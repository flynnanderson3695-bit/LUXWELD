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
