/**
 * Game tables read from the unpacked program (see pklite.ts): creature
 * stats and weapon damage, from the player's own ACD.EXE.
 *
 * The tables have no index of their own. They sit at fixed distances from
 * lists of names (the creature animation files, the weapon names), so they
 * are found from those lists and every value is checked before use; a
 * program laid out differently is rejected rather than misread.
 *
 * Creature tables, 24 entries each (the 24th is the final boss), measured
 * back from the start of the animation name list ("rat@.cfa", ...):
 *   -0x20D u8   sound, an index into the creature sound list ("rats.voc", ...)
 *   -0x1F5 i8   height above the floor (negative lifts flyers up)
 *   -0x1DD u8   1 = leaves no body
 *   -0x1C5 u16  scale (0 = none)
 *   -0x195 u8   level
 *   -0x17D u16  elemental flags (4 fire, 8 frost)
 *   -0x14D u16  hit points, lowest and highest
 *   -0x0ED u32  experience
 *   -0x08D u8   extra experience per hit point
 *   -0x075 u8   damage, lowest and highest
 * Weapons: 18 names ("Staff", "Dagger", ...), then one byte each for one or
 * two hands; the damage pairs end right where "of Strength" (the first
 * enchantment name) begins.
 */

export interface CreatureInfo {
  /** e.g. "Goblin". */
  name: string;
  level: number;
  /** Hit points are rolled between these. */
  health: [number, number];
  damage: [number, number];
  /** Experience for a kill: this, plus experiencePerHealth for each of the creature's hit points. */
  experience: number;
  experiencePerHealth: number;
  /** The creature's sound, e.g. "RATS.VOC". */
  sound?: string;
  /** CFA name stem: STEM1.CFA to STEM5.CFA are the five view angles and STEM6.CFA the death. */
  animation: string;
  /** Height of its feet above the floor, in Arena units (ghosts float). */
  lift: number;
  /** Ghosts and the like leave no body. */
  noCorpse: boolean;
  /** Elemental flags: 4 fire, 8 frost. */
  flags: number;
  /** The game's scale value, 0 when unset. */
  scale: number;
}

export interface WeaponInfo {
  name: string;
  damage: [number, number];
  twoHanded: boolean;
}

export interface ExeData {
  /** Indexed like the levels' creature items: *ITEM 32 is creatures[0]. */
  creatures: CreatureInfo[];
  weapons: WeaponInfo[];
}

/** Creatures that can appear in levels; the final boss is left out. */
const CREATURES = 23;
const TABLE_ENTRIES = 24;
const WEAPONS = 18;

export class ExeLayoutError extends Error {}

export function readExeData(image: Uint8Array): ExeData {
  return { creatures: readCreatures(image), weapons: readWeapons(image) };
}

export function readCreatures(image: Uint8Array): CreatureInfo[] {
  const names = stringsAt(image, find(image, 'Rat\0Goblin\0', 'creature names'), CREATURES);
  const animStart = find(image, 'rat@.cfa\0', 'creature animations');
  const anims = stringsAt(image, animStart, TABLE_ENTRIES);
  const soundStart = find(image, 'firedaem.voc\0', 'creature sounds');
  const sounds: string[] = [];
  for (let p = soundStart; sounds.length < 64; ) {
    const s = cString(image, p);
    if (!/\.voc$/i.test(s)) break;
    sounds.push(s.toUpperCase());
    p += s.length + 1;
  }

  const at = (back: number) => {
    const p = animStart - back;
    if (p < 0) throw new ExeLayoutError('creature tables are missing');
    return p;
  };
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const u8 = (back: number, i: number) => image[at(back) + i];
  const u16 = (back: number, i: number) => view.getUint16(at(back) + i * 2, true);

  const creatures: CreatureInfo[] = [];
  for (let i = 0; i < CREATURES; i++) {
    const anim = anims[i].toUpperCase();
    if (!anim.endsWith('@.CFA')) throw new ExeLayoutError(`unexpected creature animation name "${anims[i]}"`);
    const c: CreatureInfo = {
      name: names[i],
      level: u8(0x195, i),
      health: [u16(0x14d, i * 2), u16(0x14d, i * 2 + 1)],
      damage: [u8(0x75, i * 2), u8(0x75, i * 2 + 1)],
      experience: view.getUint32(at(0xed) + i * 4, true),
      experiencePerHealth: u8(0x8d, i),
      sound: sounds[u8(0x20d, i)],
      animation: anim.slice(0, -'@.CFA'.length),
      lift: -view.getInt8(at(0x1f5) + i) || 0,
      noCorpse: u8(0x1dd, i) === 1,
      flags: u16(0x17d, i),
      scale: u16(0x1c5, i),
    };
    const sane =
      c.level >= 1 &&
      c.level <= 100 &&
      c.health[0] >= 1 &&
      c.health[0] <= c.health[1] &&
      c.health[1] <= 5000 &&
      c.damage[0] >= 1 &&
      c.damage[0] <= c.damage[1];
    if (!sane) throw new ExeLayoutError(`creature ${i} (${c.name}) has implausible stats`);
    creatures.push(c);
  }
  return creatures;
}

export function readWeapons(image: Uint8Array): WeaponInfo[] {
  const start = find(image, 'Staff\0Dagger\0', 'weapon names');
  const names = stringsAt(image, start, WEAPONS);
  let end = start;
  for (const n of names) end += n.length + 1;
  const enchantment = find(image, 'of Strength\0', 'weapon damage', end);
  const damageStart = enchantment - WEAPONS * 2;
  if (damageStart < end + WEAPONS || enchantment - end > 512) throw new ExeLayoutError('weapon damage is missing');
  return names.map((name, i) => {
    const damage: [number, number] = [image[damageStart + i * 2], image[damageStart + i * 2 + 1]];
    const hands = image[end + i];
    if (damage[0] < 1 || damage[0] > damage[1] || (hands !== 1 && hands !== 2)) {
      throw new ExeLayoutError(`weapon ${i} (${name}) has implausible stats`);
    }
    return { name, damage, twoHanded: hands === 2 };
  });
}

function find(image: Uint8Array, text: string, what: string, from = 0): number {
  const first = text.charCodeAt(0);
  outer: for (let i = image.indexOf(first, from); i !== -1; i = image.indexOf(first, i + 1)) {
    for (let k = 1; k < text.length; k++) if (image[i + k] !== text.charCodeAt(k)) continue outer;
    return i;
  }
  throw new ExeLayoutError(`could not find the ${what}`);
}

function cString(image: Uint8Array, p: number): string {
  let s = '';
  while (p < image.length && image[p] !== 0 && s.length < 256) s += String.fromCharCode(image[p++]);
  return s;
}

function stringsAt(image: Uint8Array, p: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const s = cString(image, p);
    out.push(s);
    p += s.length + 1;
  }
  return out;
}
