import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword } from './lib/password.js';
import { DB_PATH } from './lib/config.js';

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

const SCHEMA_VERSION = 3;

function tableExists(name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
  );
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
  `);
}

function createUsersTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin','production')),
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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

function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const ins = db.prepare(
    'INSERT INTO users (name, username, email, role, password_hash) VALUES (?,?,?,?,?)'
  );
  const adminPw = process.env.ADMIN_PASSWORD || 'admin123';
  const prodPw = process.env.SEED_PRODUCTION_PASSWORD; // optional override
  const seed = [
    ['Administrator', 'admin', 'admin@luxweld.example', 'admin', adminPw],
    ['Mike Tanner', 'mike', 'mike@luxweld.example', 'production', prodPw || 'mike123'],
    ['Sara Lee', 'sara', 'sara@luxweld.example', 'production', prodPw || 'sara123'],
  ];
  for (const [name, username, email, role, pw] of seed) {
    ins.run(name, username, email, role, hashPassword(pw));
  }
  const adminNote = process.env.ADMIN_PASSWORD ? 'from ADMIN_PASSWORD' : 'default "admin123"';
  const prodNote = prodPw ? 'from SEED_PRODUCTION_PASSWORD' : 'defaults mike123 / sara123';
  console.log(
    `Seeded users: admin (${adminNote}); production mike, sara (${prodNote}). ` +
    'Change all passwords in Admin → Users after first login.'
  );
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
    console.log('Migration complete. Existing records preserved.');
  }
}

seedUsers();
