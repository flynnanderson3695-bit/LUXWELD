// Migration guard. Boots the REAL app db.js against a hand-built v4 database and
// asserts the full v4 -> v5 -> v6 chain leaves a correct, usable schema.
//
// This exists because two migration bugs shipped without smoke catching them:
// `npm run smoke` boots a FRESH DB (which gets the current schema directly), so it
// never exercises migrations. The v4->v5 users rename silently rewrote
// production_registration's foreign key to a dangling `users_old`, breaking every
// production registration on migrated (i.e. production) databases. These checks
// specifically cover child-table FK integrity after a migration.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'lux-migrate-'));
const dbPath = join(dir, 'app.db');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
};

// ---- Build a realistic v4 database (the shape production was on before v5) ----
{
  const v4 = new DatabaseSync(dbPath);
  v4.exec('PRAGMA journal_mode = WAL;');
  v4.exec(`
    CREATE TABLE product (
      id INTEGER PRIMARY KEY AUTOINCREMENT, serial TEXT NOT NULL UNIQUE,
      public_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'CREATED'
        CHECK (status IN ('CREATED','MANUFACTURED','INSTALLED','CANCELLED')),
      warranty_years INTEGER NOT NULL DEFAULT 10, cancelled_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT UNIQUE, email TEXT,
      role TEXT NOT NULL DEFAULT 'pending'
        CHECK (role IN ('admin','production','installer','pending')),
      password_hash TEXT, provider TEXT NOT NULL DEFAULT 'local', provider_id TEXT,
      phone TEXT, company TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_users_provider ON users(provider, provider_id) WHERE provider_id IS NOT NULL;
    CREATE INDEX idx_users_email ON users(lower(email));
    CREATE TABLE production_registration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE REFERENCES product(id) ON DELETE CASCADE,
      product_tag TEXT, custom_description TEXT, production_date TEXT NOT NULL,
      production_user_id INTEGER REFERENCES users(id),
      team_member_name TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  v4.prepare("INSERT INTO users (name, username, email, role, password_hash, provider) VALUES (?,?,?,?,?,?)")
    .run('Administrator', 'admin', 'jono@luxweld.com.au', 'admin', 'SCRYPT$deadbeef', 'local');
  v4.prepare("INSERT INTO users (name, email, role, provider, provider_id, phone, company) VALUES (?,?,?,?,?,?,?)")
    .run('Installer Ian', 'ian@roofs.example', 'installer', 'google', 'google-uid-123', '021555', 'RoofsCo');
  const pmid = v4.prepare("INSERT INTO users (name, username, email, role, password_hash, provider) VALUES (?,?,?,?,?,?)")
    .run('Prod Pat', 'pat', 'pat@luxweld.example', 'production', 'SCRYPT$pat', 'local').lastInsertRowid;
  // An existing MANUFACTURED unit with a production_registration referencing a real user.
  const prodId = v4.prepare("INSERT INTO product (serial, public_token, status) VALUES ('SKY-EXIST001','tok-exist','MANUFACTURED')").run().lastInsertRowid;
  v4.prepare(`INSERT INTO production_registration (product_id, product_tag, production_date, production_user_id, team_member_name)
              VALUES (?, 'Tile', '2026-07-01', ?, 'Prod Pat')`).run(prodId, pmid);
  v4.exec('PRAGMA user_version = 4;');
  v4.close();
}

// ---- Run the real app migrations (v4 -> v5 -> v6) ----
process.env.NODE_ENV = 'development';
process.env.DB_PATH = dbPath;
process.env.ADMIN_PASSWORD = 'unused-table-not-empty';
const { db } = await import(pathToFileURL(join(process.cwd(), 'src', 'db.js')).href);

// ---- Schema-level assertions ----
ok('schema stamped v6', db.prepare('PRAGMA user_version').get().user_version === 6);

const usersOldRefs = db.prepare(
  "SELECT name FROM sqlite_master WHERE sql LIKE '%users_old%' OR name LIKE '%users_old%'"
).all();
ok('NO object references the dangling users_old', usersOldRefs.length === 0,
  usersOldRefs.map((r) => r.name).join(','));

const prDdl = db.prepare("SELECT sql FROM sqlite_master WHERE name='production_registration'").get().sql;
ok('production_registration FK points at users(id)',
  /REFERENCES\s+users\b/i.test(prDdl) && !/users_old/i.test(prDdl));

// ---- Data preservation ----
const admin = db.prepare("SELECT * FROM users WHERE email='jono@luxweld.com.au'").get();
ok('admin preserved with password_hash', admin && admin.password_hash === 'SCRYPT$deadbeef' && admin.id === 1);
const ian = db.prepare("SELECT * FROM users WHERE email='ian@roofs.example'").get();
ok('oauth user columns preserved', ian && ian.provider_id === 'google-uid-123' && ian.phone === '021555' && ian.company === 'RoofsCo');
const existing = db.prepare("SELECT * FROM production_registration WHERE product_id = (SELECT id FROM product WHERE serial='SKY-EXIST001')").get();
ok('existing production_registration row preserved (incl. production_user_id)',
  existing && existing.product_tag === 'Tile' && existing.production_user_id != null && existing.team_member_name === 'Prod Pat');

// ---- The regression this whole file exists for: a real production registration ----
// Exactly what production.js does — non-null production_user_id, foreign_keys ON.
db.exec("INSERT INTO product (serial, public_token, status) VALUES ('SKY-NEW00001','tok-new','MANUFACTURED');");
const newProdId = db.prepare("SELECT id FROM product WHERE serial='SKY-NEW00001'").get().id;
let regOk = false, regErr = '';
try {
  db.prepare(`INSERT INTO production_registration (product_id, product_tag, production_date, production_user_id, team_member_name)
              VALUES (?, 'M25', '2026-07-14', 3, 'Prod Pat')`).run(newProdId);
  regOk = true;
} catch (e) { regErr = e.message; }
ok('a NEW production registration succeeds (FK no longer dangling)', regOk, regErr);

// ---- v5 change still intact: genius role accepted ----
let geniusOk = false;
try { db.prepare("UPDATE users SET role='genius' WHERE id=1").run(); geniusOk = true; } catch { geniusOk = false; }
ok('genius role still accepted (v5 CHECK widening intact)', geniusOk);

// ---- Indexes intact ----
const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'").all().map((r) => r.name);
ok('unique OAuth index present', idx.includes('idx_users_provider'), idx.join(','));

console.log(`\nMigration test: ${pass} passed, ${fail} failed`);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
