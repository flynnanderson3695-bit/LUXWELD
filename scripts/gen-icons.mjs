// Generates LUXWELD PWA icons (black background, gold "L") as PNGs — no deps.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../public');
const INK = [11, 11, 13];
const GOLD = [220, 192, 106];

// --- minimal PNG encoder (RGBA, 8-bit) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression, filter, interlace = 0
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function makeIcon(size, { frame = true, scale = 1 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  };
  const fillRect = (x0, y0, x1, y1, color) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) put(x, y, color);
  };
  // background
  fillRect(0, 0, size, size, INK);
  // optional gold frame
  if (frame) {
    const inset = size * 0.09;
    const tk = Math.max(2, size * 0.02);
    fillRect(inset, inset, size - inset, inset + tk, GOLD);
    fillRect(inset, size - inset - tk, size - inset, size - inset, GOLD);
    fillRect(inset, inset, inset + tk, size - inset, GOLD);
    fillRect(size - inset - tk, inset, size - inset, size - inset, GOLD);
  }
  // gold "L" (centered), scaled smaller for maskable safe zone
  const cx = size / 2, cy = size / 2;
  const hgt = size * 0.46 * scale;
  const wdt = size * 0.30 * scale;
  const t = size * 0.12 * scale;
  const x0 = cx - wdt / 2;
  const y0 = cy - hgt / 2;
  fillRect(x0, y0, x0 + t, y0 + hgt, GOLD);            // vertical bar
  fillRect(x0, y0 + hgt - t, x0 + wdt, y0 + hgt, GOLD); // bottom bar
  return encodePng(size, size, buf);
}

const files = [
  ['icon-192.png', makeIcon(192, { frame: true })],
  ['icon-512.png', makeIcon(512, { frame: true })],
  ['icon-maskable-512.png', makeIcon(512, { frame: false, scale: 0.78 })],
  ['apple-touch-icon.png', makeIcon(180, { frame: true })],
];
for (const [name, data] of files) {
  writeFileSync(resolve(OUT, name), data);
  console.log('wrote', name, data.length, 'bytes');
}
