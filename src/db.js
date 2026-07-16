import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword } from './lib/password.js';
import { DB_PATH, ADMIN_EMAIL, ADMIN_PASSWORD, IS_PROD, RESET_ADMIN_PASSWORD } from './lib/config.js';

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// node:sqlite has no .transaction() helper (unlike better-sqlite3),
// so wrap a function in BEGIN/COMMIT with ROLLBACK on error.
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const SCHEMA_VERSION = 6;

// Small key/value store (Drive connection tokens, etc.). Created via
// CREATE TABLE IF NOT EXISTS so it needs no schema-version bump.
export function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
}
export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
export function deleteSetting(key) {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

function tableExists(name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
  );
}

function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}

// ---- Tables that never changed shape ----
function createBaseTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial TEXT NOT NULL UNIQUE,
      public_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'CREATED'
        CHECK (status IN ('CREATED','MANUFACTURED','INSTALLED','CANCELLED')),
      warranty_years INTEGER NOT NULL DEFAULT 10,
      cancelled_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS installation_registration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE REFERENCES product(id) ON DELETE CASCADE,
      installer_name TEXT NOT NULL,
      installer_company TEXT NOT NULL,
      installer_phone TEXT NOT NULL,
      installer_email TEXT NOT NULL,
      site_name TEXT NOT NULL,
      site_address TEXT NOT NULL,
      installation_date TEXT NOT NULL,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'web',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS warranty (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE REFERENCES product(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      length_years INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_product_status ON product(status);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function createUsersTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'pending'
        CHECK (role IN ('genius','admin','production','installer','pending')),
      password_hash TEXT,
      provider TEXT NOT NULL DEFAULT 'local',
      provider_id TEXT,
      phone TEXT,
      company TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider
      ON users(provider, provider_id) WHERE provider_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(lower(email));
  `);
}

// Current-shape production_registration + photo (used for a fresh DB).
function createCurrentProductionAndPhoto() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_registration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE REFERENCES product(id) ON DELETE CASCADE,
      product_tag TEXT,
      custom_description TEXT,
      production_date TEXT NOT NULL,
      production_user_id INTEGER REFERENCES users(id),
      team_member_name TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS photo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('PRODUCTION','INSTALLATION')),
      angle TEXT NOT NULL CHECK (angle IN ('FRONT','BACK','LEFT','RIGHT')),
      file_path TEXT NOT NULL,
      original_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (product_id, kind, angle)
    );
  `);
}

// Transform an old (v0/v1) DB to the current shape, preserving data.
function migrateLegacyToV2() {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    createUsersTable();

    // --- production_registration: drop model/size/batch_number, add tag/custom/user ---
    db.exec('ALTER TABLE production_registration RENAME TO production_registration_old;');
    db.exec(`
      CREATE TABLE production_registration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL UNIQUE REFERENCES product(id) ON DELETE CASCADE,
        product_tag TEXT,
        custom_description TEXT,
        production_date TEXT NOT NULL,
        production_user_id INTEGER REFERENCES users(id),
        team_member_name TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Preserve old free-text "model" as a Custom description so nothing is lost.
    db.exec(`
      INSERT INTO production_registration
        (id, product_id, product_tag, custom_description, production_date,
         production_user_id, team_member_name, notes, created_at)
      SELECT id, product_id, 'Custom', model, production_date,
             NULL, team_member_name, notes, created_at
      FROM production_registration_old;
    `);
    db.exec('DROP TABLE production_registration_old;');

    // --- photo: re-key from installation_id to product_id + kind ---
    db.exec('ALTER TABLE photo RENAME TO photo_old;');
    db.exec(`
      CREATE TABLE photo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('PRODUCTION','INSTALLATION')),
        angle TEXT NOT NULL CHECK (angle IN ('FRONT','BACK','LEFT','RIGHT')),
        file_path TEXT NOT NULL,
        original_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (product_id, kind, angle)
      );
    `);
    // All existing photos were installation photos.
    db.exec(`
      INSERT INTO photo (product_id, kind, angle, file_path, original_name, created_at)
      SELECT ir.product_id, 'INSTALLATION', po.angle, po.file_path, po.original_name, po.created_at
      FROM photo_old po
      JOIN installation_registration ir ON ir.id = po.installation_id;
    `);
    db.exec('DROP TABLE photo_old;');

    db.exec('PRAGMA user_version = 2;');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

// v2 -> v3: track how the installation was submitted (web/pwa/android/ios).
function migrateV2toV3() {
  db.exec('BEGIN');
  try {
    db.exec("ALTER TABLE installation_registration ADD COLUMN source TEXT NOT NULL DEFAULT 'web';");
    db.exec('PRAGMA user_version = 3;');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// v3 -> v4: real-auth user model. Widen roles to admin/production/installer/
// pending, allow OAuth users (nullable password, provider + provider_id),
// add installer profile fields. Existing users become provider='local'.
function migrateV3toV4() {
  // If the users table already has the new shape (e.g. created fresh by a
  // legacy migration), just stamp the version.
  if (columnExists('users', 'provider')) {
    db.exec('PRAGMA user_version = 4;');
    return;
  }
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE users RENAME TO users_old;');
    createUsersTable();
    db.exec(`
      INSERT INTO users (id, name, username, email, role, password_hash, provider, active, created_at)
      SELECT id, name, username, email, role, password_hash, 'local', active, created_at
      FROM users_old;
    `);
    db.exec('DROP TABLE users_old;');
    db.exec('PRAGMA user_version = 4;');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

// ⚠️ SQLite gotcha (learned the hard way — see migrateV5toV6): `ALTER TABLE users
// RENAME TO users_old` does NOT just rename the table. With legacy_alter_table off
// (the default), SQLite also REWRITES foreign keys in *other* tables to follow the
// rename — so `production_registration.production_user_id REFERENCES users(id)`
// silently became `REFERENCES users_old(id)`, then dangled when users_old was
// dropped. Never rename a table that has FK children pointing at it; recreate the
// CHILD table instead (nothing references it, so no rewrite cascade).
//
// v4 -> v5: widen the users.role CHECK constraint to include 'genius' (the owner's
// top-tier role). SQLite can't ALTER a CHECK, so recreate the table. All columns
// AND rows (including the seeded admin, with its password_hash) are preserved.
function migrateV4toV5() {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE users RENAME TO users_old;');
    // Named indexes follow the table on rename; drop them so createUsersTable()
    // can recreate them on the new table instead of silently skipping (IF NOT EXISTS).
    db.exec('DROP INDEX IF EXISTS idx_users_provider;');
    db.exec('DROP INDEX IF EXISTS idx_users_email;');
    createUsersTable();
    db.exec(`
      INSERT INTO users
        (id, name, username, email, role, password_hash, provider, provider_id, phone, company, active, created_at)
      SELECT
        id, name, username, email, role, password_hash, provider, provider_id, phone, company, active, created_at
      FROM users_old;
    `);
    db.exec('DROP TABLE users_old;');
    db.exec('PRAGMA user_version = 5;');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

// v5 -> v6: repair the damage migrateV4toV5 did. The users rename left
// production_registration.production_user_id pointing at a non-existent `users_old`,
// which made EVERY production registration fail (production.js writes a non-null
// production_user_id, and foreign_keys is ON). Fix it by recreating the CHILD table
// with the correct REFERENCES users(id) — renaming the child, not users, so nothing
// gets rewritten. All existing rows are preserved. Idempotent given user_version.
function migrateV5toV6() {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE production_registration RENAME TO production_registration_fkfix;');
    db.exec(`
      CREATE TABLE production_registration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL UNIQUE REFERENCES product(id) ON DELETE CASCADE,
        product_tag TEXT,
        custom_description TEXT,
        production_date TEXT NOT NULL,
        production_user_id INTEGER REFERENCES users(id),
        team_member_name TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO production_registration
        (id, product_id, product_tag, custom_description, production_date,
         production_user_id, team_member_name, notes, created_at)
      SELECT
        id, product_id, product_tag, custom_description, production_date,
        production_user_id, team_member_name, notes, created_at
      FROM production_registration_fkfix;
    `);
    db.exec('DROP TABLE production_registration_fkfix;');
    db.exec('PRAGMA user_version = 6;');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;

  const insLocal = db.prepare(
    'INSERT INTO users (name, username, email, role, password_hash, provider) VALUES (?,?,?,?,?,?)'
  );

  // Admin recovery account (email + password). In production this REQUIRES
  // ADMIN_PASSWORD — no default password is ever seeded in production.
  if (ADMIN_PASSWORD) {
    insLocal.run('Administrator', 'admin', ADMIN_EMAIL, 'admin', hashPassword(ADMIN_PASSWORD), 'local');
    console.log(`Seeded admin account: ${ADMIN_EMAIL} (password from ${process.env.ADMIN_PASSWORD ? 'ADMIN_PASSWORD' : 'dev default'}).`);
  } else {
    console.warn(
      '!! No ADMIN_PASSWORD set in production — no admin account seeded.\n' +
      '!! Set ADMIN_PASSWORD (and optionally ADMIN_EMAIL) and restart, then sign in to manage users.'
    );
  }

  // Demo production users for LOCAL testing only — never in production.
  if (!IS_PROD) {
    insLocal.run('Mike Tanner', 'mike', 'mike@luxweld.local', 'production', hashPassword('mike123'), 'local');
    insLocal.run('Sara Lee', 'sara', 'sara@luxweld.local', 'production', hashPassword('sara123'), 'local');
    console.log('Seeded dev production users: mike/mike123, sara/sara123 (development only).');
  }
}

// Lock-out escape hatch. When RESET_ADMIN_PASSWORD is set, force the ADMIN_EMAIL
// account's password (and admin role / active flag) to ADMIN_PASSWORD, creating
// the account if it doesn't exist. Unlike seedUsers() this runs even when users
// already exist, so it's the recovery path for a locked-out admin. It is
// idempotent; unset the env var afterwards so it can't silently re-fire.
function applyAdminReset() {
  if (!RESET_ADMIN_PASSWORD) return;
  if (!ADMIN_PASSWORD) {
    console.warn(
      '!! RESET_ADMIN_PASSWORD is set but ADMIN_PASSWORD is empty — nothing to do.\n' +
      '!! Set ADMIN_PASSWORD to the desired password and redeploy.'
    );
    return;
  }
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(ADMIN_EMAIL);
  if (existing) {
    db.prepare(
      "UPDATE users SET password_hash = ?, role = 'admin', active = 1 WHERE id = ?"
    ).run(hashPassword(ADMIN_PASSWORD), existing.id);
    console.log(
      `RESET_ADMIN_PASSWORD: reset password + admin role for ${ADMIN_EMAIL}. ` +
      'Log in, then UNSET RESET_ADMIN_PASSWORD in the environment.'
    );
  } else {
    // Avoid colliding with an existing username='admin' (UNIQUE).
    const usernameTaken = db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get();
    db.prepare(
      'INSERT INTO users (name, username, email, role, password_hash, provider) VALUES (?,?,?,?,?,?)'
    ).run('Administrator', usernameTaken ? null : 'admin', ADMIN_EMAIL, 'admin', hashPassword(ADMIN_PASSWORD), 'local');
    console.log(
      `RESET_ADMIN_PASSWORD: created admin account ${ADMIN_EMAIL}. ` +
      'Log in, then UNSET RESET_ADMIN_PASSWORD in the environment.'
    );
  }
}

// ---- Boot: create or migrate, then seed users ----
const freshDb = !tableExists('product');
createBaseTables();

if (freshDb) {
  createUsersTable();
  createCurrentProductionAndPhoto();
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
} else {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < SCHEMA_VERSION) {
    console.log(`Migrating database from v${version} to v${SCHEMA_VERSION}…`);
    if (version < 2) { migrateLegacyToV2(); version = 2; }
    if (version < 3) { migrateV2toV3(); version = 3; }
    if (version < 4) { migrateV3toV4(); version = 4; }
    if (version < 5) { migrateV4toV5(); version = 5; }
    if (version < 6) { migrateV5toV6(); version = 6; }
    console.log('Migration complete. Existing records preserved.');
  }
}

seedUsers();
applyAdminReset();
