/**
 * Combat numbers: dice, hit chances and the player's health, stamina and
 * gear. Pure logic so it can be unit tested.
 *
 * Damage, health and levels come from the game's own tables (see
 * formats/exe.ts). How often blows land is the remake's own rule, kept
 * simple in the spirit of Arena: the higher level side hits more often.
 * The player's swings always connect, as in Skyrim. What the character's
 * class and attributes add is worked out in character.ts.
 */
import type { ClassInfo } from '../formats/classes';
import { arenaRoll } from './character';

export type Random = () => number;

/** A whole number from min to max, both included. */
export function roll(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Chance that a creature's blow lands on the player, less the player's knack for dodging. */
export function creatureHitChance(creatureLevel: number, playerLevel: number, dodge = 0): number {
  return Math.min(0.9, Math.max(0.2, 0.55 + 0.05 * (creatureLevel - playerLevel) - dodge));
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
}

/** What the player's character brings to a fight; see character.ts. */
export interface Hero {
  /** The class, for what it may use; none means anything goes. */
  cls?: ClassInfo;
  /** Health and stamina at level 1. */
  health: number;
  stamina: number;
  /** Each level adds 1 to healthDie health, plus healthBonus (but always at least 1). */
  healthDie: number;
  healthBonus: number;
  /** Experience needed for level 2; each level after needs twice as much again. */
  experience: number;
  /** Added to every blow. */
  damageBonus: number;
  /** Taken off creatures' chance to land a blow. */
  dodge: number;
  /** Multiplies walking and running speed. */
  pace: number;
  /** Multiplies how fast stamina comes back. */
  recovery: number;
  /** Chance that a blow is a critical hit, doing double damage. */
  critical: number;
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
  dodge: 0,
  pace: 1,
  recovery: 1,
  critical: 0,
  lockpicking: 0,
  fortune: 1,
  carry: 200,
  magicka: 0,
  regainsMagicka: true,
  swimPace: 0.5,
  swimTiring: 1,
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
  };
}

/**
 * Experience needed to reach a level, as in Arena each level needs twice
 * the last: with 1,000 for level 2, 3,000 for 3, 7,000 for 4 and so on.
 */
export function experienceFor(level: number, base = DEFAULT_HERO.experience): number {
  return level <= 1 ? 0 : base * (2 ** (level - 1) - 1);
}

/** Adds experience and raises the player's level as often as it allows (see levelUp); returns how many levels were gained. */
export function gainExperience(p: PlayerStats, amount: number, random: Random, hero: Hero = DEFAULT_HERO): number {
  p.experience += amount;
  return levelUp(p, random, hero);
}

/**
 * Raises the player's level as often as their experience allows; returns how
 * many levels were gained. Each level adds health and refills it, fatigue and
 * spell points (which, as in Arena, don't grow with level).
 */
export function levelUp(p: PlayerStats, random: Random, hero: Hero = DEFAULT_HERO): number {
  let gained = 0;
  while (p.experience >= experienceFor(p.level + 1, hero.experience)) {
    p.level++;
    gained++;
    // As at creation: a roll of the hit die (Arena's dice) and Endurance's bonus, at least 1. Fatigue
    // comes from Strength and Endurance alone, so it doesn't grow with level.
    p.maxHealth += Math.max(1, arenaRoll(hero.healthDie, random) + hero.healthBonus);
    p.health = p.maxHealth;
    p.stamina = p.maxStamina;
    p.magicka = p.maxMagicka;
  }
  return gained;
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

/** Chance per blow that bashing a locked door breaks it open. */
export function bashChance(lockLevel: number): number {
  return Math.min(0.3, Math.max(0.05, 0.3 - lockLevel / 50));
}
