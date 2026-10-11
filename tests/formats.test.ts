import { describe, expect, it } from 'vitest';
import { BsaArchive } from '../src/formats/bsa';
import { decodeType04, decodeType08 } from '../src/formats/compression';
import { parseCol, indicesToRgba } from '../src/formats/palette';
import { crop, parseImg, parseRci, parseSet } from '../src/formats/img';
import { decryptInf, expandTextures, parseInf, roleTexture } from '../src/formats/inf';
import { parseMif } from '../src/formats/mif';
import { encodeLzhuf, encodeLzhufLiterals, encodeLzssLiterals, encryptInf, makeBsa, makeMif, u16 } from './helpers/encode';

describe('BSA', () => {
  it('reads names, sizes and contents', () => {
    const bsa = new BsaArchive(makeBsa({ 'A.IMG': new Uint8Array([1, 2, 3]), 'LONGNAME.SET': new Uint8Array([9]) }));
    expect(bsa.entries.map((e) => [e.name, e.size])).toEqual([
      ['A.IMG', 3],
      ['LONGNAME.SET', 1],
    ]);
    expect([...bsa.get('a.img')!]).toEqual([1, 2, 3]);
    expect([...bsa.get('LONGNAME.SET')!]).toEqual([9]);
    expect(bsa.get('MISSING')).toBeUndefined();
  });

  it('rejects an index that does not fit', () => {
    expect(() => new BsaArchive(new Uint8Array([200, 0, 1, 2]))).toThrow();
  });
});

describe('compression', () => {
  it('decodes LZSS literals', () => {
    const data = new Uint8Array([...Array(37).keys()]);
    expect([...decodeType04(encodeLzssLiterals(data), data.length)]).toEqual([...data]);
  });

  it('decodes LZSS back references', () => {
    // 'A','B' as literals, then copy 4 bytes starting at ring position 0xFEE.
    const src = new Uint8Array([0b011, 0x41, 0x42, 0xee, 0xf1]);
    expect(String.fromCharCode(...decodeType04(src, 6))).toBe('ABABAB');
  });

  it('decodes LZHUF literals', () => {
    const data = new Uint8Array(500).map((_, i) => (i * 37) & 0xff);
    expect([...decodeType08(encodeLzhufLiterals(data), data.length)]).toEqual([...data]);
  });

  it('decodes LZHUF back references', () => {
    const src = encodeLzhuf([{ literal: 0x41 }, { literal: 0x42 }, { literal: 0x43 }, { distance: 3, length: 9 }]);
    expect(String.fromCharCode(...decodeType08(src, 12))).toBe('ABCABCABCABC');
  });

  it('decodes long LZHUF streams that rebuild the Huffman tree', () => {
    const data = new Uint8Array(70000).map((_, i) => (i % 7 === 0 ? 0 : i & 0x0f));
    expect(decodeType08(encodeLzhufLiterals(data), data.length)).toEqual(data);
  });
});

describe('palette', () => {
  it('reads an 8-bit COL file', () => {
    const rgb = new Uint8Array(768).map((_, i) => i & 0xff);
    const col = new Uint8Array([8, 3, 0, 0, 0x23, 0xb1, 0, 0, ...rgb]);
    const pal = parseCol(col);
    expect([...pal.subarray(4, 8)]).toEqual([3, 4, 5, 255]);
  });

  it('scales 6-bit VGA palettes', () => {
    const rgb = new Uint8Array(768).fill(63);
    expect(parseCol(rgb)[0]).toBe(255);
  });

  it('maps indices to RGBA with optional transparency', () => {
    const pal = parseCol(new Uint8Array(768).fill(200));
    expect([...indicesToRgba(new Uint8Array([0, 1]), pal, true)]).toEqual([200, 200, 200, 0, 200, 200, 200, 255]);
  });
});

describe('IMG / SET / RCI', () => {
  const header = (w: number, h: number, flags: number, len: number) => [...u16(1), ...u16(2), ...u16(w), ...u16(h), ...u16(flags), ...u16(len)];

  it('reads an uncompressed IMG', () => {
    const img = parseImg(new Uint8Array([...header(2, 2, 0, 4), 1, 2, 3, 4]));
    expect(img).toMatchObject({ width: 2, height: 2, xOffset: 1, yOffset: 2 });
    expect([...img.pixels]).toEqual([1, 2, 3, 4]);
  });

  it('reads an LZSS IMG with its own palette', () => {
    const body = encodeLzssLiterals(new Uint8Array([5, 6, 7]));
    const img = parseImg(new Uint8Array([...header(3, 1, 0x104, body.length), ...body, ...new Uint8Array(768).fill(10)]));
    expect([...img.pixels]).toEqual([5, 6, 7]);
    expect(img.palette?.length).toBe(768);
  });

  it('reads an LZHUF IMG', () => {
    const body = [...u16(4), ...encodeLzhufLiterals(new Uint8Array([9, 8, 7, 6]))];
    const img = parseImg(new Uint8Array([...header(2, 2, 0x08, body.length), ...body]));
    expect([...img.pixels]).toEqual([9, 8, 7, 6]);
  });

  it('treats a 4096-byte file as a raw 64x64 tile', () => {
    const img = parseImg(new Uint8Array(4096).fill(3));
    expect(img).toMatchObject({ width: 64, height: 64 });
  });

  it('rejects implausible headers instead of allocating huge buffers', () => {
    expect(() => parseImg(new Uint8Array([...header(0xffff, 0xffff, 0, 4), 0, 0, 0, 0]))).toThrow();
  });

  it('splits SET files into frames', () => {
    const data = new Uint8Array(4096 * 3).map((_, i) => Math.floor(i / 4096));
    expect(parseSet(data).map((f) => f.pixels[0])).toEqual([0, 1, 2]);
    expect(() => parseSet(new Uint8Array(100))).toThrow();
  });

  it('splits RCI files and crops tiles', () => {
    const frames = parseRci(new Uint8Array(32000 * 2).map((_, i) => (i % 320) & 0xff));
    expect(frames).toHaveLength(2);
    const tile = crop(frames[0], 10, 36, 64, 64);
    expect(tile.pixels[0]).toBe(10);
    expect(tile.pixels[63]).toBe(73);
  });
});

describe('INF', () => {
  const text = [
    '@FLOORS',
    '*BOXCAP 0',
    'floora.set\t#2',
    'floorb.img',
    '',
    '@WALLS',
    '*DOOR 0',
    'door_1.img',
    '*BOXCAP 3',
    '*BOXSIDE 0',
    'walla.set\t#5',
    '*WETCHASM',
    'swater.img',
    '',
    '@FLATS NOSHOW',
    'barrel.img',
    'chains1.img\tY:-35',
    '*ITEM 32',
    'rat.dfa',
    '',
    '@SOUND',
    'drip1.voc 16',
    'closdoor.voc\t5',
    '',
    '@TEXT',
    '*TEXT 0',
    '+10',
    '*TEXT 1',
    '~You awaken.',
    'Second line.',
    '',
  ].join('\r\n');

  it('decrypts BSA copies and leaves plain text alone', () => {
    expect(String.fromCharCode(...decryptInf(encryptInf('@WALLS')))).toBe('@WALLS');
    expect(String.fromCharCode(...decryptInf(new Uint8Array([0x40, 0x41])))).toBe('@A');
  });

  it('parses textures, roles, flats and text', () => {
    const inf = parseInf(encryptInf(text));
    expect(expandTextures(inf.floors)).toEqual([
      { file: 'FLOORA.SET', frame: 0 },
      { file: 'FLOORA.SET', frame: 1 },
      { file: 'FLOORB.IMG', frame: 0 },
    ]);
    expect(expandTextures(inf.walls).map((t) => t.file)).toEqual([
      'DOOR_1.IMG',
      'WALLA.SET',
      'WALLA.SET',
      'WALLA.SET',
      'WALLA.SET',
      'WALLA.SET',
      'SWATER.IMG',
    ]);
    expect(roleTexture(inf, 'BOXSIDE', 0)?.index).toBe(1);
    expect(roleTexture(inf, 'BOXCAP', 0)?.texture.file).toBe('FLOORA.SET');
    expect(roleTexture(inf, 'WETCHASM')?.index).toBe(6);
    expect(inf.flats).toEqual([{ name: 'BARREL.IMG' }, { name: 'CHAINS1.IMG', yOffset: -35 }, { name: 'RAT.DFA', item: 32 }]);
    expect(inf.texts[0]).toBe('+10');
    expect(inf.texts[1]).toBe('~You awaken.\nSecond line.');
    expect(inf.sounds).toEqual({ 16: 'DRIP1.VOC', 5: 'CLOSDOOR.VOC' });
  });
});

describe('MIF', () => {
  it('reads the header, level chunks and compressed grids', () => {
    const map1 = new Array(12).fill(0x0101);
    map1[5] = 0;
    const mif = parseMif(
      makeMif({ width: 4, depth: 3, start: { x: 1.5, y: 1.5 }, info: 'start.inf', map1, flor: new Array(12).fill(0x0400), triggers: [[1, 1, 2, 255]] }),
    );
    expect(mif).toMatchObject({ width: 4, depth: 3, startPoints: [{ x: 1.5, y: 1.5 }] });
    expect(mif.levels).toHaveLength(1);
    const l = mif.levels[0];
    expect(l.info).toBe('START.INF');
    expect(l.map1[5]).toBe(0);
    expect(l.map1[0]).toBe(0x0101);
    expect(l.flor[11]).toBe(0x0400);
    expect(l.triggers).toEqual([{ x: 1, y: 1, textIndex: 2, soundIndex: 255 }]);
    expect(l.locks).toEqual([]);
  });

  it('reads locked doors', () => {
    const mif = parseMif(makeMif({ width: 2, depth: 1, map1: [0, 0], flor: [0, 0], locks: [[1, 0, 10], [0, 0, 3]] }));
    expect(mif.levels[0].locks).toEqual([{ x: 1, y: 0, level: 10 }, { x: 0, y: 0, level: 3 }]);
  });

  it('rejects files without a header', () => {
    expect(() => parseMif(new Uint8Array(20))).toThrow(/MHDR/);
  });
});
