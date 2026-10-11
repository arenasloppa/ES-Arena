/**
 * Dev helper: renders textures from a local Arena folder to PNG so decoders
 * can be checked by eye. Output goes wherever you point it; never commit it.
 *
 *   npx tsx scripts/inspect.ts <arena folder> <out dir> NAME.IMG NAME.SET ...
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { BsaArchive } from '../src/formats/bsa';
import { parseCol, indicesToRgba } from '../src/formats/palette';
import { parseImg, parseRci, parseSet, type IndexedImage } from '../src/formats/img';

const [dir, out, ...names] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const bsa = new BsaArchive(new Uint8Array(readFileSync(join(dir, 'GLOBAL.BSA'))));
const pal = parseCol(new Uint8Array(readFileSync(join(dir, 'PAL.COL'))));
const read = (n: string) => (existsSync(join(dir, n)) ? new Uint8Array(readFileSync(join(dir, n))) : bsa.get(n));

for (const name of names) {
  const data = read(name);
  if (!data) { console.log(name, 'missing'); continue; }
  const imgs: IndexedImage[] = name.endsWith('.SET') ? parseSet(data) : name.endsWith('.RCI') ? parseRci(data) : [parseImg(data)];
  imgs.forEach((img, i) => {
    const p = img.palette ? parseCol(img.palette) : pal;
    writeFileSync(join(out, `${name}.${i}.png`), png(img.width, img.height, indicesToRgba(img.pixels, p, true), 4));
    console.log(name, i, `${img.width}x${img.height}`);
  });
}

function png(w: number, h: number, rgba: Uint8Array, scale: number): Buffer {
  const W = w * scale, H = h * scale;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = ((Math.floor(y / scale) * w) + Math.floor(x / scale)) * 4;
    rgba.subarray(s, s + 4).forEach((v, k) => (raw[y * (W * 4 + 1) + 1 + x * 4 + k] = v));
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(b: Buffer): number {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
