/** Minimal PNG encoder for the dev scripts (8-bit RGBA, no filtering). */
import { deflateSync } from 'node:zlib';

/** Encodes RGBA pixels as a PNG, scaled up `scale` times with nearest-neighbour. */
export function png(w: number, h: number, rgba: Uint8Array, scale = 1): Buffer {
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
