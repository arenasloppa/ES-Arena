/**
 * Camping, as Arena does it (OpenTESArena's reading of the original): the
 * player rests a number of hours or until fully healed, time passes 600
 * times as fast, and six times a second health, fatigue and spell points
 * come back by Arena's rest formulas. It can't begin with monsters near or
 * anywhere but on the ground, and each hour monsters may come upon the
 * resting player, which ends it. Pure logic, so it can be unit tested; the
 * dungeon (dungeon.ts) runs it and the wait menu (ui/waitMenu.ts) starts it.
 */
import type { EncounterTables } from '../formats/exe';
import { rollClassic } from './character';
import type { Random } from './combat';
import { cellIndex } from './grid';
import { isBlocking, type Level } from './level';

/** Game seconds that pass in a real one: a day takes about 110 minutes (OpenTESArena's ArenaClockUtils). */
export const GAME_SECONDS_PER_SECOND = 86400 / 6646.153846153846;
/** While camping, time passes this many times as fast. */
export const CAMPING_TIME_SCALE = 600;
/** Real seconds between each bit of healing while camping. */
export const RECOVERY_TICK = 1 / 6;
/** Monsters this near (in voxels) keep the player from camping. */
export const SAFE_SLEEP_DISTANCE = 8;
/** Arena's place for a main quest dungeon, such as the Imperial Dungeons, in its encounter tables. */
export const MAIN_QUEST_DUNGEON = 2;
/** Added to the place for its chance while resting. */
const RESTING = 5;
/** The encounter list a dungeon uses (OpenTESArena's getEncounterParameters leaves it at 7 there). */
const DUNGEON_ENCOUNTERS = 7;
/** Highest level encounters are scaled to. */
const MAX_ENCOUNTER_LEVEL = 20;
/** OpenTESArena: the class (Healer, fifth in the game's list) that heals more for resting. */
const REST_HEALING_BONUS: Record<string, number> = { Healer: 20 };

/** The numbers resting changes. */
export interface Resting {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  magicka: number;
  maxMagicka: number;
}

export interface Rester {
  /** The class's name, for its rest bonus. */
  className?: string;
  /** Endurance's heal mod (character.ts, derivedAttributes). */
  healMod: number;
  /** Spell points come back with rest; a Sorcerer's don't. */
  regainsMagicka: boolean;
}

/** On Arena's scale of 256 and back (OpenTESArena's ArenaStatUtils). */
const to256 = (v: number) => Math.trunc((v * 256) / 100);
const from256 = (v: number) => Math.round((v * 100) / 256);

/**
 * One bit of healing while camping (OpenTESArena's applyRestHealing, with a
 * rest factor of 1): health by the heal mod and the class's bonus, fatigue
 * likewise, and an eighth of the spell points.
 */
export function restHealing(p: Resting, who: Rester): void {
  const bonus = REST_HEALING_BONUS[who.className ?? ''] ?? 0;
  const heal = Math.max(1, Math.trunc((Math.trunc(p.maxHealth) * (who.healMod * 5 + 60 + bonus)) / 1000));
  p.health = Math.min(p.maxHealth, p.health + heal);
  const stamina256 = Math.trunc((to256(Math.trunc(p.maxStamina)) << 6) / 1000);
  const stamina = from256((stamina256 * (who.healMod * 5 + 70)) >> 6);
  p.stamina = Math.min(p.maxStamina, p.stamina + stamina);
  if (who.regainsMagicka && p.magicka < p.maxMagicka) p.magicka = Math.min(p.maxMagicka, p.magicka + (Math.trunc(p.maxMagicka) >> 3));
}

/** Whether resting until healed would do anything (OpenTESArena's canRestUntilHealed). */
export function needsRest(p: Resting, who: Rester): boolean {
  return p.health < p.maxHealth || p.stamina < p.maxStamina - 1 || (who.regainsMagicka && p.maxMagicka > 0 && p.magicka < p.maxMagicka);
}

/** A whole number from 0 to 65535, as Arena's random numbers are. */
function next(random: Random): number {
  return Math.floor(random() * 0x10000) & 0xffff;
}

/** The percent chance each hour of monsters coming upon the player resting here. */
export function restEncounterChance(tables: EncounterTables | undefined, place = MAIN_QUEST_DUNGEON): number {
  return tables?.chances[place + RESTING] ?? 0;
}

/**
 * Which monsters come (OpenTESArena's chooseEncounterEnemy): a level near the
 * player's, rolled lower more often than higher, then one of the two
 * entries of that level in the place's list.
 */
export function chooseEncounter(tables: EncounterTables, playerLevel: number, random: Random, list = DUNGEON_ENCOUNTERS): { count: number; id: number; level: number } | undefined {
  let level = Math.min(playerLevel + 1, MAX_ENCOUNTER_LEVEL) + (next(random) % 4);
  // Arena rolls until it gets one; the limit only guards against a broken random source.
  for (let tries = 0; ; tries++) {
    let r = rollClassic(level * 2, random);
    if (r > level) r = level * 2 - r;
    if (r >= Math.trunc(level / 2) || tries > 1000) {
      level = Math.max(r, 1);
      break;
    }
    level = (level >> 1) * 2;
  }
  if (playerLevel === 0 && level >= 2) level = next(random) % 3;
  const levels = tables.levels[list] ?? [];
  const matches: number[] = [];
  levels.forEach((l, i) => l === level && matches.length < 2 && matches.push(i));
  if (!matches.length) return undefined;
  return tables.table[matches[next(random) & 1] ?? matches[0]];
}

/**
 * Where a monster that comes upon the player appears (OpenTESArena's
 * findRandomSpawnLocationAroundPlayer): a random cell up to four away,
 * further if none will do, that is open floor and not the player's own.
 */
export function spawnSpot(level: Level, x: number, y: number, random: Random, taken: Array<{ x: number; y: number }> = []): { x: number; y: number } | undefined {
  const mine = cellIndex(level, x, y);
  // Arena shifts a signed 16-bit number down: six places reach four cells, three reach 32.
  for (const shift of [6, 3, 1]) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const delta = () => ((next(random) << 16) >> 16) / 2 ** shift / 128;
      const cx = Math.floor(x + delta()) + 0.5;
      const cy = Math.floor(y + delta()) + 0.5;
      const i = cellIndex(level, cx, cy);
      if (i < 0 || i === mine) continue;
      const cell = level.cells[i];
      if (cell.kind !== 'empty' || cell.chasm || isBlocking(cell, new Set(), i)) continue;
      if (taken.some((t) => cellIndex(level, t.x, t.y) === i)) continue;
      return { x: cx, y: cy };
    }
  }
  return undefined;
}
