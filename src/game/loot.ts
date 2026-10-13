/**
 * What turns up in loot spots (the treasure piles, gear spots, bodies and
 * chests laid in a level) and on the creatures, by Arena's rules and from
 * the player's own game (formats/loot.ts). Pure logic so it can be unit
 * tested; the dungeon hands it out (dungeon.ts).
 *
 * As in Arena's program (at 0x24330), a loot spot is filled the first time
 * it is opened, with four rolls of 1 to 100 against its kind of place's
 * chances: of gold, of a potion or magic trinket, of plain gear and of
 * fine gear. The remake's dungeons are Arena's named ones (its kind of place
 * 3), where the gold is 1 to 100 plus the floor's number squared, potions
 * and trinkets are found at 5 levels for each floor counting from 1, and
 * gear at level 16. Whatever a spot holds turns up unidentified.
 *
 * A creature is given what it carries when it appears (at 0x24FA6), with
 * the same four rolls against its own chances: gold, if a second roll of 0
 * to 100 comes out no lower than the chance, of 1 to 10 times one more than
 * its level; a potion or trinket at one more than its level, once that is
 * above 3; plain gear of that level, the first of 20 tries its class may
 * use (or the last try); and fine gear at level 16, once its level and one
 * is above 7, the first of 20 tries its class may use (or none). Most
 * creatures have a Mage's class; the later ones have their own.
 *
 * Gear is found no lower than its level: a weapon, or a plate, chain or
 * leather piece or shield (plain shields only in plate; where Arena's
 * program reads past its table for the others, the remake goes back round
 * to the cuirass). Fine gear is a weapon or plate piece of a material, or
 * enchanted, or both, as a roll of 1 to 10 falls against the game's split.
 * A spot's fine gear is one the player's class may use, if one turns up in
 * 200 tries (Arena's 0x205FD).
 *
 * The material is found with a roll of 1 to 99 against the game's chances,
 * and an enchantment is any the item's level reaches. Potions are any of
 * the game's 15. A trinket is one of three sorts: one that casts a spell,
 * with charges; one that raises an attribute, found from level 7; or one
 * that protects, of a metal from Elven up.
 */
import type { ArmourTables } from '../formats/armour';
import type { ClassInfo } from '../formats/classes';
import type { WeaponInfo } from '../formats/exe';
import { ATTRIBUTE, FIRST_CLASSED_CREATURE, JUMPING, type LootTables, type MagicInfo } from '../formats/loot';
import type { Random } from './combat';
import type {SpellRecord} from '../formats/spells';
import { classMayUse, GEAR_BOOST, makeArmour, makeShield, makeWeapon, MATERIALS, PIECES, PLATE, POTION_WEIGHT, type NewItem } from './items';

export interface LootRules {
  spells?:SpellRecord[];
  tables: LootTables;
  weapons: WeaponInfo[];
  armour: ArmourTables;
  /** The game's classes, for the gear creatures may carry; without them, any. */
  classes?: ClassInfo[];
}

export interface Loot {
  gold: number;
  items: NewItem[];
}

/** Arena's kind of place for its named dungeons, which are the remake's. */
export const DUNGEON = 3;
/** Gear in loot spots, and fine gear anywhere, is found at this level. */
export const GEAR_LEVEL = 16;
/** Level a spot's potions and trinkets are found at, for each floor counting from 1. */
const LEVEL_PER_FLOOR = 5;
/** Trinkets turn up in loot spots only from this level. */
const TRINKET_LEVEL = 3;
/** Attribute trinkets are found only from this level (Arena's program, at 0x1CF57). */
const ATTRIBUTE_TRINKET_LEVEL = 7;
/** Creatures carry potions and trinkets above this level, and fine gear above the next. */
const CREATURE_ITEM_LEVEL = 3;
const CREATURE_FINE_LEVEL = 7;
const CREATURE_TRIES = 20;
const SPOT_FINE_TRIES = 200;
/** Protective trinkets' metals start at Elven (3), and their quality is a roll of 76 to 99. */
const PROTECTIVE_METAL = 3;
const QUALITY_ROLL: [number, number] = [76, 100];
/** Protective trinkets' prices are in fifties. */
const QUALITY_PRICE = 50;
/** A trinket's or potion's cast level is one less than the table's (0x2A4F2). */
const CAST_LEVEL_OFFSET = 1;
/** Gear casts its spell at this level (0x2A4D0, one less than its 15). */
export const GEAR_CAST_LEVEL = 14;
/** Potions cast their spell at this level (0x2A57B). */
export const POTION_CAST_LEVEL = 15;
/** The most wear gear can have for casting (0x20C79). */
const MAX_CONDITION = 50000;
/** The class most creatures have: a Mage's. */
const CREATURE_CLASS = 0;

/** A whole number from lo up to, but not including, hi. */
const between = (random: Random, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo));
/** 1 to 100. */
const percent = (random: Random) => between(random, 1, 101);
/** The first of the running totals the roll is below, else the last. */
function pick(totals: number[], roll: number): number {
  const i = totals.findIndex((t) => roll < t);
  return i >= 0 ? i : totals.length - 1;
}
/** Any one of those found at the level, as Arena rolls again until it gets one; undefined when none is. */
function atLevel<T extends { level: number }>(list: T[], level: number, random: Random): number | undefined {
  const found = list.flatMap((m, i) => (m.level <= level ? [i] : []));
  return found.length ? found[between(random, 0, found.length)] : undefined;
}

/** What's in a loot spot on floor `floor` (from 0), filled as it is first opened; fine gear is what `player`'s class can use. */
export function spotLoot(rules: LootRules, floor: number, random: Random, player?: ClassInfo): Loot {
  const [gold, magic, plain, fine] = rules.tables.places[DUNGEON].map((chance) => percent(random) <= chance);
  const loot: Loot = { gold: 0, items: [] };
  if (gold) loot.gold = percent(random) + floor * floor;
  if (magic) {
    const level = (floor + 1) * LEVEL_PER_FLOOR;
    // Arena looks at whether its random number is odd.
    const item = random() < 0.5 ? (level >= TRINKET_LEVEL ? trinket(rules, level, random) : undefined) : potion(rules, random);
    if (item) loot.items.push(item);
  }
  if (plain) {
    const item = random() < 0.5 ? plainWeapon(rules, GEAR_LEVEL, random) : plainArmour(rules, GEAR_LEVEL, random);
    if (item) loot.items.push(item);
  }
  if (fine) {
    const weapon = random() < 0.5;
    for (let i = 0; i < SPOT_FINE_TRIES; i++) {
      const item = weapon ? fineWeapon(rules, GEAR_LEVEL, random) : fineArmour(rules, GEAR_LEVEL, random);
      if (item && classMayUse(player, item)) {
        loot.items.push(item);
        break;
      }
    }
  }
  for (const item of loot.items) hide(item);
  return loot;
}

/** What a creature carries: `creature` its number in the game's list (1 the rat), `level` its level. */
export function creatureLoot(rules: LootRules, creature: number, level: number, random: Random): Loot {
  const chances = rules.tables.creatures[creature];
  const loot: Loot = { gold: 0, items: [] };
  if (!chances) return loot;
  const [gold, magic, plain, fine] = chances.map((chance) => percent(random) <= chance);
  const itemLevel = level + 1;
  // Arena rolls again for gold, and gives it only when that roll is at least the chance.
  if (gold && chances[0] <= between(random, 0, 101)) loot.gold = between(random, 1, 11) * (level + 1);
  if (magic && itemLevel > CREATURE_ITEM_LEVEL) {
    const item = random() < 0.5 ? trinket(rules, itemLevel, random) : potion(rules, random);
    if (item) loot.items.push(item);
  }
  const cls = creatureClass(rules, creature);
  if (plain) {
    for (let tries = CREATURE_TRIES; tries > 0; tries--) {
      let item: NewItem | undefined;
      if (random() < 0.5) item = plainWeapon(rules, itemLevel, random);
      // A class that wears no armour doesn't try for it.
      else if (cls?.armour !== 3) item = plainArmour(rules, itemLevel, random);
      if (item && (classMayUse(cls, item) || tries === 1)) {
        loot.items.push(item);
        break;
      }
    }
  }
  if (fine && itemLevel > CREATURE_FINE_LEVEL) {
    for (let tries = 0; tries < CREATURE_TRIES; tries++) {
      const item = random() < 0.5 ? fineWeapon(rules, GEAR_LEVEL, random) : fineArmour(rules, GEAR_LEVEL, random);
      if (item && classMayUse(cls, item)) {
        loot.items.push(hide(item));
        break;
      }
    }
  }
  return loot;
}

/** The class whose gear the creature may carry; none for one Arena gives a class past the list. */
function creatureClass(rules: LootRules, creature: number): ClassInfo | undefined {
  const id = creature >= FIRST_CLASSED_CREATURE ? rules.tables.creatureClasses[creature - FIRST_CLASSED_CREATURE] : CREATURE_CLASS;
  return id === undefined ? undefined : rules.classes?.[id];
}

/** Magic found in a spot, and fine gear on creatures, turns up unidentified. */
function hide(item: NewItem): NewItem {
  if (item.plainName !== undefined) item.unidentified = true;
  return item;
}

/** Any of the game's potions. */
export function potion(rules: LootRules, random: Random): NewItem {
  const potions = rules.tables.potions;
  const type = between(random, 0, potions.length);
  const p = potions[type];
  return {
    kind: 'potion',
    name: p.name,
    type,
    spell: p.spell,
    castLevel: POTION_CAST_LEVEL,
    weight: POTION_WEIGHT,
    value: p.price,
    // "Potion of Healing" is a "Potion" until it is known.
    plainName: p.name.split(' of ')[0],
  };
}

/** A magic trinket of the level: one that casts a spell, raises an attribute or protects; undefined when the roll finds none (an attribute below level 7). */
export function trinket(rules: LootRules, level: number, random: Random): NewItem | undefined {
  switch (between(random, 0, 3)) {
    case 0:
      return spellTrinket(rules, level, random);
    case 1:
      return attributeTrinket(rules, level, random);
    default:
      return protectiveTrinket(rules, random);
  }
}

function spellTrinket(rules: LootRules, level: number, random: Random): NewItem | undefined {
  const t = rules.tables;
  const type = pick(t.spellTrinkets.map((k) => k.chance), between(random, 0, 100));
  const kind = t.spellTrinkets[type];
  const spells = t.trinketSpells[between(random, 0, t.trinketSpells.length)];
  const s = atLevel(spells, level, random);
  if (s === undefined) return undefined;
  const charges = between(random, kind.charges[0], kind.charges[1]);
  return {
    kind: 'trinket',
    trinket: 'spell',
    name: `${kind.name} ${spells[s].name}`,
    plainName: kind.name,
    type,
    spell: spells[s].spell,
    castLevel: kind.castLevel - CAST_LEVEL_OFFSET,
    charges,
    weight: 0,
    value: kind.price + charges * spells[s].price,
  };
}

function attributeTrinket(rules: LootRules, level: number, random: Random): NewItem | undefined {
  if (level < ATTRIBUTE_TRINKET_LEVEL) return undefined;
  const t = rules.tables;
  const type = pick(t.trinkets.map((k) => k.chance), between(random, 0, 100));
  const attribute = atLevel(t.trinketAttributes, level, random);
  if (attribute === undefined) return undefined;
  const kind = t.trinkets[type];
  return {
    kind: 'trinket',
    trinket: 'attribute',
    name: `${kind.name} ${t.trinketAttributes[attribute].name}`,
    plainName: kind.name,
    type,
    attribute,
    boost: kind.boost,
    weight: 0,
    value: kind.price + t.trinketAttributes[attribute].price,
  };
}

function protectiveTrinket(rules: LootRules, random: Random): NewItem {
  const t = rules.tables;
  const type = between(random, 0, t.trinkets.length);
  const quality = pick(t.qualities.map((q) => q.chance), between(random, ...QUALITY_ROLL));
  const metal = PROTECTIVE_METAL + quality;
  return {
    kind: 'trinket',
    trinket: 'protective',
    name: `${MATERIALS[metal]} ${t.trinkets[type].name}`,
    plainName: t.trinkets[type].name,
    type,
    material: metal,
    protection: rules.armour.materialProtection[metal],
    weight: 0,
    value: t.qualities[quality].price * QUALITY_PRICE,
  };
}

/** A plain weapon found at the level. */
export function plainWeapon(rules: LootRules, level: number, random: Random): NewItem | undefined {
  const type = weaponAt(rules, level, random);
  return type === undefined ? undefined : makeWeapon(rules.weapons, type, undefined, rules.armour);
}

function weaponAt(rules: LootRules, level: number, random: Random): number | undefined {
  return atLevel(
    rules.weapons.map((_, i) => ({ level: rules.tables.weaponLevels[i] ?? Infinity })),
    level,
    random,
  );
}

/** A plain piece of plate, chain or leather, or a plain shield, found at the level. */
export function plainArmour(rules: LootRules, level: number, random: Random): NewItem | undefined {
  const kind = between(random, 0, 3);
  const levels = rules.tables.armourLevels[kind];
  const first = between(random, 0, levels.length);
  // Arena walks on from the piece it rolled to the next found at the level.
  for (let step = 0; step < levels.length; step++) {
    const piece = (first + step) % levels.length;
    if (level < levels[piece]) continue;
    return piece < PIECES.length ? makeArmour(kind, piece, undefined, rules.armour) : makeShield(piece - PIECES.length, undefined, rules.armour);
  }
  return undefined;
}

/** A fine weapon found at the level: of a material, enchanted, or both. */
export function fineWeapon(rules: LootRules, level: number, random: Random): NewItem | undefined {
  const type = weaponAt(rules, level, random);
  if (type === undefined) return undefined;
  const { material, enchanted } = fineParts(rules, random);
  const item = makeWeapon(rules.weapons, type, material, rules.armour);
  return enchanted ? enchant(item, rules.tables.weaponEnchantments, level, random) : item;
}

/** A fine piece of plate or shield found at the level: of a material, enchanted, or both. */
export function fineArmour(rules: LootRules, level: number, random: Random): NewItem | undefined {
  const piece = atLevel(rules.tables.fineArmourLevels.map((l) => ({ level: l })), level, random);
  if (piece === undefined) return undefined;
  const { material, enchanted } = fineParts(rules, random);
  const shield = piece >= PIECES.length;
  const item = shield ? makeShield(piece - PIECES.length, material, rules.armour) : makeArmour(PLATE, piece, material, rules.armour);
  // Arena names fine plate by its metal and the piece alone: "Ebony Helm", or "Helm of Strength".
  if (!shield && material === undefined) item.name = PIECES[piece];
  return enchanted ? enchant(item, rules.tables.armourEnchantments, level, random) : item;
}

/** Whether a fine item has a material, an enchantment or both, by a roll of 1 to 10, and which material. */
function fineParts(rules: LootRules, random: Random): { material?: number; enchanted: boolean } {
  const split = rules.tables.fineSplit;
  const roll = between(random, 1, 11);
  const material = roll < split[0] || roll >= split[1];
  return {
    material: material ? pick(rules.armour.materialChances, between(random, 1, 100)) : undefined,
    enchanted: roll >= split[0],
  };
}

/** Adds one of the enchantments the level reaches to the item: its name, price and what it does. */
function enchant(item: NewItem, enchantments: MagicInfo[], level: number, random: Random): NewItem {
  const e = atLevel(enchantments, level, random);
  if (e === undefined) return item;
  const magic = enchantments[e];
  const enchanted: NewItem = { ...item, name: `${item.name} ${magic.name}`, plainName: item.name, value: item.value + magic.price };
  if (magic.spell === ATTRIBUTE) {
    enchanted.attribute = e;
    enchanted.boost = GEAR_BOOST;
  } else if (magic.spell === JUMPING) enchanted.jumping = true;
  else {
    enchanted.spell = magic.spell;
    enchanted.castLevel = GEAR_CAST_LEVEL;
    enchanted.condition = conditionFor(enchanted.weight, enchanted.value);
  }
  return enchanted;
}

/**
 * Gear's wear for casting, as Arena's program sets it (at 0x20C52): a
 * hundred for each whole kilogram (50 for a half and 25 for a quarter),
 * or, for magic gear, its price if that is more, up to 50000.
 */
export function conditionFor(kilograms: number, price: number): number {
  const byWeight = kilograms === 0.5 ? 50 : kilograms === 0.25 ? 25 : Math.floor(kilograms) * 100;
  return Math.max(byWeight, Math.min(price, MAX_CONDITION));
}
