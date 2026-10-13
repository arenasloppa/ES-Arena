/**
 * Dev helper: renders textures from a local Arena folder to PNG so decoders
 * can be checked by eye. Output goes wherever you point it; never commit it.
 *
 *   npx tsx scripts/inspect.ts <arena folder> <out dir> NAME.IMG NAME.SET ...
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BsaArchive } from '../src/formats/bsa';
import { parseCol, indicesToRgba } from '../src/formats/palette';
import { parseImg, parseRci, parseSet, type IndexedImage } from '../src/formats/img';
import { png } from './png';

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
