/**
 * What Arena puts in treasure piles, gear spots and bodies, and the magic
 * items it makes, read from the unpacked program (see pklite.ts) like the
 * tables in exe.ts and armour.ts: each part is found by the text beside it
 * and checked before use. The remake uses them only when every part can be
 * read and believed; otherwise its own loot stands in (game/loot.ts).
 *
 *   - Loot spots: right after "Bag of %u gold pieces", for each of five
 *     kinds of place, 4 chances out of 100: of gold, of a potion or magic
 *     trinket, of plain gear and of fine gear.
 *   - Creatures: the 96 bytes before "You have arrived in ", the same 4
 *     chances for each creature by number (0 is no one, 1 the rat).
 *   - Which class's gear the creatures from the Wraith (15) on may carry: 10
 *     bytes 0x2C before the creature animation names. The rest carry what a
 *     Mage may.
 *   - Potions: their names ("Potion of ..."), then the spell each casts (by
 *     its place in the spell list; 255 restores spell points), then their
 *     prices as u16.
 *   - Trinkets that cast spells: their 4 names (Mark, Crystal ...), the
 *     chance of each out of 100 as running totals, the level each casts at
 *     plus one, their base prices (u16) and the range of their charges (the
 *     fewest, and one more than the most). Then three groups of spells
 *     (offensive, defensive, other), each: the names ("of ..."), the spell
 *     each casts, the lowest level it is found at and its price per charge
 *     (u16).
 *   - Trinkets that raise an attribute or protect: their 4 names (Bracelet,
 *     Belt ...), their chances as running totals, 4 bytes, their prices
 *     (u16); the 8 attributes' names ("of Strength" ...), the lowest level
 *     each is found at, their prices (u16) and 8 bytes; then the chances of
 *     each quality of protective trinket as running totals, and their prices
 *     in fifties (u16). How much an attribute trinket adds is 4 bytes after
 *     "menu_lft.img".
 *   - Weapons (the CD version's layout): the lowest level each is found at,
 *     the 18 bytes the weapon reader in exe.ts leaves unused, then 3 rolls
 *     out of 10 that make a fine weapon one of material only, enchanted
 *     only, or both.
 *   - Enchantments, for weapons at the "of Strength" after the weapon
 *     tables and for armour at the one after the armour weights: their 14
 *     names, the spell each casts (255: it raises the attribute of its own
 *     number; armour's 193 makes the wearer jump as an Acrobat does), the
 *     lowest level each is found at and their prices (u16).
 *   - Armour: the lowest level each piece and shield is found at, the 11
 *     bytes after each of the plate, chain and leather name lists (see
 *     armour.ts), and for fine pieces, which are always plate, the 11 bytes
 *     after the armour weights.
 */
import { cString, ExeLayoutError, find, stringsAt, stringsLength } from './cstrings';

/** One roll's chances out of 100: of gold, of a potion or magic trinket, of plain gear and of fine gear. */
export type LootChances = [number, number, number, number];

export interface PotionInfo {
  name: string;
  /** The spell it casts, by its place in the spell list; RESTORE_POWER restores spell points. */
  spell: number;
  price: number;
}

export interface SpellTrinketInfo {
  name: string;
  /** Out of 100, as a running total. */
  chance: number;
  /** It casts at this level. */
  castLevel: number;
  price: number;
  /** It comes with at least the first and fewer than the second. */
  charges: [number, number];
}

/** A spell a trinket can hold, or a weapon's or armour's enchantment. */
export interface MagicInfo {
  /** "of Fireball". */
  name: string;
  /** By its place in the spell list; for enchantments ATTRIBUTE and JUMPING mean those instead. */
  spell: number;
  /** Not found before this level. */
  level: number;
  /** Per charge for trinkets. */
  price: number;
}

export interface TrinketInfo {
  name: string;
  chance: number;
  price: number;
  /** What it adds to its attribute when it raises one. */
  boost: number;
}

export interface LootTables {
  /** For each kind of place, 0 to 4. */
  places: LootChances[];
  /** For each creature by number: 0 is no one, 1 the rat. */
  creatures: LootChances[];
  /** The class whose gear each creature from FIRST_CLASSED_CREATURE on may carry. */
  creatureClasses: number[];
  potions: PotionInfo[];
  spellTrinkets: SpellTrinketInfo[];
  /** Offensive, defensive and other spells for trinkets. */
  trinketSpells: MagicInfo[][];
  trinkets: TrinketInfo[];
  /** The attributes trinkets raise, Strength to Luck: their names ("of Strength"), lowest levels and prices. */
  trinketAttributes: MagicInfo[];
  /** Protective trinkets' qualities: chances out of 100 as running totals, and prices in fifties. */
  qualities: Array<{ chance: number; price: number }>;
  /** The lowest level each weapon is found at. */
  weaponLevels: number[];
  /** A roll of 1 to 10 below the first makes a fine item of material only, below the second enchanted only, else both. */
  fineSplit: number[];
  weaponEnchantments: MagicInfo[];
  armourEnchantments: MagicInfo[];
  /** Plate, chain and leather: the lowest level each piece and shield is found at. */
  armourLevels: number[][];
  /** Fine (plate) pieces and shields likewise. */
  fineArmourLevels: number[];
}

/** A potion's spell that restores spell points instead. */
export const RESTORE_POWER = 255;
/** An enchantment that raises the attribute of its own number. */
export const ATTRIBUTE = 255;
/** An armour enchantment that makes the wearer jump as an Acrobat does. */
export const JUMPING = 193;
/** Creatures from this number on carry the gear of a class of their own (creatureClasses). */
export const FIRST_CLASSED_CREATURE = 15;

const PLACES = 5;
const CREATURES = 24;
const CREATURE_CLASSES = 10;
/** From the creature animation names back to the creatures' classes. */
const CLASSES_BACK = 0x2c;
const WEAPONS = 18;
const MATERIALS = 8;
const GEAR = 11;
const ATTRIBUTES = 8;
const QUALITIES = 5;
const KINDS = 4;

/** All of Arena's loot tables, or undefined when any part can't be read or believed. */
export function readLootTables(image: Uint8Array): LootTables | undefined {
  try {
    return readAll(image);
  } catch (err) {
    if (!(err instanceof ExeLayoutError)) throw err;
    console.warn('Could not read the loot tables:', err.message);
    return undefined;
  }
}

function readAll(image: Uint8Array): LootTables {
  const r = new Reader(image);
  const armour = readArmourLevels(r);
  const weapons = readWeaponTables(r);
  return {
    places: readPlaceChances(r),
    creatures: readCreatureChances(r),
    creatureClasses: readCreatureClasses(r),
    potions: readPotions(r),
    ...readSpellTrinkets(r),
    ...readTrinkets(r),
    ...weapons,
    ...armour,
  };
}

/** Reads bytes and words from the program, refusing to run off its end. */
class Reader {
  private readonly view: DataView;
  constructor(readonly image: Uint8Array) {
    this.view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  }

  bytes(at: number, count: number): number[] {
    if (at < 0 || at + count > this.image.length) throw new ExeLayoutError('a loot table runs off the end of the program');
    return Array.from(this.image.subarray(at, at + count));
  }

  words(at: number, count: number): number[] {
    if (at < 0 || at + count * 2 > this.image.length) throw new ExeLayoutError('a loot table runs off the end of the program');
    return Array.from({ length: count }, (_, i) => this.view.getUint16(at + i * 2, true));
  }

  /** The zero-terminated strings from `at` that start with `prefix`, and where the first that doesn't begins. */
  prefixed(at: number, prefix: string, most = 32): { names: string[]; end: number } {
    const names: string[] = [];
    while (names.length < most) {
      const s = cString(this.image, at);
      if (!s.startsWith(prefix)) break;
      names.push(s);
      at += s.length + 1;
    }
    return { names, end: at };
  }
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new ExeLayoutError(`the ${what} are implausible`);
}

const rising = (a: number[]) => a.every((v, i) => i === 0 || v > a[i - 1]);
const percent = (v: number) => v >= 0 && v <= 100;
const level = (v: number) => v >= 1 && v <= 30;
const spell = (v: number) => v < 128 || v === ATTRIBUTE || v === JUMPING;

/** `rows` of 4 chances from `at`. */
function readChances(r: Reader, at: number, rows: number): LootChances[] {
  const bytes = r.bytes(at, rows * 4);
  check(bytes.every(percent), 'loot chances');
  return Array.from({ length: rows }, (_, i) => bytes.slice(i * 4, i * 4 + 4) as LootChances);
}

function readPlaceChances(r: Reader): LootChances[] {
  const bag = find(r.image, 'Bag of %u', 'loot spot chances');
  return readChances(r, bag + cString(r.image, bag).length + 1, PLACES);
}

function readCreatureChances(r: Reader): LootChances[] {
  return readChances(r, find(r.image, 'You have arrived', 'creature loot chances') - CREATURES * 4, CREATURES);
}

function readCreatureClasses(r: Reader): number[] {
  const classes = r.bytes(find(r.image, 'rat@.cfa\0', 'creature animations') - CLASSES_BACK, CREATURE_CLASSES);
  check(classes.every((c) => c < 32), 'creature classes');
  return classes;
}

function readPotions(r: Reader): PotionInfo[] {
  const { names, end } = r.prefixed(find(r.image, 'Potion of ', 'potions'), 'Potion of ');
  check(names.length > 0, 'potions');
  const spells = r.bytes(end, names.length);
  const prices = r.words(end + names.length, names.length);
  check(spells.every(spell) && prices.every((p) => p > 0), 'potions');
  return names.map((name, i) => ({ name, spell: spells[i], price: prices[i] }));
}

/** A list of "of ..." names, then a byte of spell and of level each, then a u16 price each. */
function readMagic(r: Reader, at: number, what: string, count?: number): { magic: MagicInfo[]; end: number } {
  const { names, end } = r.prefixed(at, 'of ');
  check(names.length > 0 && (count === undefined || names.length === count), what);
  const n = names.length;
  const spells = r.bytes(end, n);
  const levels = r.bytes(end + n, n);
  const prices = r.words(end + n * 2, n);
  check(spells.every(spell) && levels.every(level) && prices.every((p) => p > 0), what);
  return { magic: names.map((name, i) => ({ name, spell: spells[i], level: levels[i], price: prices[i] })), end: end + n * 4 };
}

function readSpellTrinkets(r: Reader): Pick<LootTables, 'spellTrinkets' | 'trinketSpells'> {
  const start = find(r.image, 'Mark\0Crystal\0', 'magic trinkets');
  const names = stringsAt(r.image, start, KINDS);
  let at = start + stringsLength(names);
  const chances = r.bytes(at, KINDS);
  const castLevels = r.bytes(at + KINDS, KINDS);
  const prices = r.words(at + KINDS * 2, KINDS);
  const charges = r.bytes(at + KINDS * 4, KINDS * 2);
  at += KINDS * 6;
  check(rising(chances) && chances[KINDS - 1] >= 100 && castLevels.every(level) && prices.every((p) => p > 0), 'magic trinkets');
  check(charges.every((c, i) => (i % 2 === 0 ? c >= 1 : c > charges[i - 1] && c <= 100)), 'magic trinket charges');
  const trinketSpells: MagicInfo[][] = [];
  for (let group = 0; group < 3; group++) {
    const { magic, end } = readMagic(r, at, 'magic trinket spells');
    trinketSpells.push(magic);
    at = end;
  }
  return {
    spellTrinkets: names.map((name, i) => ({ name, chance: chances[i], castLevel: castLevels[i], price: prices[i], charges: [charges[i * 2], charges[i * 2 + 1]] })),
    trinketSpells,
  };
}

function readTrinkets(r: Reader): Pick<LootTables, 'trinkets' | 'trinketAttributes' | 'qualities'> {
  const start = find(r.image, 'Bracelet\0Belt\0', 'trinkets');
  const names = stringsAt(r.image, start, KINDS);
  const at = start + stringsLength(names);
  const chances = r.bytes(at, KINDS);
  // 4 bytes the remake has no use for.
  const prices = r.words(at + KINDS * 2, KINDS);
  check(rising(chances) && chances[KINDS - 1] >= 100 && prices.every((p) => p > 0), 'trinkets');
  const attributes = r.prefixed(at + KINDS * 4, 'of ');
  check(attributes.names.length === ATTRIBUTES, 'trinket attributes');
  const levels = r.bytes(attributes.end, ATTRIBUTES);
  const attributePrices = r.words(attributes.end + ATTRIBUTES, ATTRIBUTES);
  check(levels.every(level) && attributePrices.every((p) => p > 0), 'trinket attributes');
  // Then 8 more bytes, and the protective trinkets' qualities.
  const qualitiesAt = attributes.end + ATTRIBUTES * 4;
  const qualityChances = r.bytes(qualitiesAt, QUALITIES);
  const qualityPrices = r.words(qualitiesAt + QUALITIES, QUALITIES);
  check(rising(qualityChances) && qualityChances[QUALITIES - 1] <= 101 && qualityPrices.every((p) => p > 0), 'trinket qualities');
  const boosts = r.bytes(find(r.image, 'menu_lft.img\0', 'trinket boosts') + 'menu_lft.img\0'.length, KINDS);
  check(rising(boosts) && boosts[0] > 0 && boosts[KINDS - 1] <= 100, 'trinket boosts');
  return {
    trinkets: names.map((name, i) => ({ name, chance: chances[i], price: prices[i], boost: boosts[i] })),
    trinketAttributes: attributes.names.map((name, i) => ({ name, spell: ATTRIBUTE, level: levels[i], price: attributePrices[i] })),
    qualities: qualityChances.map((chance, i) => ({ chance, price: qualityPrices[i] })),
  };
}

function readWeaponTables(r: Reader): Pick<LootTables, 'weaponLevels' | 'fineSplit' | 'weaponEnchantments'> {
  const start = find(r.image, 'Staff\0Dagger\0', 'weapon names');
  const end = start + stringsLength(stringsAt(r.image, start, WEAPONS));
  const enchantments = find(r.image, 'of Strength\0', 'weapon enchantments', end);
  // Only the CD version keeps the weapons' levels here (see exe.ts's readWeapons).
  check(enchantments - end === WEAPONS * 7 + 3, 'weapon tables');
  const weaponLevels = r.bytes(end + WEAPONS * 4, WEAPONS);
  const fineSplit = r.bytes(end + WEAPONS * 5, 3);
  check(weaponLevels.every(level) && rising(fineSplit) && fineSplit[0] >= 1 && fineSplit[2] <= 11, 'weapon levels');
  return { weaponLevels, fineSplit, weaponEnchantments: readMagic(r, enchantments, 'weapon enchantments').magic };
}

function readArmourLevels(r: Reader): Pick<LootTables, 'armourLevels' | 'fineArmourLevels' | 'armourEnchantments'> {
  // The plate, chain and leather lists after the materials, each followed by its levels (see armour.ts's readMaterials).
  const materials = find(r.image, 'Iron\0Steel\0', 'materials');
  let at = materials + stringsLength(stringsAt(r.image, materials, MATERIALS)) + MATERIALS * 2 + 6;
  const armourLevels: number[][] = [];
  for (let kind = 0; kind < 3; kind++) {
    at += stringsLength(stringsAt(r.image, at, GEAR));
    armourLevels.push(r.bytes(at, GEAR));
    at += GEAR;
  }
  // Fine pieces: after the piece names, where each is worn, and the prices and weights (see armour.ts's readWeightsAndPrices).
  const pieces = find(r.image, 'Cuirass\0Gauntlets\0', 'armour pieces');
  const fineAt = pieces + stringsLength(stringsAt(r.image, pieces, GEAR * 2)) + GEAR * 3 + GEAR * 3 * 2;
  const fineArmourLevels = r.bytes(fineAt, GEAR);
  // Levels past 30 mark what isn't found at all (chain and leather shields).
  check([...armourLevels, fineArmourLevels].every((row) => row.every((v) => v >= 1 && v <= 100) && row.some(level)), 'armour levels');
  const enchantments = find(r.image, 'of Strength\0', 'armour enchantments', fineAt + GEAR);
  check(enchantments - (fineAt + GEAR) < 16, 'armour enchantments');
  return { armourLevels, fineArmourLevels, armourEnchantments: readMagic(r, enchantments, 'armour enchantments').magic };
}
