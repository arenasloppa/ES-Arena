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
 *   -0x17D u16  the elements it resists (4 fire, 8 cold, 16 shock, 64 poison)
 *   -0x14D u16  hit points, lowest and highest
 *   -0x0ED u32  experience
 *   -0x08D u8   extra experience per hit point
 *   -0x075 u8   damage, lowest and highest
 *   -0x019 i8   chance in percent of a landed blow's special harm (paralysis,
 *               disease), less 1; 0 for none, below that for other powers
 * Each creature's attributes, 8 bytes on Arena's scale of 0 to 255 in the
 * attributes' order, follow the race attribute table, after 9 more rows.
 *
 * Weapons: 18 names ("Staff", "Dagger", ...), then one byte each for one or
 * two hands; the damage pairs end right where "of Strength" (the first
 * enchantment name) begins. In the CD version 72 bytes sit between the two:
 * 18 u16 weights in 1/256 kg, 18 bytes of prices, 18 more (unused here) and
 * 3 bytes; the weights and prices are read only when that is so.
 *
 * The character tables (classes, races, creation texts) are in classes.ts,
 * armour's in armour.ts and what turns up as loot in loot.ts.
 */
import { readArmourTables, readHitTables, type ArmourTables, type HitTables } from './armour';
import { readCalendar, type Calendar } from './calendar';
import { readCharacterTables, type CharacterTables } from './classes';
import { cString, ExeLayoutError, find, stringsAt } from './cstrings';
import { readLootTables, type LootTables } from './loot';
import { readMessages, type GameMessages } from './messages';

export { ExeLayoutError };

export interface CreatureInfo {
  /** e.g. "Goblin". */
  name: string;
  /** Its number in the game's list, 1 (the rat) to 23; missing for creatures of the remake's own. */
  id?: number;
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
  /** The elements it resists: 4 fire, 8 cold, 16 shock, 64 poison. */
  flags: number;
  /** Agility on Arena's scale of 0 to 255, when the program's creature attributes can be read: the quicker land more blows. */
  agility?: number;
  /**
   * How often, in percent less 1, a blow that lands does the creature's
   * special harm (see game/creatures.ts's paralysisFrom); 0 for none, and below
   * 0 for powers of other kinds.
   */
  special: number;
  /** The game's scale value, 0 when unset. */
  scale: number;
}

export interface WeaponInfo {
  name: string;
  damage: [number, number];
  twoHanded: boolean;
  /** Kilograms, when the program says. */
  weight?: number;
  /** The game's price, when the program says. */
  price?: number;
}

/**
 * The raised platforms of dungeons (interiors), in Arena units: the eight
 * heights a platform's bottom can sit at, and the sixteen thicknesses it
 * can have. A MAP1 platform's high byte picks one of each (bits 0-2 and
 * 3-6). Read from the fixed places OpenTESArena found them at in each
 * version of the program ([RaisedPlatforms] in its exe offset lists).
 */
export interface RaisedPlatforms {
  heights: number[];
  thicknesses: number[];
}

export interface ExeData {
  /** Indexed like the levels' creature items: *ITEM 32 is creatures[0]. */
  creatures: CreatureInfo[];
  weapons: WeaponInfo[];
  /** Missing when the program is laid out differently from the two versions known. */
  platforms?: RaisedPlatforms;
  /** The game's own messages (drowning, camping and the like). */
  messages?: GameMessages;
  /**
   * Each race's starting attributes on Arena's scale of 0 to 255, for men
   * (row race * 2) and women (race * 2 + 1), in the attributes' order.
   * Missing when the program is laid out differently from the two versions
   * known.
   */
  raceAttributes?: number[][];
  /** The months, weekdays and words for dates and times; missing when they can't be found. */
  calendar?: Calendar;
  /** What turns up when monsters come upon the player (resting, for one); missing as above. */
  encounters?: EncounterTables;
  /** Classes, races and the words of character creation; missing when they could not be read. */
  character?: CharacterTables;
  /** Whatever of the armour and shield tables could be read (see armour.ts). */
  armour?: Partial<ArmourTables>;
  /** Where blows land and which creatures are undead; missing when they could not be read. */
  hits?: HitTables;
  /** What turns up in loot spots and on creatures, and the magic items; missing when any of it could not be read. */
  loot?: LootTables;
}

/** Creatures that can appear in levels; the final boss is left out. */
const CREATURES = 23;
const TABLE_ENTRIES = 24;
const WEAPONS = 18;

export function readExeData(image: Uint8Array): ExeData {
  const data: ExeData = {
    creatures: readCreatures(image),
    weapons: readWeapons(image),
    platforms: readRaisedPlatforms(image),
    messages: readMessages(image),
    raceAttributes: readRaceAttributes(image),
    encounters: readEncounters(image),
    calendar: readCalendar(image),
    armour: readArmourTables(image),
    hits: readHitTables(image),
    loot: readLootTables(image),
  };
  try {
    data.character = readCharacterTables(image);
  } catch (err) {
    // The dungeons don't need them: character creation falls back to the remake's own.
    if (!(err instanceof ExeLayoutError)) throw err;
    console.warn('Could not read the class tables:', err.message);
  }
  return data;
}

/** Where each version keeps the platform tables, found by a string that sits at a known place in it. */
const VERSIONS = [
  { name: 'CD', anchor: 0x3f508, platforms: 0x48594, raceAttributes: 0x361c3, chances: 0x42210, table: 0x36cbe, indices: 0x36818 },
  { name: 'floppy', anchor: 0x3f1cc, platforms: 0x48206, raceAttributes: 0x35fc3, chances: 0x41e6e, table: 0x36abe, indices: 0x36618 },
];
/** From the race attribute table to the creatures': 16 race rows and 9 more, of 8 bytes. */
const CREATURE_ATTRIBUTES = 25 * 8;
const AGILITY = 3;

function version(image: Uint8Array) {
  return VERSIONS.find((v) => cString(image, v.anchor) === 'exp_ab.cfa');
}

/**
 * Arena's random encounters, as OpenTESArena lists them ([Entities]
 * EnemyEncounterChances, EnemyEncounterTable, EnemyEncounterTableIndices).
 */
export interface EncounterTables {
  /** Percent chance an hour (or a minute, in towns) of an encounter, by place: 0 city, 1 wilderness, 2 main quest dungeon, 3 other dungeon, 4 building; +5 while resting. */
  chances: number[];
  /** Each encounter: how many, which (1 to 23 a creature in the game's order, 24 on a human of class n - 24) and the humans' level. */
  table: Array<{ count: number; id: number; level: number }>;
  /** For each of 14 kinds of place, the encounter level of each entry in `table` there (0 for none). */
  levels: number[][];
}

const ENCOUNTERS = 85;

export function readEncounters(image: Uint8Array): EncounterTables | undefined {
  const v = version(image);
  if (!v || v.indices + 14 * ENCOUNTERS > image.length || v.chances + 13 > image.length) return undefined;
  const chances = Array.from(image.subarray(v.chances, v.chances + 13));
  const table = Array.from({ length: ENCOUNTERS }, (_, i) => {
    const at = v.table + i * 3;
    return { count: image[at], id: image[at + 1], level: image[at + 2] };
  });
  const levels = Array.from({ length: 14 }, (_, r) => Array.from(image.subarray(v.indices + r * ENCOUNTERS, v.indices + (r + 1) * ENCOUNTERS)));
  const plausible = chances.every((c) => c <= 100) && table.every((e) => e.count >= 1 && e.count <= 4 && e.id >= 1 && e.id < 64) && levels.every((row) => row.every((l) => l <= 30));
  return plausible ? { chances, table, levels } : undefined;
}

/**
 * The race attribute table ([Entities] RaceAttributes in OpenTESArena's
 * lists): 16 rows of 8 bytes on Arena's scale of 0 to 255.
 */
export function readRaceAttributes(image: Uint8Array): number[][] | undefined {
  const v = version(image);
  if (!v || v.raceAttributes + 128 > image.length) return undefined;
  const rows = Array.from({ length: 16 }, (_, r) => Array.from(image.subarray(v.raceAttributes + r * 8, v.raceAttributes + r * 8 + 8)));
  return rows.every((row) => row.every((a) => a >= 25 && a <= 230)) ? rows : undefined;
}

/** Each creature's attributes, 0 to 255, in the game's order of creatures; missing as above. */
export function readCreatureAttributes(image: Uint8Array): number[][] | undefined {
  const v = version(image);
  const at = v ? v.raceAttributes + CREATURE_ATTRIBUTES : -1;
  if (!v || at + TABLE_ENTRIES * 8 > image.length) return undefined;
  const rows = Array.from({ length: TABLE_ENTRIES }, (_, r) => Array.from(image.subarray(at + r * 8, at + r * 8 + 8)));
  return rows.every((row) => row.every((a) => a > 0)) ? rows : undefined;
}

export function readRaisedPlatforms(image: Uint8Array): RaisedPlatforms | undefined {
  const v = version(image);
  if (!v || v.platforms + 56 * 2 > image.length) return undefined;
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const u16 = (i: number) => view.getUint16(v.platforms + i * 2, true);
  const heights = Array.from({ length: 8 }, (_, i) => u16(i));
  const thicknesses = Array.from({ length: 16 }, (_, i) => u16(24 + i));
  // Both rise from the floor; anything else means the table isn't where it was expected.
  const rising = (a: number[]) => a.every((v, i) => i === 0 || v > a[i - 1]);
  if (heights[0] !== 0 || !rising(heights) || !rising(thicknesses) || thicknesses[15] > 1000) return undefined;
  return { heights, thicknesses };
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

  const attributes = readCreatureAttributes(image);
  const creatures: CreatureInfo[] = [];
  for (let i = 0; i < CREATURES; i++) {
    const anim = anims[i].toUpperCase();
    if (!anim.endsWith('@.CFA')) throw new ExeLayoutError(`unexpected creature animation name "${anims[i]}"`);
    const c: CreatureInfo = {
      name: names[i],
      id: i + 1,
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
      special: view.getInt8(at(0x19) + i),
    };
    const sane =
      c.level >= 1 &&
      c.level <= 100 &&
      c.health[0] >= 1 &&
      c.health[0] <= c.health[1] &&
      c.health[1] <= 5000 &&
      c.damage[0] >= 1 &&
      c.damage[0] <= c.damage[1] &&
      c.special >= -8 &&
      c.special <= 100;
    if (!sane) throw new ExeLayoutError(`creature ${i} (${c.name}) has implausible stats`);
    if (attributes) c.agility = attributes[i][AGILITY];
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
  // Weights and prices, where the CD version keeps them.
  const extras = enchantment - end === WEAPONS * 7 + 3;
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const weapons = names.map((name, i): WeaponInfo => {
    const damage: [number, number] = [image[damageStart + i * 2], image[damageStart + i * 2 + 1]];
    const hands = image[end + i];
    if (damage[0] < 1 || damage[0] > damage[1] || (hands !== 1 && hands !== 2)) {
      throw new ExeLayoutError(`weapon ${i} (${name}) has implausible stats`);
    }
    const weapon: WeaponInfo = { name, damage, twoHanded: hands === 2 };
    if (extras) {
      weapon.weight = view.getUint16(end + WEAPONS + i * 2, true) / 256;
      weapon.price = image[end + WEAPONS * 3 + i];
    }
    return weapon;
  });
  // Only trusted when every weight and price is believable.
  if (extras && !weapons.every((w) => w.weight! > 0 && w.weight! <= 60 && w.price! > 0)) {
    for (const w of weapons) delete w.weight, delete w.price;
  }
  return weapons;
}
