/**
 * Combat numbers: dice, hit chances and the player's health, stamina and
 * gear. Pure logic so it can be unit tested.
 *
 * Damage, health and levels come from the game's own tables (see
 * formats/exe.ts). How often blows land is the remake's own rule, kept
 * simple in the spirit of Arena: the higher level side hits more often.
 * The player's swings always connect, as in Skyrim.
 */

export type Random = () => number;

/** A whole number from min to max, both included. */
export function roll(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Chance that a creature's blow lands on the player. */
export function creatureHitChance(creatureLevel: number, playerLevel: number): number {
  return Math.min(0.9, Math.max(0.2, 0.55 + 0.05 * (creatureLevel - playerLevel)));
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
  gold: number;
  potions: number;
  /** Key numbers carried; each opens the locks of the same level. */
  keys: Set<number>;
  weapon: Weapon;
}

export const POTION_HEALS = 25;
const STAMINA_REGEN = 22; // per second, after a short pause
const STAMINA_PAUSE = 0.8;
const HEALTH_REGEN = 0.25; // per second, out of a fight
const HEALTH_PAUSE = 6;

export function newPlayerStats(weapon: Weapon): PlayerStats {
  return { level: 1, experience: 0, health: 30, maxHealth: 30, stamina: 100, maxStamina: 100, gold: 0, potions: 0, keys: new Set(), weapon };
}

/** Experience needed to reach a level: 1,000 for level 2, 3,000 for 3, 6,000 for 4 and so on. */
export function experienceFor(level: number): number {
  return level <= 1 ? 0 : 500 * level * (level - 1);
}

/**
 * Adds experience and raises the player's level as often as it allows;
 * returns how many levels were gained. Each level adds health and stamina
 * and refills both.
 */
export function gainExperience(p: PlayerStats, amount: number, random: Random): number {
  p.experience += amount;
  let gained = 0;
  while (p.experience >= experienceFor(p.level + 1)) {
    p.level++;
    gained++;
    p.maxHealth += roll(random, 4, 8);
    p.maxStamina += 10;
    p.health = p.maxHealth;
    p.stamina = p.maxStamina;
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
export function recover(p: PlayerStats, dt: number, sinceStaminaUse: number, sinceHurt: number): void {
  if (sinceStaminaUse > STAMINA_PAUSE) p.stamina = Math.min(p.maxStamina, p.stamina + STAMINA_REGEN * dt);
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
