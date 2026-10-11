/**
 * CIF reader: several IMG images back to back, each with its own 12-byte
 * IMG header (see img.ts). Arena keeps first-person weapon swings, faces
 * and cursors this way. For weapons the header's x and y place the image on
 * the 320x147 game view above the interface bar.
 */
import { parseImg, type IndexedImage } from './img';

export function parseCif(data: Uint8Array): IndexedImage[] {
  const images: IndexedImage[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;
  while (o + 12 <= data.length) {
    const flags = view.getUint16(o + 8, true);
    const size = 12 + view.getUint16(o + 10, true) + (flags & 0x0100 ? 768 : 0);
    if (o + size > data.length) throw new Error('CIF: image runs past end of file');
    images.push(parseImg(data.subarray(o, o + size)));
    o += size;
  }
  return images;
}
