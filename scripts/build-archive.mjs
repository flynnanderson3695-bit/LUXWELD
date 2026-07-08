// CLI wrapper: build the standalone LUXWELD archive site.
//   node scripts/build-archive.mjs            -> data/archive-site/
//   ARCHIVE_OUT=/some/dir node scripts/build-archive.mjs
import { resolve } from 'node:path';
import { buildArchiveSite } from '../src/lib/archive-site.js';

const OUT = process.env.ARCHIVE_OUT || resolve(import.meta.dirname, '../data/archive-site');
const r = buildArchiveSite(OUT);
console.log(`Archive site built: ${OUT}\n  ${r.records} records, ${r.photos} photos copied.`);
