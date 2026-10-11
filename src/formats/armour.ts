/**
 * Armour, shields and where blows land, read from the unpacked program (see
 * pklite.ts) like the tables in exe.ts: each is found by the text or code
 * beside it and checked before use. Every part is optional; one that can't
 * be read is left out, and the remake's own numbers stand in for it
 * (game/items.ts, game/combat.ts).
 *
 *   - How much a plate, chain and leather piece protects, in percent: the
 *     program writes it into each new piece right after the piece's kind
 *     (C6 44 10 kind, then C6 44 04 protection).
 *   - Materials: after their eight names come 8 signed bytes, what each adds
 *     to plate and shields; 8 bytes of chances out of 100 of finding each
 *     (each the running total); then 3 u16 pointers to the plate, chain and
 *     leather name lists. Each list of 11 names is followed by 11 bytes, and
 *     the last of those by 8 u16, what each material multiplies the price by
 *     in quarters.
 *   - Weights and prices: after the 11 piece and shield names, and the 11
 *     places they are worn, come 11 bytes of prices for each of leather,
 *     chain and plate, then 11 u16 weights in 1/256 kg for each.
 *   - Shields: their protection, 4 bytes, sits just before the message that
 *     tells the player their position. Which body parts each covers is a
 *     pointer to 7 bytes (the high bit set where it covers), just before the
 *     7 bytes that grade an item's condition and the first grade's name.
 *   - Where blows land: right after the message about broken gear, 7 bytes;
 *     a roll of 0 to 19 lands on the first body part whose value it is no
 *     more than. Then the 7 undead creatures, by number.
 */
import { cString, stringsLength } from './cstrings';

export interface ArmourTables {
  /** Protection of a plate, chain and leather piece, in percent: the chance taken off a blow landing there. */
  protection: number[];
  /** What each material, Iron to Ebony, adds to the protection of plate and shields (and a fifth of it to a weapon's damage). */
  materialProtection: number[];
  /** Chance out of 100 of finding each material, as running totals: a roll of 1 to 99 is the first material it is below. */
  materialChances: number[];
  /** What each material multiplies an item's price by, in quarters. */
  materialPrices: number[];
  /** Protection of a buckler, round, kite and tower shield. */
  shieldProtection: number[];
  /** The body parts each shield covers. */
  shieldCovers: number[][];
  /** Kilograms of each piece, then each shield, for plate, chain and leather. */
  weights: number[][];
  /** Prices likewise. */
  prices: number[][];
}

export interface HitTables {
  /** Where blows land: a roll of 0 to 19 hits the first body part whose value it is no more than. */
  bodyParts: number[];
  /** The undead, by creature number (1 rat to 24). */
  undead: number[];
}

const MATERIALS = 8;
const KINDS = 3;
/** Seven pieces of a suit and four shields. */
const GEAR = 11;
const PARTS = 7;
const SHIELDS = 4;

/** Where `text` first appears, or -1. */
function indexOf(image: Uint8Array, text: string, from = 0): number {
  const first = text.charCodeAt(0);
  outer: for (let i = image.indexOf(first, from); i !== -1; i = image.indexOf(first, i + 1)) {
    for (let k = 1; k < text.length; k++) if (image[i + k] !== text.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

/** Where the bytes first appear, or -1. */
function indexOfBytes(image: Uint8Array, bytes: number[]): number {
  outer: for (let i = image.indexOf(bytes[0]); i !== -1; i = image.indexOf(bytes[0], i + 1)) {
    for (let k = 1; k < bytes.length; k++) if (image[i + k] !== bytes[k]) continue outer;
    return i;
  }
  return -1;
}

/** Past `count` zero-terminated strings starting at `p`. */
function skipStrings(image: Uint8Array, p: number, count: number): number {
  for (let i = 0; i < count && p < image.length; i++) p += cString(image, p).length + 1;
  return p;
}

const rising = (a: number[]) => a.every((v, i) => i === 0 || v > a[i - 1]);
const neverFalling = (a: number[]) => a.every((v, i) => i === 0 || v >= a[i - 1]);

/** Whatever of the armour tables can be read and believed. */
export function readArmourTables(image: Uint8Array): Partial<ArmourTables> {
  return { ...readProtection(image), ...readMaterials(image), ...readWeightsAndPrices(image), ...readShields(image) };
}

function readProtection(image: Uint8Array): Partial<ArmourTables> {
  const protection = [0, 1, 2].map((kind) => {
    const at = indexOfBytes(image, [0xc6, 0x44, 0x10, kind, 0xc6, 0x44, 0x04]);
    return at < 0 ? 0 : image[at + 7];
  });
  // Plate protects most and leather least.
  return protection[2] > 0 && rising([...protection].reverse()) && protection[0] <= 100 ? { protection } : {};
}

function readMaterials(image: Uint8Array): Partial<ArmourTables> {
  const names = indexOf(image, 'Iron\0Steel\0');
  if (names < 0) return {};
  const at = skipStrings(image, names, MATERIALS);
  if (at + MATERIALS * 2 + 6 > image.length) return {};
  const signed = (b: number) => (b > 127 ? b - 256 : b);
  const materialProtection = Array.from(image.subarray(at, at + MATERIALS), signed);
  const materialChances = Array.from(image.subarray(at + MATERIALS, at + MATERIALS * 2));
  const out: Partial<ArmourTables> = {};
  if (materialProtection.every((v) => Math.abs(v) <= 50) && neverFalling(materialProtection)) out.materialProtection = materialProtection;
  if (rising(materialChances) && materialChances[0] > 0 && materialChances[MATERIALS - 1] <= 101) out.materialChances = materialChances;

  // The three name lists the pointers lead to, each with its 11 bytes, then the price multipliers.
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const pointers = [0, 1, 2].map((i) => view.getUint16(at + MATERIALS * 2 + i * 2, true));
  const lists = [at + MATERIALS * 2 + 6];
  for (let k = 0; k < KINDS; k++) lists.push(skipStrings(image, lists[k], GEAR) + GEAR);
  const prices = lists[KINDS];
  if (pointers[1] - pointers[0] !== lists[1] - lists[0] || pointers[2] - pointers[1] !== lists[2] - lists[1] || prices + MATERIALS * 2 > image.length) return out;
  const materialPrices = Array.from({ length: MATERIALS }, (_, i) => view.getUint16(prices + i * 2, true));
  if (materialPrices[0] > 0 && rising(materialPrices)) out.materialPrices = materialPrices;
  return out;
}

function readWeightsAndPrices(image: Uint8Array): Partial<ArmourTables> {
  const names = indexOf(image, 'Cuirass\0Gauntlets\0');
  if (names < 0) return {};
  // The pieces and shields, then where each is worn.
  const at = skipStrings(image, names, GEAR * 2);
  const weightsAt = at + KINDS * GEAR;
  if (weightsAt + KINDS * GEAR * 2 > image.length) return {};
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  // Leather, chain and plate in the program; plate, chain and leather here.
  const prices = [2, 1, 0].map((k) => Array.from(image.subarray(at + k * GEAR, at + (k + 1) * GEAR)));
  const weights = [2, 1, 0].map((k) => Array.from({ length: GEAR }, (_, i) => view.getUint16(weightsAt + (k * GEAR + i) * 2, true) / 256));
  // Every kind's shields are the same shields.
  const same = (rows: number[][]) => rows.every((r) => r.slice(PARTS).join() === rows[0].slice(PARTS).join());
  const plausible =
    prices.every((r) => r.every((p) => p > 0)) && weights.every((r) => r.every((w) => w > 0 && w <= 40)) && same(prices) && same(weights);
  return plausible ? { prices, weights } : {};
}

function readShields(image: Uint8Array): Partial<ArmourTables> {
  const out: Partial<ArmourTables> = {};
  // Protection: the 4 bytes before the position message (and any zeros after them).
  const position = indexOf(image, 'position is %d');
  if (position >= 0) {
    let end = position;
    while (end > 0 && image[end - 1] !== 0 && position - end < 32) end--;
    for (let zeros = 0; zeros < 4 && end > 0 && image[end - 1] === 0; zeros++) end--;
    const shieldProtection = Array.from(image.subarray(Math.max(0, end - SHIELDS), end));
    if (end >= SHIELDS && shieldProtection[0] > 0 && rising(shieldProtection) && shieldProtection[SHIELDS - 1] <= 100) out.shieldProtection = shieldProtection;
  }
  // Coverage: 4 pointers, then the 7 bytes each points at; the tower shield's end just before the 7 condition grades.
  const grades = indexOf(image, 'Broken\0');
  if (grades >= 0) {
    const tower = grades - PARTS - PARTS;
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    for (let table = tower - 8; table >= Math.max(0, tower - 48); table--) {
      const ptr = [0, 1, 2, 3].map((i) => view.getUint16(table + i * 2, true));
      // The pointers' segment: the buckler's bytes follow the pointers.
      const base = table + 8 - ptr[0];
      if (base + ptr[3] !== tower || !ptr.every((p, i) => i === 0 || (p - ptr[i - 1] >= PARTS && p - ptr[i - 1] <= PARTS + 1))) continue;
      const covers = ptr.map((p) => Array.from(image.subarray(base + p, base + p + PARTS)));
      if (covers.every((c) => c.every((b) => b === 0 || b >= 0x80) && c.some((b) => b >= 0x80))) {
        out.shieldCovers = covers.map((c) => c.flatMap((b, part) => (b >= 0x80 ? [part] : [])));
      }
      break;
    }
  }
  return out;
}

/** Where blows land and which creatures are undead, when they can be read. */
export function readHitTables(image: Uint8Array): HitTables | undefined {
  const broken = indexOf(image, 's is broken.\0');
  if (broken < 0) return undefined;
  const at = broken + stringsLength(['s is broken.']);
  if (at + PARTS * 2 > image.length) return undefined;
  const bodyParts = Array.from(image.subarray(at, at + PARTS));
  const undead = Array.from(image.subarray(at + PARTS, at + PARTS * 2));
  const plausible = rising(bodyParts) && bodyParts[PARTS - 1] === 19 && rising(undead) && undead[0] >= 1 && undead[PARTS - 1] <= 24;
  return plausible ? { bodyParts, undead } : undefined;
}
