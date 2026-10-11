/**
 * Spells: which of Arena's spells the remake can cast, what they cost, how
 * hard they hit and how long they last. Pure logic so it can be unit tested;
 * the dungeon casts them (dungeon.ts).
 *
 * The spells themselves (names, targets, elements, effects and their
 * numbers) come from the player's own SPELLSG.65 (formats/spells.ts). Each
 * effect has six numbers. Damage and healing read them as Arena's
 * spellmaker shows them: lowest to highest, plus lowest to highest again
 * for every so many of the caster's levels. Other effects take the first
 * as a base, the second as what each so many levels add (the fifth number),
 * and the sixth as a duration in rounds; which of these each effect uses is
 * a guess still to be checked against the original game.
 *
 * Magicka is the remake's own, after Skyrim: spellcasting classes have
 * twice their Intelligence, ten more each level, and it comes back over
 * time. A spell costs a fifth of the game's cost for it. Since there is no
 * Mages Guild to buy spells from yet, a spellcaster knows every spell the
 * remake can cast that costs at most half their magicka, and learns more as
 * they level up.
 */
import { EFFECT_NAMES, ELEMENTS, type SpellEffect, type SpellRecord, type SpellTarget } from '../formats/spells';
import { roll, type Random } from './combat';

// Arena's effect numbers (see EFFECT_NAMES).
export const CAUSE = 0;
export const CONTINUOUS_DAMAGE = 1;
export const CREATE = 2;
export const DAMAGE = 4;
export const NON_TARGET = 5;
export const HEAL = 12;
export const TRANSFER = 13;
export const INVISIBILITY = 15;
export const LIGHT = 17;
export const OPEN = 19;
export const REGENERATE = 20;
export const SILENCE = 21;

/** Sub-effects. */
export const CAUSE_POISON = 1;
export const CAUSE_PARALYSIS = 2;
export const CREATE_SHIELD = 0;
export const HEALTH = 1;
export const STAMINA = 0;
export const DAMAGE_HEALTH = 0;

/** Seconds in one of Arena's rounds, for spells that last; the remake's own. */
export const ROUND = 5;
/** Rounds a spell shield lasts, if not used up; the remake's own. */
export const SHIELD_ROUNDS = 12;
/** Rounds a regeneration lasts; the remake's own. */
export const REGENERATE_ROUNDS = 6;
/** Health a poison takes each round; the remake's own. */
export const POISON_DAMAGE = 2;

/** Magicka per point of Intelligence, for spellcasting classes. */
export const MAGICKA_PER_INTELLIGENCE = 2;
/** Share of their magicka that comes back each second, after a short pause. */
const MAGICKA_REGEN = 0.02;
const MAGICKA_PAUSE = 1.5;
const COST_DIVISOR = 5;

/** What the remake makes of one of a spell's effects. */
export type EffectSupport = 'works' | 'harmless' | 'missing';

/**
 * Whether the remake can do an effect yet. Some do nothing to the
 * creatures of the dungeons, which have no stamina, magicka or spells of
 * their own; a spell with only those can't be cast, but they don't stop
 * one that also does something else.
 */
export function effectSupport(e: SpellEffect): EffectSupport {
  switch (e.effect) {
    case DAMAGE:
      return e.sub === DAMAGE_HEALTH ? 'works' : 'harmless';
    case CONTINUOUS_DAMAGE:
      return e.sub === DAMAGE_HEALTH ? 'works' : 'harmless';
    case HEAL:
      return e.sub === HEALTH || e.sub === STAMINA ? 'works' : 'missing';
    case TRANSFER:
      return e.sub === HEALTH ? 'works' : 'missing';
    case CAUSE:
      return e.sub === CAUSE_PARALYSIS || e.sub === CAUSE_POISON ? 'works' : 'missing';
    case CREATE:
      return e.sub === CREATE_SHIELD ? 'works' : 'missing';
    case SILENCE:
      return 'harmless';
    case NON_TARGET:
    case INVISIBILITY:
    case LIGHT:
    case OPEN:
    case REGENERATE:
      return 'works';
    default:
      return 'missing';
  }
}

/** True when the remake can cast the spell: every effect is one it does, or harmless, and one at least does something. */
export function castable(spell: SpellRecord): boolean {
  if (spell.target === 'walls') return false;
  const support = spell.effects.map(effectSupport);
  return support.includes('works') && !support.includes('missing');
}

/** Magicka a spell costs. */
export function magickaCost(spell: SpellRecord): number {
  return Math.max(1, Math.ceil(spell.cost / COST_DIVISOR));
}

/** A character's magicka at level 1: none for classes that can't cast. */
export function startingMagicka(spellcaster: boolean, intelligence: number): number {
  return spellcaster ? Math.max(10, Math.round(intelligence * MAGICKA_PER_INTELLIGENCE)) : 0;
}

/** The spells a caster with this much magicka knows, cheapest first. */
export function knownSpells(spells: SpellRecord[], maxMagicka: number): SpellRecord[] {
  if (maxMagicka <= 0) return [];
  return spells
    .filter((s) => castable(s) && magickaCost(s) <= maxMagicka / 2)
    .sort((a, b) => magickaCost(a) - magickaCost(b) || a.index - b.index);
}

/** How many times the "per level" part of an effect counts at `level`. */
function steps(level: number, every: number): number {
  return every > 0 ? Math.floor(level / every) : 0;
}

/** Damage or healing: lowest to highest, plus lowest to highest again for every so many levels. */
export function magnitude(e: SpellEffect, level: number, random: Random): number {
  const [min, max, perMin, perMax, every] = e.params;
  let total = roll(random, Math.min(min, max), Math.max(min, max));
  for (let i = steps(level, every); i > 0; i--) total += roll(random, Math.min(perMin, perMax), Math.max(perMin, perMax));
  return total;
}

/** The range magnitude() rolls in, for showing the player. */
export function magnitudeRange(e: SpellEffect, level: number): [number, number] {
  const [min, max, perMin, perMax, every] = e.params;
  const n = steps(level, every);
  return [Math.min(min, max) + n * Math.min(perMin, perMax), Math.max(min, max) + n * Math.max(perMin, perMax)];
}

/** An effect's base number plus what the caster's levels add: a chance in percent, an amount or a number of rounds. */
export function amount(e: SpellEffect, level: number): number {
  const [base, per, , , every] = e.params;
  return base + per * steps(level, every);
}

/** Rounds an effect with a chance lasts (the sixth number), at least one. */
export function rounds(e: SpellEffect): number {
  return Math.max(1, e.params[5]);
}

/** Seconds an effect lasts at the caster's level. */
export function duration(e: SpellEffect, level: number): number {
  switch (e.effect) {
    case INVISIBILITY:
      return Math.max(1, amount(e, level)) * ROUND;
    case CREATE:
      return SHIELD_ROUNDS * ROUND;
    case REGENERATE:
      return REGENERATE_ROUNDS * ROUND;
    case LIGHT:
      return (e.params[5] || 6) * ROUND;
    default:
      return rounds(e) * ROUND;
  }
}

/** Light: how far the dungeon can be seen, as a multiple of the usual. */
export function lightReach(e: SpellEffect): number {
  return 1 + Math.max(1, e.params[0]) * 0.25;
}

export interface Magicka {
  magicka: number;
  maxMagicka: number;
}

/** Magicka comes back once the player has not cast for a moment. */
export function recoverMagicka(p: Magicka, dt: number, sinceCast: number, recovery = 1): void {
  if (sinceCast > MAGICKA_PAUSE) p.magicka = Math.min(p.maxMagicka, p.magicka + p.maxMagicka * MAGICKA_REGEN * recovery * dt);
}

const TARGET_WORDS: Record<SpellTarget, string> = {
  caster: 'on yourself',
  touch: 'on touch',
  target: 'on a target',
  areaCaster: 'all around you',
  areaTarget: 'in an area at the target',
  walls: 'on walls',
};

/** A line for each effect of the spell, as the magic menu shows them. */
export function describe(spell: SpellRecord, level: number): string[] {
  const range = (e: SpellEffect) => {
    const [lo, hi] = magnitudeRange(e, level);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  };
  const secs = (e: SpellEffect) => `${Math.round(duration(e, level))}s`;
  return spell.effects.map((e) => {
    const name = EFFECT_NAMES[e.effect] ?? 'Unknown';
    switch (e.effect) {
      case DAMAGE:
        return e.sub === DAMAGE_HEALTH ? `Damage health ${range(e)}` : `Damage ${e.sub === 2 ? 'magicka' : 'stamina'} ${range(e)}`;
      case CONTINUOUS_DAMAGE:
        return `Damage health ${range(e)} each ${ROUND}s for ${secs(e)}`;
      case HEAL:
        return `Restore ${e.sub === HEALTH ? 'health' : 'stamina'} ${range(e)}`;
      case TRANSFER:
        return `Absorb health ${amount(e, level)}`;
      case CAUSE:
        return e.sub === CAUSE_PARALYSIS
          ? `Paralyze for ${secs(e)}, ${chance(e, level)}% chance`
          : e.sub === CAUSE_POISON
            ? `Poison for ${secs(e)}, ${chance(e, level)}% chance`
            : name;
      case CREATE:
        return `Shield of ${amount(e, level)} points for ${secs(e)}`;
      case NON_TARGET:
        return `Blows miss you ${chance(e, level)}% of the time for ${secs(e)}`;
      case INVISIBILITY:
        return `Invisible for ${secs(e)}`;
      case LIGHT:
        return `Light for ${secs(e)}`;
      case OPEN:
        return `Open a lock, ${chance(e, level)}% chance`;
      case REGENERATE:
        return `Regain ${Math.max(1, amount(e, level))} health each ${ROUND}s for ${secs(e)}`;
      case SILENCE:
        return 'Silence';
      default:
        return name;
    }
  });
}

/** A chance in percent, from 0 to 100. */
export function chance(e: SpellEffect, level: number): number {
  return Math.max(0, Math.min(100, amount(e, level)));
}

/** "Fire", "Cold" ...; undefined for spells of no element. */
export function elementName(spell: SpellRecord): string | undefined {
  return ELEMENTS[spell.element];
}

/** Where the spell goes, in words. */
export function targetWords(spell: SpellRecord): string {
  return TARGET_WORDS[spell.target];
}

export const spellKey = (spell: SpellRecord) => `spell:${spell.index}`;
