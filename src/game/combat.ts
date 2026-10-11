/**
 * Combat numbers: dice, hit chances and the player's health, stamina and
 * gear. Pure logic so it can be unit tested.
 *
 * Damage, health and levels come from the game's own tables (see
 * formats/exe.ts). Whether a creature's blow lands is Arena's own rule: the
 * levels on both sides, the armour on the body part it strikes and both
 * sides' Agility (see hitChance). The player's swings always connect, as in
 * Skyrim. Spells of an element are saved against as in Arena (see
 * elementalDamage). What the character's race, class and attributes add is
 * worked out in character.ts.
 */
import type { ClassInfo } from '../formats/classes';

export type Random = () => number;

/** A whole number from min to max, both included. */
export function roll(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Out of 100 to Arena's 0 to 255 (its program at 0x17474): times 2.56, rounded half away from zero. */
export function to256(value: number): number {
  const q = Math.floor((Math.abs(value) * 256 + 50) / 100);
  return value < 0 ? -q : q;
}

/** 50 out of 100 on Arena's scale: a creature's Agility when the program's can't be read, and a player's Agility and Willpower with no character. */
export const MIDDLING_AGILITY = 128;
/**
 * Where blows land when the program's table can't be read, the remake's own:
 * a roll of 0 to 19 hits the first body part (cuirass, gauntlets, greaves,
 * left and right pauldron, helm, boots) whose value it is no more than.
 */
export const BODY_PARTS = [4, 7, 10, 12, 14, 15, 19];

/** What a creature's blow has to get past to land. */
export interface Defender {
  level: number;
  /** Agility, 0 to 255. */
  agility: number;
  /** How well each body part is protected, in percent: the piece worn there, and the shield if it covers it. */
  protection: number[];
  /** A Monk or Acrobat: their level, more than their armour, keeps blows off them. */
  evasive: boolean;
}

/**
 * Chance out of 256 that a creature's blow lands on a body part, as Arena
 * works it out (its program at 0x2AF9B): an even chance, 5% more for each
 * level the creature has over the player (and less for each it lacks), less
 * the protection on that part, plus the creature's Agility less the
 * player's. For a Monk or Acrobat it is a 32nd of that, times one more than
 * their level. However well protected, a blow lands a fifth of the time and
 * a percent more for each of the player's levels. (Arena works the Monk's
 * figure on 16 bits, so one below nothing wraps round to a blow that always
 * lands; here it counts as nothing.)
 */
export function hitChance(attacker: { level: number; agility: number }, d: Defender, part: number): number {
  let chance = 128 + to256(5 * (attacker.level - d.level)) - to256(d.protection[part] ?? 0) + attacker.agility - d.agility;
  if (d.evasive) chance = Math.floor(Math.max(0, chance) / 32) * (d.level + 1);
  return Math.max(chance, Math.floor((d.level * 256) / 100) + 51);
}

/** The body part a blow lands on: a roll of 0 to 19 down the table (Arena's program at 0x2B097). */
export function bodyPart(random: Random, parts: number[] = BODY_PARTS): number {
  const r = Math.floor(random() * 20);
  const part = parts.findIndex((top) => r <= top);
  return part < 0 ? parts.length - 1 : part;
}

/** Whether a creature's blow lands: on a body part, then a roll out of 256 below the chance there. */
export function blowLands(attacker: { level: number; agility: number }, d: Defender, random: Random, parts?: number[]): boolean {
  const part = bodyPart(random, parts);
  return Math.floor(random() * 256) < hitChance(attacker, d, part);
}

/** A race's knack with weapons: a point of damage for every `levels` of the character's levels, with `weapons`. */
export interface WeaponKnack {
  levels: number;
  weapons: 'any' | 'melee' | 'bows';
}

/** What a race's knack adds to a blow: nothing until the character reaches the levels it takes. */
export function knackDamage(knack: WeaponKnack | undefined, level: number, bow: boolean): number {
  if (!knack || (knack.weapons === 'melee' && bow) || (knack.weapons === 'bows' && !bow)) return 0;
  return Math.floor(level / knack.levels);
}

/** The elements of spells, numbered as in the spells file (formats/spells.ts); 5 and up are spells of none. */
export const FIRE = 0;
export const COLD = 1;
export const POISON = 2;
export const SHOCK = 3;
export const MAGIC = 4;

/** What stands between a spell and the player's health. */
export interface SpellDefence {
  /** Willpower, 0 to 255. */
  willpower: number;
  /** Chance out of 100 of failing the save against each element. */
  saves: number[];
  /** The element the race takes half of, and none of on a save. */
  resists?: number;
  /** A Monk: a spell saved against does no harm at all, rather than half. */
  shrugsOff?: boolean;
}

/**
 * Damage from a spell of an element, as Arena works it out for one that
 * strikes the player (its program at 0x2A825): Willpower takes a 26th of
 * itself off, then the player saves against the element. A failed save takes
 * the whole damage and a successful one half, but the element the race
 * resists does half on a failed save and none on a successful one (Nords
 * and cold, Bretons and magic). A Monk takes nothing from any spell saved
 * against, as the manual says (Arena's program leaves that out). Spells of
 * no element are only lessened by Willpower.
 */
export function elementalDamage(damage: number, element: number, t: SpellDefence, random: Random): number {
  damage = Math.max(0, damage - Math.floor(t.willpower / 26));
  if (damage <= 0 || element > MAGIC) return damage;
  const failed = Math.floor(random() * 100) < (t.saves[element] ?? 0);
  const resisted = element === t.resists;
  if (failed) return resisted ? Math.floor(damage / 2) : damage;
  return resisted || t.shrugsOff ? 0 : Math.floor(damage / 2);
}

export interface Weapon {
  name: string;
  damage: [number, number];
  /** First-person swing frames: SWORD.CIF, AXE.CIF, ... */
  cif: string;
}

/** Which first-person swing set each of Arena's 18 weapons uses (by its place in the game's weapon list). */
export function weaponCif(index: number): string | undefined {
  if (index === 0) return 'STAFF.CIF';
  if (index <= 10) return 'SWORD.CIF';
  return ['MACE.CIF', 'STAR.CIF', 'HAMMER.CIF', 'AXE.CIF', 'AXE.CIF'][index - 11];
}

export interface PlayerStats {
  level: number;
  experience: number;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  /** Spell points, shown as Skyrim's magicka; none for characters who can't cast spells. */
  magicka: number;
  maxMagicka: number;
  gold: number;
  potions: number;
  /** Key numbers carried; each opens the locks of the same level. */
  keys: Set<number>;
  weapon: Weapon;
  /**
   * Max health less what Endurance gave at the start, and the hit die rolled
   * at each level since: with Endurance's bonus as it is now for every
   * level, they make max health (see maxHealthFor).
   */
  baseHealth: number;
  healthRolls: number[];
  /** Bonus points from the levels gained, still to be shared out among the attributes. */
  bonusPoints: number;
}

/** What the player's character brings to a fight; see character.ts. */
export interface Hero {
  /** The class, for what it may use; none means anything goes. */
  cls?: ClassInfo;
  /** Health and stamina at level 1. */
  health: number;
  stamina: number;
  /** Each level adds 1 to healthDie health, plus Endurance's healthBonus, which counts for every level (see maxHealthFor). */
  healthDie: number;
  healthBonus: number;
  /** Experience needed for level 2; each level after needs more (see experienceFor). */
  experience: number;
  /** Added to every blow. */
  damageBonus: number;
  /** The race's knack with weapons, adding to blows as the character rises in level. */
  knack?: WeaponKnack;
  /** A Ranger: blows do as much more damage as the character's level, except to the undead. */
  levelDamage: boolean;
  /** Agility on Arena's scale of 0 to 255: the quicker the character, the fewer blows land (see hitChance). */
  agility: number;
  /** A Monk or Acrobat, hard to hit and harder with each level (see hitChance). */
  evasive: boolean;
  /** Willpower on Arena's scale, the save against each element, the element the race resists, and whether a save spares a Monk all harm (see elementalDamage). */
  willpower: number;
  saves: number[];
  resists?: number;
  shrugsOff?: boolean;
  /** Chance out of 100 that a blow which can paralyse does: Arena's poison save, and none for those immune to paralysis. */
  paralysis: number;
  /** Multiplies walking and running speed. */
  pace: number;
  /** Multiplies how fast stamina comes back. */
  recovery: number;
  /** Chance that a blow is a critical hit, doing double damage, and the weapons it can be with: an Archer's bows, everyone else's the others. */
  critical: number;
  criticalWith: 'melee' | 'bows';
  /** Chance to pick an easy lock; 0 for classes that can't. */
  lockpicking: number;
  /** Multiplies the gold found. */
  fortune: number;
  /** Kilograms that can be carried before the player is too laden to run. */
  carry: number;
  /** Spell points; 0 for classes that can't cast spells (see magic.ts). */
  magicka: number;
  /** Spell points come back over time; a Sorcerer's don't. */
  regainsMagicka: boolean;
  /** Swimming speed as a share of walking, and how fast swimming tires: Argonians swim at full speed and tire less than half as fast. */
  swimPace: number;
  swimTiring: number;
  /** How many times faster than others the character climbs out of a pit: Khajiit and Acrobats four times. */
  climbPace: number;
  /** How many times as high, and as long, the character's jumps go: an Acrobat's twice. */
  leap: number;
  /** Endurance's heal mod, for healing while camping (camping.ts). */
  healMod?: number;
  /** Gold rolled at creation, when the character has some. */
  gold?: number;
}

/** The player without a character of their own: no class, and nothing added or taken away. */
export const DEFAULT_HERO: Hero = {
  health: 30,
  stamina: 100,
  healthDie: 5,
  healthBonus: 3,
  experience: 1000,
  damageBonus: 0,
  levelDamage: false,
  agility: MIDDLING_AGILITY,
  evasive: false,
  willpower: MIDDLING_AGILITY,
  saves: [0, 0, 0, 0, 0],
  paralysis: 0,
  pace: 1,
  recovery: 1,
  critical: 0,
  criticalWith: 'melee',
  lockpicking: 0,
  fortune: 1,
  carry: 200,
  magicka: 0,
  regainsMagicka: true,
  swimPace: 0.5,
  swimTiring: 1,
  climbPace: 1,
  leap: 1,
};

export const POTION_HEALS = 25;
const STAMINA_REGEN = 22; // per second, after a short pause
const STAMINA_PAUSE = 0.8;
const HEALTH_REGEN = 0.25; // per second, out of a fight
const HEALTH_PAUSE = 6;

export function newPlayerStats(weapon: Weapon, hero: Hero = DEFAULT_HERO): PlayerStats {
  return {
    level: 1,
    experience: 0,
    health: hero.health,
    maxHealth: hero.health,
    stamina: hero.stamina,
    maxStamina: hero.stamina,
    magicka: hero.magicka,
    maxMagicka: hero.magicka,
    gold: 0,
    potions: 0,
    keys: new Set(),
    weapon,
    baseHealth: hero.health - hero.healthBonus,
    healthRolls: [],
    bonusPoints: 0,
  };
}

/**
 * Experience needed to reach a level, as Arena works it out (its program at
 * 0x26B93): the class's figure for level 2, then 30/16 of the last for each
 * level up to 10 and 24/16 after that, rounded down each time.
 */
export function experienceFor(level: number, base = DEFAULT_HERO.experience): number {
  if (level <= 1) return 0;
  let next = base;
  for (let l = 3; l <= level; l++) next = Math.floor((next * (l <= 10 ? 30 : 24)) / 16);
  return next;
}

/** Adds experience and raises the player's level as often as it allows (see levelUp); returns how many levels were gained. */
export function gainExperience(p: PlayerStats, amount: number, random: Random, hero: Hero = DEFAULT_HERO): number {
  p.experience += amount;
  return levelUp(p, random, hero);
}

/**
 * Raises the player's level as often as their experience allows; returns how
 * many levels were gained. As in Arena's program (0x26B38 and 0x12974), each
 * level rolls the class's hit die, 1 to the die, for health, with Endurance's
 * bonus on top, and gives 3 to 6 bonus points to share out among the
 * attributes. It raises the most health can be, not the health itself;
 * fatigue and spell points come from the attributes, so they grow only with
 * the points.
 */
export function levelUp(p: PlayerStats, random: Random, hero: Hero = DEFAULT_HERO): number {
  let gained = 0;
  while (p.experience >= experienceFor(p.level + 1, hero.experience)) {
    p.level++;
    gained++;
    p.healthRolls.push(1 + Math.floor(random() * hero.healthDie));
    p.bonusPoints += 3 + Math.floor(random() * 4);
  }
  if (gained) p.maxHealth = maxHealthFor(p, hero.healthBonus);
  return gained;
}

/**
 * Max health with Endurance counting back over every level: the health the
 * character started with, each level's roll of the hit die, and Endurance's
 * bonus as it is now for every level, the first included. (Arena adds the
 * bonus as it stands at each level, so raising Endurance late counts for
 * little; here it counts for all of them.)
 */
export function maxHealthFor(p: Pick<PlayerStats, 'baseHealth' | 'healthRolls' | 'level'>, healthBonus: number): number {
  return Math.max(1, p.baseHealth + healthBonus * p.level + p.healthRolls.reduce((sum, r) => sum + r, 0));
}

/** What `now` out of `max` becomes when the most is `to`: anything more is had at once, and never more than the most. */
export function raiseTo(now: number, max: number, to: number): number {
  return Math.min(to, now + Math.max(0, to - max));
}

/** Uses stamina if there is any; returns false (using none) when the player is out of breath. */
export function spendStamina(p: PlayerStats, amount: number): boolean {
  if (p.stamina <= 0) return false;
  p.stamina = Math.max(0, p.stamina - amount);
  return true;
}

/**
 * Recovers stamina once the player has stopped using it for a moment, and
 * slowly heals when nothing has hurt them recently.
 */
export function recover(p: PlayerStats, dt: number, sinceStaminaUse: number, sinceHurt: number, recovery = 1): void {
  if (sinceStaminaUse > STAMINA_PAUSE) p.stamina = Math.min(p.maxStamina, p.stamina + STAMINA_REGEN * recovery * dt);
  if (sinceHurt > HEALTH_PAUSE && p.health > 0) p.health = Math.min(p.maxHealth, p.health + HEALTH_REGEN * dt);
}

/** Drinks a healing potion if there is one and it would help. */
export function drinkPotion(p: PlayerStats): boolean {
  if (p.potions <= 0 || p.health >= p.maxHealth || p.health <= 0) return false;
  p.potions--;
  p.health = Math.min(p.maxHealth, p.health + POTION_HEALS);
  return true;
}

/** Whether a blow with a bow, or with another weapon, may be a critical hit (see Hero.criticalWith). */
export function mayCrit(hero: Hero, bow: boolean): boolean {
  return hero.critical > 0 && (hero.criticalWith === 'bows') === bow;
}

/** What a Ranger's level adds to a blow on a creature: nothing on the undead (by the creature's number), nor for anyone else. */
export function levelDamage(hero: Hero, level: number, creature: number | undefined, undead: number[]): number {
  return hero.levelDamage && !(creature !== undefined && undead.includes(creature)) ? level : 0;
}

/** Chance per blow that bashing a locked door breaks it open. */
export function bashChance(lockLevel: number): number {
  return Math.min(0.3, Math.max(0.05, 0.3 - lockLevel / 50));
}
