/**
 * Test-only encoders that build synthetic Arena files, so the parsers can be
 * tested without any of Bethesda's data.
 */
import type { ArmourTables, HitTables } from '../../src/formats/armour';
import { D_CODE, D_LEN, HuffTree, LZHUF } from '../../src/formats/compression';

class BitWriter {
  private bytes: number[] = [];
  private buf = 0;
  private len = 0;
  /** Writes the top `n` bits of a 16-bit code, MSB first. */
  put(n: number, code: number) {
    for (let i = 0; i < n; i++) {
      this.buf = (this.buf << 1) | ((code >> (15 - i)) & 1);
      if (++this.len === 8) {
        this.bytes.push(this.buf);
        this.buf = 0;
        this.len = 0;
      }
    }
  }
  finish(): Uint8Array {
    if (this.len) this.bytes.push(this.buf << (8 - this.len));
    return new Uint8Array(this.bytes);
  }
}

export type LzhufToken = { literal: number } | { distance: number; length: number };

/** Encodes an explicit token list with LZHUF (Arena "type 08"). */
export function encodeLzhuf(tokens: LzhufToken[]): Uint8Array {
  const { T, R, THRESHOLD } = LZHUF;
  const tree = new HuffTree();
  const w = new BitWriter();
  const encodeChar = (c: number) => {
    let code = 0;
    let len = 0;
    let k = tree.prnt[c + T];
    do {
      code >>= 1;
      if (k & 1) code |= 0x8000;
      len++;
      k = tree.prnt[k];
    } while (k !== R);
    w.put(len, code);
    tree.update(c);
  };
  const encodePosition = (p: number) => {
    const upper = p >> 6;
    const first = D_CODE.indexOf(upper);
    const bits = D_LEN[first];
    w.put(bits, (first >> (8 - bits)) << (16 - bits));
    w.put(6, (p & 0x3f) << 10);
  };
  for (const t of tokens) {
    if ('literal' in t) encodeChar(t.literal);
    else {
      encodeChar(t.length + 255 - THRESHOLD);
      encodePosition(t.distance - 1);
    }
  }
  return w.finish();
}

export function encodeLzhufLiterals(data: Uint8Array): Uint8Array {
  return encodeLzhuf([...data].map((literal) => ({ literal })));
}

/** Encodes LZSS (Arena "type 04") using only literals. */
export function encodeLzssLiterals(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 8) {
    out.push(0xff);
    for (const b of data.subarray(i, i + 8)) out.push(b);
  }
  return new Uint8Array(out);
}

export function u16(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}

export function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/** Builds a GLOBAL.BSA-style archive. */
export function makeBsa(files: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(files);
  const out: number[] = [...u16(names.length)];
  for (const n of names) out.push(...files[n]);
  for (const n of names) {
    const name = ascii(n).concat(new Array(12).fill(0)).slice(0, 12);
    const size = files[n].length;
    out.push(...name, 0, 0, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff);
  }
  return new Uint8Array(out);
}

/** Encrypts INF text the way GLOBAL.BSA stores it. */
export function encryptInf(text: string): Uint8Array {
  const key = [0xea, 0x7b, 0x4e, 0xbd, 0x19, 0xc9, 0x38, 0x99];
  return new Uint8Array(ascii(text).map((b, i) => b ^ ((key[i % 8] + i) & 0xff)));
}

export interface MifSpec {
  width: number;
  depth: number;
  start?: { x: number; y: number };
  name?: string;
  info?: string;
  map1: number[];
  flor: number[];
  triggers?: Array<[number, number, number, number]>;
  locks?: Array<[number, number, number]>;
}

/** Builds a one-level MIF with LZHUF-compressed grids. */
export function makeMif(spec: MifSpec): Uint8Array {
  const header = new Array(61).fill(0);
  const start = spec.start ?? { x: 0, y: 0 };
  header.splice(2, 2, ...u16(Math.round(start.x * 128)));
  header.splice(10, 2, ...u16(Math.round(start.y * 128)));
  header[19] = 1;
  header.splice(21, 2, ...u16(spec.width));
  header.splice(23, 2, ...u16(spec.depth));

  const chunk = (tag: string, body: number[]) => [...ascii(tag), ...u16(body.length), ...body];
  const grid = (values: number[]) => {
    const raw = new Uint8Array(values.flatMap(u16));
    return [...u16(raw.length), ...encodeLzhufLiterals(raw)];
  };
  const zstr = (s: string) => [...ascii(s), 0];

  const children = [
    ...chunk('NAME', zstr(spec.name ?? 'test level')),
    ...chunk('INFO', zstr(spec.info ?? 'test.inf')),
    ...chunk('NUMF', [1]),
    ...chunk('TRIG', (spec.triggers ?? []).flat()),
    ...(spec.locks ? chunk('LOCK', spec.locks.flat()) : []),
    ...chunk('MAP1', grid(spec.map1)),
    ...chunk('FLOR', grid(spec.flor)),
  ];
  return new Uint8Array([...chunk('MHDR', header), ...ascii('LEVL'), ...u16(children.length), ...children]);
}

// ---- PKLITE ----

export type PkliteToken = { literal: number } | { offset: number; length: number } | { segment: true } | { end: true };

/** Length codes, bits in the order the unpacker reads them; 25 is the escape for long copies and markers. */
const PK_LENGTHS: Record<number, string> = {
  2: '10', 3: '11', 4: '000', 5: '0010', 6: '0011', 7: '0100', 8: '01010', 9: '01011', 10: '01100',
  11: '011010', 12: '011011', 25: '011100', 13: '0111010', 14: '0111011', 15: '0111100',
  16: '01111010', 17: '01111011', 18: '01111100',
  19: '011111010', 20: '011111011', 21: '011111100', 22: '011111101', 23: '011111110', 24: '011111111',
};

function pkHigh(h: number): string {
  if (h === 0) return '1';
  const codes = ['000', '001', '0100', '0101', '0110', '0111', '10000', '10001', '10010', '10011', '10100', '10101', '10110', '101110', '101111'];
  return '0' + (h <= 15 ? codes[h - 1] : (h + 32).toString(2));
}

/** Packs a token list the way PKLITE's "extra" mode does (see src/formats/pklite.ts). */
export function encodePklite(tokens: PkliteToken[], xor = true): Uint8Array {
  const out: number[] = [0, 0];
  let wordAt = 0;
  let used = 0;
  const bit = (b: number) => {
    if (b) out[wordAt + (used >> 3)] |= 1 << (used & 7);
    if (++used === 16) {
      // The unpacker fetches the next word as soon as this one runs out.
      wordAt = out.length;
      out.push(0, 0);
      used = 0;
    }
  };
  const bits = (s: string) => {
    for (const c of s) bit(c === '1' ? 1 : 0);
  };
  for (const t of tokens) {
    if ('literal' in t) {
      bit(0);
      out.push(xor ? t.literal ^ (16 - used) : t.literal);
    } else if ('segment' in t || 'end' in t) {
      bit(1);
      bits(PK_LENGTHS[25]);
      out.push('end' in t ? 0xff : 0xfe);
    } else {
      bit(1);
      if (t.length >= 25) {
        bits(PK_LENGTHS[25]);
        out.push(t.length - 25);
      } else bits(PK_LENGTHS[t.length]);
      if (t.length !== 2) bits(pkHigh(t.offset >> 8));
      out.push(t.offset & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** A DOS program with a PKLITE-style header and stub around `packed`. */
export function makePkliteExe(packed: Uint8Array, xor = true): Uint8Array {
  const header = new Array(96).fill(0);
  header[0] = 0x4d;
  header[1] = 0x5a;
  header[8] = 6; // header size in paragraphs
  header.splice(0x1e, 12, ...ascii('PKLITE Copr.'));
  const stub = new Array(0x60).fill(0x90);
  const source = 0x120; // the stub copies itself from here
  const words = (stub.length - 0x20) / 2;
  stub.splice(0x10, 12, 0xb9, ...u16(words), 0x33, 0xff, 0x57, 0xbe, ...u16(source), 0xfc, 0xf3, 0xa5);
  if (xor) stub.splice(0x30, 4, 0xac, 0x32, 0xc2, 0xaa);
  return new Uint8Array([...header, ...stub, ...packed]);
}

// ---- Program tables ----

export interface FakeCreature {
  name: string;
  anim: string;
  level: number;
  health: [number, number];
  damage: [number, number];
  sound: number;
  lift?: number;
  noCorpse?: boolean;
}

export interface FakeWeapon {
  name: string;
  damage: [number, number];
  hands: 1 | 2;
  /** Kilograms and price, laid out as the CD version keeps them when every weapon has both. */
  weight?: number;
  price?: number;
}

/**
 * An unpacked-program image with creature and weapon tables laid out like
 * the game's (made-up values), followed by `more` (such as
 * makeCharacterTables()).
 */
export function makeExeImage(creatures: FakeCreature[], sounds: string[], weapons: FakeWeapon[], more: number[] = []): Uint8Array {
  const zs = (list: string[]) => list.flatMap((s) => [...ascii(s), 0]);
  const extras = weapons.every((w) => w.weight !== undefined && w.price !== undefined)
    ? [...weapons.flatMap((w) => u16(Math.round(w.weight! * 256))), ...weapons.map((w) => w.price!), ...new Array(weapons.length).fill(0), 9, 9, 9]
    : [9, 9, 9];
  const tables = new Array(0x20d).fill(0);
  const put = (back: number, bytes: number[]) => tables.splice(0x20d - back, bytes.length, ...bytes);
  const all = creatures.concat(new Array(24 - creatures.length).fill(creatures[creatures.length - 1]));
  put(0x20d, all.map((c) => c.sound));
  put(0x1f5, all.map((c) => (-(c.lift ?? 0)) & 0xff));
  put(0x1dd, all.map((c) => (c.noCorpse ? 1 : 0)));
  put(0x195, all.map((c) => c.level));
  put(0x14d, all.flatMap((c) => [...u16(c.health[0]), ...u16(c.health[1])]));
  put(0xed, all.flatMap(() => [10, 0, 0, 0]));
  put(0x8d, all.map(() => 2));
  put(0x75, all.flatMap((c) => c.damage));
  return new Uint8Array([
    ...ascii('padding'),
    0,
    ...zs(creatures.map((c) => c.name)),
    ...zs(['Mage']),
    ...zs(weapons.map((w) => w.name)),
    ...weapons.map((w) => w.hands),
    ...extras,
    ...weapons.flatMap((w) => w.damage),
    ...zs(['of Strength']),
    ...tables,
    ...zs(all.map((c) => `${c.anim}@.cfa`)),
    ...zs(sounds),
    ...zs(['dither.img']),
    ...more,
  ]);
}

export interface FakeClass {
  name: string;
  experience: number;
  healthDie: number;
  /** 0x20 spellcaster, 0x40 lands critical hits, 0x80 picks locks. */
  flags: number;
  /** Weapons it may use, by number; undefined for any. */
  weapons?: number[];
  /** Shields it may carry, 7 (buckler) to 10 (tower). */
  shields: number[];
  /** Heaviest armour: 0 plate, 1 chain, 2 leather, 3 none. */
  armour: number;
}

export interface FakeCharacterTables {
  /** Eighteen; the first two must be Mage and Spellsword, which the reader looks for. */
  classes: FakeClass[];
  attributes: string[];
  /** Eight; the first two provinces must be High Rock and Hammerfell. */
  races: Array<{ name: string; plural: string; province: string }>;
  /** Twelve messages (the first starting "How do you wish"), a phrase per class and a closing question; left out when undefined. */
  texts?: { messages: string[]; phrases: string[]; closing: string };
  /** Leaves out the tables of what each class may use. */
  noEquipment?: boolean;
}

/** Bytes laid out like the game's character tables (see src/formats/classes.ts), for makeExeImage's `more`. */
export function makeCharacterTables(t: FakeCharacterTables): number[] {
  const zs = (list: string[]) => list.flatMap((s) => [...ascii(s), 0]);
  const names = t.classes.map((c) => c.name);
  const out: number[] = [
    ...zs(['filler']),
    ...zs(names),
    ...zs(['BattleMage']),
    ...t.classes.flatMap((c) => u16(c.experience)),
    ...zs(['filler']),
    ...t.classes.map((c, i) => c.flags | i),
    ...zs(names),
    ...names.map((_, i) => (i * 5) % names.length),
    ...zs(t.attributes),
    ...zs(t.races.map((r) => r.plural)),
    ...zs(t.races.map((r) => r.name)),
    ...t.classes.map((c) => c.healthDie),
    ...zs(['filler']),
    ...zs(t.races.map((r) => r.province)),
    ...zs(['filler']),
  ];
  if (!t.noEquipment) {
    // u16 pointers to lists ending in 0xff, counted from a data segment that starts 0x100 bytes before these bytes.
    const lists = (sets: Array<number[] | undefined>, at: number) => {
      const pointers: number[] = [];
      const bytes: number[] = [];
      const shared = new Map<string, number>();
      for (const set of sets) {
        if (!set) {
          pointers.push(0);
          continue;
        }
        const key = set.join(',');
        if (!shared.has(key)) {
          shared.set(key, 0x100 + at + sets.length * 2 + bytes.length);
          bytes.push(...set, 0xff);
        }
        pointers.push(shared.get(key)!);
      }
      return [...pointers.flatMap(u16), ...bytes];
    };
    out.push(...zs(['%ss cannot equip this item, sorry.', 'Another message.']));
    out.push(...lists(t.classes.map((c) => c.weapons), out.length));
    out.push(...lists(t.classes.map((c) => (c.shields.length ? c.shields : undefined)), out.length));
    out.push(...t.classes.map((c) => c.armour), ...zs(['Green', 'Blue']));
  }
  if (t.texts) out.push(...zs([...t.texts.messages, ...t.texts.phrases, t.texts.closing]));
  return out;
}

/**
 * Bytes laid out like the game's armour, shield and hit tables (see
 * src/formats/armour.ts), for makeExeImage's `more`; the names and messages
 * are made up but for the pieces the reader looks for.
 */
export function makeArmourTables(t: ArmourTables, hits: HitTables): number[] {
  const zs = (list: string[]) => list.flatMap((s) => [...ascii(s), 0]);
  const out: number[] = [];
  // The item maker's code: each kind, then its protection.
  t.protection.forEach((p, kind) => out.push(0x90, 0xc6, 0x44, 0x10, kind, 0xc6, 0x44, 0x04, p, 0x90));
  // Pieces and shields, where each is worn, then prices and weights for leather, chain and plate.
  out.push(...zs(['Cuirass', 'Gauntlets', 'Leggings', 'Left', 'Right', 'Cap', 'Shoes', 'Small', 'Round', 'Kite', 'Tall']));
  out.push(...zs(['Chest', 'Hands', 'Legs', 'Arm', 'Arm', 'Head', 'Feet', 'Any', 'Any', 'Any', 'Any']));
  for (const k of [2, 1, 0]) out.push(...t.prices[k]);
  for (const k of [2, 1, 0]) out.push(...t.weights[k].flatMap((w) => u16(Math.round(w * 256))));
  // Materials, their protection and chances, pointers to three name lists (each with 11 more bytes), then price multipliers.
  out.push(...zs(['Iron', 'Steel', 'Brass', 'Bronze', 'Glass', 'Crystal', 'Star', 'Moon']), ...t.materialProtection.map((v) => v & 0xff), ...t.materialChances);
  const lists = ['Plate', 'Chain', 'Leather'].map((kind) => [...zs(Array.from({ length: 11 }, (_, i) => `${kind} ${i}`)), ...new Array(11).fill(3)]);
  const starts = [0x4000, 0x4000 + lists[0].length, 0x4000 + lists[0].length + lists[1].length];
  out.push(...starts.flatMap(u16), ...lists.flat(), ...t.materialPrices.flatMap(u16));
  // Shields' protection, then the position message.
  out.push(...t.shieldProtection, 0, 0, ...zs(['You stand at position is %d, %d.']));
  // Pointers to what each shield covers (the bytes right after them), then the condition grades and their first name.
  const covers = t.shieldCovers.map((parts) => Array.from({ length: 7 }, (_, i) => (parts.includes(i) ? 0xfe : 0)));
  out.push(...[0, 1, 2, 3].flatMap((i) => u16(0x5008 + i * 7)), ...covers.flat(), 2, 6, 12, 33, 55, 77, 99, ...zs(['Broken', 'Worn']));
  // Where blows land, after the broken gear message, then the undead.
  out.push(...zs(['That %s is broken.']), ...hits.bodyParts, ...hits.undead, ...zs(['filler']));
  return out;
}

// ---- CFA, CIF and VOC ----

/** Packs frames of palette indices into a CFA, using a colour table of the distinct indices. */
export function makeCfa(width: number, height: number, frames: number[][], bpp = 4): Uint8Array {
  const colours = [0, ...new Set(frames.flat().filter((v) => v !== 0))];
  const rowBytes = Math.ceil((width * bpp) / 8);
  const packFrame = (pixels: number[]) => {
    const raw = new Array(rowBytes * height).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = colours.indexOf(pixels[y * width + x]);
        for (let b = 0; b < bpp; b++) {
          const bit = y * rowBytes * 8 + x * bpp + b;
          if ((v >> (bpp - 1 - b)) & 1) raw[bit >> 3] |= 0x80 >> (bit & 7);
        }
      }
    }
    // Runs of the first byte, then literal copies, to cover both RLE forms.
    const out: number[] = [];
    let i = 0;
    while (i < raw.length && raw[i] === raw[0] && i < 3) i++;
    if (i > 1) out.push(0x80 | (i - 1), raw[0]);
    else i = 0;
    for (; i < raw.length; i += 100) {
      const chunk = raw.slice(i, i + 100);
      out.push(chunk.length - 1, ...chunk);
    }
    return out;
  };
  const packed = frames.map(packFrame);
  const header = new Array(0x4c).fill(0);
  header.splice(0, 12, ...u16(width), ...u16(height), ...u16(rowBytes), ...u16(5), ...u16(6), bpp, frames.length);
  let at = 0x4c + colours.length;
  packed.forEach((p, i) => {
    header.splice(0x0c + i * 2, 2, ...u16(at));
    at += p.length;
  });
  header.splice(0x4a, 2, ...u16(at));
  return new Uint8Array([...header, ...colours, ...packed.flat()]);
}

/** An uncompressed IMG record with an offset, as CIF files hold them. */
export function makeImg(x: number, y: number, width: number, height: number, pixels: number[]): number[] {
  return [...u16(x), ...u16(y), ...u16(width), ...u16(height), ...u16(0), ...u16(pixels.length), ...pixels];
}

export function makeVoc(rateCode: number, samples: number[], extraBlocks: number[] = []): Uint8Array {
  const header = [...ascii('Creative Voice File'), 0x1a, ...u16(26), ...u16(0x10a), ...u16(0x1129)];
  const size = samples.length + 2;
  return new Uint8Array([...header, ...extraBlocks, 1, size & 0xff, (size >> 8) & 0xff, size >> 16, rateCode, 0, ...samples, 0]);
}
