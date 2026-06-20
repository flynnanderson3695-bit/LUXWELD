// Quick demo data: generates a few products so you can try the flows.
import { db } from './db.js';
import { customAlphabet } from 'nanoid';

const serialId = customAlphabet('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 8);
const tokenId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

const ins = db.prepare('INSERT INTO product (serial, public_token, warranty_years) VALUES (?,?,?)');
const created = [];
for (let i = 0; i < 5; i++) {
  const serial = `SKY-${serialId()}`;
  ins.run(serial, tokenId(), 10);
  created.push(serial);
}
console.log('Seeded products:', created.join(', '));
