/**
 * Spells: which of Arena's spells the remake can cast, what they cost, how
 * hard they hit and how long they last. Pure logic so it can be unit tested;
 * the dungeon casts them (dungeon.ts).
 *
 * The spells themselves (names, targets, elements, effects and their six
 * numbers) come from the player's own SPELLSG.65 (formats/spells.ts). What
 * the six numbers mean for each effect is as the game's own spellmaker
 * describes it in SPELLMKR.TXT, where %0 to %5 are the six numbers, e.g.
 * "%0 to %1 pts damage to health +%2 to %3 pts per %4 level(s)" and
 * "%0%% chance to paralyze. +%1%% every %4 level(s). Duration is %5 rnd(s)
 * per %2 level(s)". "Per level" counts each of the caster's levels.
 *
 * From UESP (Arena:The Known Spellbook, Arena:Classes, Arena:Magic):
 * - A round is a minute of game time, five seconds of play.
 * - Casting costs the spell's cost (half its price in gold) divided by the
 *   caster's level: Pitfalls, 600, costs a level 10 caster 60 spell points.
 * - Spell points are Intelligence times the class's multiplier; classes
 *   without one can't cast. Sorcerers never get spell points back.
 * - Wildfire's continuous damage comes every 5 rounds.
 *
 * As in Arena's program, a new spellcaster knows two spells, a healing one
 * and an offensive one (see startingSpells), and levelling teaches no more:
 * Arena sells the rest at the Mages Guild, which the remake doesn't have
 * yet. The remake's own rule, until there are cities: spell points come
 * back slowly over time (except a Sorcerer's).
 */
import { EFFECT_NAMES, ELEMENTS, type SpellEffect, type SpellRecord, type SpellTarget } from '../formats/spells';
import { roll, type Random } from './combat';

// Arena's effect numbers (see EFFECT_NAMES).
export const CAUSE = 0;
export const CONTINUOUS_DAMAGE = 1;
export const CREATE = 2;
export const CURE = 3;
export const DAMAGE = 4;
export const NON_TARGET = 5;
export const DESTROY = 6;
export const DRAIN = 9;
export const ELEMENTAL_RESISTANCE = 10;
export const FORTIFY = 11;
export const HEAL = 12;
export const TRANSFER = 13;
export const INVISIBILITY = 15;
export const LEVITATE = 16;
export const LIGHT = 17;
export const LOCK = 18;
export const OPEN = 19;
export const REGENERATE = 20;
export const SILENCE = 21;
export const SPELL_ABSORPTION = 22;
export const SPELL_REFLECTION = 23;
export const SPELL_RESISTANCE = 24;

/** Sub-effects. */
export const CAUSE_POISON = 1;
export const CAUSE_PARALYSIS = 2;
export const CURE_PARALYSIS = 2;
export const CREATE_SHIELD = 0;
export const HEALTH = 1;
export const STAMINA = 0;
export const DAMAGE_HEALTH = 0;

/** Seconds in one of Arena's rounds. */
export const ROUND = 5;
/** Rounds between the blows of continuous damage. */
export const CONTINUOUS_EVERY = 5;

/** Spell points per point of Intelligence, by class (UESP; the Spellsword's from the Elder Scrolls Wiki). */
const SPELL_POINT_MULTIPLIERS: Record<string, number> = {
  Sorcerer: 3,
  Mage: 2,
  Healer: 2,
  Battlemage: 1.75,
  Nightblade: 1.5,
  Spellsword: 1.5,
  Bard: 1,
};
/** For a spellcasting class the table doesn't know (the remake's own Mage among them). */
const DEFAULT_MULTIPLIER = 2;

/** Share of their spell points that comes back each second, after a short pause; the remake's own. */
const MAGICKA_REGEN = 0.01;
const MAGICKA_PAUSE = 2;

/** What the remake makes of one of a spell's effects. */
export type EffectSupport = 'works' | 'harmless' | 'missing';

/** Effects represented by the original guild and artifact spell records. */
export function effectSupport(e: SpellEffect): EffectSupport {
  switch (e.effect) {
    case DAMAGE: case CONTINUOUS_DAMAGE: return e.sub <= 2 ? 'works' : 'missing';
    case HEAL: return e.sub <= 3 ? 'works' : 'missing';
    case TRANSFER: return e.sub <= 1 ? 'works' : 'missing';
    case CAUSE: return e.sub <= 4 ? 'works' : 'missing';
    case CREATE: return e.sub <= 2 ? 'works' : 'missing';
    case DESTROY: return e.sub <= 1 ? 'works' : 'missing';
    case CURE: return e.sub <= 3 ? 'works' : 'missing';
    case FORTIFY: case DRAIN: return attributeIndex(e) < 8 ? 'works' : 'missing';
    case NON_TARGET: case INVISIBILITY: case LIGHT: case LEVITATE: case LOCK:
    case OPEN: case REGENERATE: case SILENCE: case ELEMENTAL_RESISTANCE:
    case SPELL_ABSORPTION: case SPELL_REFLECTION: case SPELL_RESISTANCE: return 'works';
    default: return 'missing';
  }
}

export function castable(spell: SpellRecord): boolean {
  return spell.effects.length > 0 && spell.effects.every(e => effectSupport(e) === 'works');
}
export const usable = castable;

/** Native Fortify/Drain records encode the stat in sub; Transfer encodes it in attribute. */
export function attributeIndex(e: SpellEffect): number {
  return e.effect === TRANSFER || e.effect === HEAL ? e.attribute & 7 : e.sub;
}
/** Transfer pool codes are 0x30 health, 0x31 fatigue and 0x32 spell points. */
export function transferPool(e: SpellEffect): number { return e.attribute & 15; }
export function terrainEffect(e: SpellEffect): boolean {
  return e.effect === DESTROY || e.effect === CREATE && e.sub !== CREATE_SHIELD;
}
/** Resistance sub-effects differ from the spell element numbers for shock/poison. */
export function resistedElement(sub: number): number | undefined {
  return ({0:0,1:1,2:3,4:2} as Record<number,number>)[sub];
}

/** Spell points it costs a caster of `level` to cast the spell. */
export function magickaCost(spell: SpellRecord, level: number): number {
  return Math.max(1, Math.ceil(spell.cost / Math.max(1, level)));
}

/** A character's spell points: Intelligence times the class's multiplier, none for classes that can't cast. */
export function startingMagicka(cls: { name: string; spellcaster: boolean }, intelligence: number): number {
  if (!cls.spellcaster) return 0;
  return Math.floor(intelligence * (SPELL_POINT_MULTIPLIERS[cls.name] ?? DEFAULT_MULTIPLIER));
}

/** Whether the class gets spell points back over time: a Sorcerer doesn't. */
export function regainsMagicka(cls: { name: string } | undefined): boolean {
  return cls?.name !== 'Sorcerer';
}

/** Restores health: a healing spell. */
export function heals(spell: SpellRecord): boolean {
  return spell.effects.some((e) => e.effect === HEAL && e.sub === HEALTH);
}

/** Harms what it hits. */
export function offensive(spell: SpellRecord): boolean {
  return spell.effects.some((e) => (e.effect === DAMAGE || e.effect === CONTINUOUS_DAMAGE) && e.sub === DAMAGE_HEALTH);
}

const byCost = (a: SpellRecord, b: SpellRecord) => a.cost - b.cost || a.index - b.index;

/** The places in the guild's list, counting from 0, of the two spells Arena's program gives a new caster (at 0x144EE). */
const ARENA_STARTING_SPELLS = [61, 62];

/**
 * The spells a new caster knows: the two Arena gives, by their places in the
 * list (Fire Dart and Light Heal in the game's own), or, when the remake
 * can't cast what is in those places, the cheapest healing spell and the
 * cheapest offensive one it can.
 */
export function startingSpells(spells: SpellRecord[]): SpellRecord[] {
  const arenas = ARENA_STARTING_SPELLS.map((i) => spells.find((s) => s.index === i));
  if (arenas.every((s) => s && castable(s))) return arenas as SpellRecord[];
  const cheapest = (pick: (s: SpellRecord) => boolean) => spells.filter((s) => castable(s) && pick(s)).sort(byCost)[0];
  return [cheapest(heals), cheapest(offensive)].filter((s): s is SpellRecord => !!s);
}

/** "per %4 level(s)": how many times the per-level part counts at `level`; none when the number is 0. */
function per(level: number, every: number): number {
  return every > 0 ? Math.floor(level / every) : 0;
}

/** Damage or healing: %0 to %1, plus %2 to %3 per %4 levels. */
export function magnitude(e: SpellEffect, level: number, random: Random): number {
  const [min, max, perMin, perMax, every] = e.params;
  let total = roll(random, Math.min(min, max), Math.max(min, max));
  for (let i = per(level, every); i > 0; i--) total += roll(random, Math.min(perMin, perMax), Math.max(perMin, perMax));
  return total;
}

/** The range magnitude() rolls in, for showing the player. */
export function magnitudeRange(e: SpellEffect, level: number): [number, number] {
  const [min, max, perMin, perMax, every] = e.params;
  const n = per(level, every);
  return [Math.min(min, max) + n * Math.min(perMin, perMax), Math.max(min, max) + n * Math.max(perMin, perMax)];
}

/** "%0, +%1 per %4 levels": a chance in percent, shield points or rounds. */
export function amount(e: SpellEffect, level: number): number {
  const [base, step, , , every] = e.params;
  return base + step * per(level, every);
}

/** A chance in percent, from 0 to 100. */
export function chance(e: SpellEffect, level: number): number {
  return Math.max(0, Math.min(100, amount(e, level)));
}

/** Rounds an effect lasts at the caster's level, as SPELLMKR.TXT gives each; 0 for effects that don't last. */
export function durationRounds(e: SpellEffect, level: number): number {
  const [, , p2, , p4, p5] = e.params;
  switch (e.effect) {
    case CAUSE:
      // Paralysis: "%5 rnd(s) per %2 level(s)"; poison and the rest: "%5 rnd(s) per level".
      return e.sub === CAUSE_PARALYSIS ? p5 * per(level, p2) : p5 * level;
    case NON_TARGET:
    case SILENCE:
    case LOCK:
    case SPELL_ABSORPTION:
    case SPELL_RESISTANCE:
      return p5 * per(level, p2);
    case TRANSFER:
      return p5 + e.params[1]*per(level,p4);
    case CONTINUOUS_DAMAGE:
      return p5;
    case INVISIBILITY:
    case LEVITATE:
      return amount(e, level);
    case LIGHT:
      return p5 * level;
    case REGENERATE:
      return p4 * level;
    case FORTIFY:
    case DRAIN:
      // "+%0 pts of %c for %5 rnds per level, loss %1 pts per %4 rnds"
      return p5 * level;
    case ELEMENTAL_RESISTANCE:
    case SPELL_REFLECTION:
      return p5 * per(level, p2);
    default:
      return 0;
  }
}

/** Fortify: points added to the attribute, and how many it loses every so many rounds. */
export function fortification(e: SpellEffect): { points: number; loss: number; everyRounds: number } {
  return { points: e.params[0], loss: e.params[1], everyRounds: Math.max(1, e.params[4]) };
}

/** Seconds an effect lasts at the caster's level. */
export function duration(e: SpellEffect, level: number): number {
  return durationRounds(e, level) * ROUND;
}

/** Poison: "Damage is %2 pts per %3 rnd(s)". */
export function poisonDamage(e: SpellEffect): { damage: number; everyRounds: number } {
  return { damage: e.params[2], everyRounds: Math.max(1, e.params[3]) };
}

/** Regenerate: "%0 health points every %1 rnd(s)". */
export function regeneration(e: SpellEffect): { health: number; everyRounds: number } {
  return { health: e.params[0], everyRounds: Math.max(1, e.params[1]) };
}

/** Light: how far the dungeon can be seen, as a multiple of the usual, from the light's power (%0). */
export function lightReach(e: SpellEffect): number {
  return 1 + Math.max(1, e.params[0]) * 0.25;
}

export interface Magicka {
  magicka: number;
  maxMagicka: number;
}

/** Spell points come back once the player has not cast for a moment. */
export function recoverMagicka(p: Magicka, dt: number, sinceCast: number, recovery = 1): void {
  if (sinceCast > MAGICKA_PAUSE) p.magicka = Math.min(p.maxMagicka, p.magicka + p.maxMagicka * MAGICKA_REGEN * recovery * dt);
}

const TARGET_WORDS: Record<SpellTarget, string> = {
  caster: 'Caster',
  touch: 'Touch',
  target: 'Target',
  areaCaster: 'Area around caster',
  areaTarget: 'Area at target',
  walls: 'Walls',
};

const POOLS = ['health', 'fatigue', 'spell points'];
const ATTRIBUTE_NAMES = ['Strength', 'Intelligence', 'Willpower', 'Agility', 'Speed', 'Endurance', 'Personality', 'Luck'];
/** What Cure and Elemental Resistance work against, by sub-effect. */
const CURES = ['disease', 'poison', 'paralysis', 'curse'];
const RESISTED: Record<number, string> = { 0: 'fire', 1: 'cold', 2: 'shock', 4: 'poison' };

/** A line for each effect of the spell at the caster's level, as the magic menu shows them. */
export function describe(spell: SpellRecord, level: number): string[] {
  const range = (e: SpellEffect) => {
    const [lo, hi] = magnitudeRange(e, level);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  };
  const rounds = (e: SpellEffect) => `${durationRounds(e, level)} rounds`;
  return spell.effects.map((e) => {
    switch (e.effect) {
      case DAMAGE:
        return `${range(e)} damage to ${POOLS[e.sub] ?? 'health'}`;
      case CONTINUOUS_DAMAGE:
        return `${range(e)} damage to ${POOLS[e.sub] ?? 'health'} every ${CONTINUOUS_EVERY} rounds for ${rounds(e)}`;
      case HEAL:
        return `Restores ${range(e)} ${['fatigue','health','spell points',ATTRIBUTE_NAMES[attributeIndex(e)]][e.sub]}`;
      case TRANSFER:
        return `Transfers ${e.params[0]} ${e.sub === 0 ? ATTRIBUTE_NAMES[attributeIndex(e)] : POOLS[transferPool(e)]} from the target to you`;
      case CAUSE:
        if (e.sub === CAUSE_PARALYSIS) return `${chance(e, level)}% chance to paralyze for ${rounds(e)}`;
        if (e.sub === CAUSE_POISON) {
          const p = poisonDamage(e);
          return `${chance(e, level)}% chance to poison: ${p.damage} damage every ${p.everyRounds} rounds for ${rounds(e)}`;
        }
        return `${chance(e, level)}% chance to cause ${['disease','poison','paralysis','curse','death'][e.sub]}${e.sub === 4 ? '' : ` for ${rounds(e)}`}`;
      case CREATE:
        return e.sub === 0 ? `${amount(e, level)} hit point shield` : `Create ${e.params[0]} ${e.sub === 1 ? 'wall' : 'floor'} sections; aim and interact to place each`;
      case DESTROY:
        return `Remove ${e.params[0]} ${e.sub === 0 ? 'wall' : 'floor'} sections; aim and interact to select each`;
      case LEVITATE:
        return `Levitate above pits and water for ${rounds(e)}`;
      case LOCK:
        return `${Math.min(100,e.params[0])}% chance to lock the door for ${rounds(e)}; lock strength ${e.params[1]*per(level,e.params[4])}%`;
      case NON_TARGET:
        return `${chance(e, level)}% chance to be ignored for ${rounds(e)}`;
      case INVISIBILITY:
        return `Invisible for ${rounds(e)}`;
      case LIGHT:
        return `Light for ${rounds(e)}`;
      case OPEN:
        return `${chance(e, level)}% chance to open a locked door`;
      case REGENERATE: {
        const r = regeneration(e);
        return `Regenerates ${r.health} health every ${r.everyRounds} rounds for ${rounds(e)}`;
      }
      case SILENCE:
        return `${chance(e, level)}% chance to silence for ${rounds(e)}`;
      case CURE:
        return `${chance(e, level)}% chance to cure ${CURES[e.sub] ?? 'ailments'}`;
      case ELEMENTAL_RESISTANCE:
        return `Resist ${RESISTED[e.sub] ?? 'the elements'} by ${amount(e, level)}% for ${rounds(e)}`;
      case SPELL_ABSORPTION:
        return `${chance(e, level)}% chance to absorb spells as spell points for ${rounds(e)}`;
      case SPELL_RESISTANCE:
        return `${chance(e, level)}% chance to resist spells for ${rounds(e)}`;
      case SPELL_REFLECTION:
        return `${chance(e, level)}% chance to reflect spells for ${rounds(e)}`;
      case DRAIN:
        return `Drains ${e.params[0]} ${ATTRIBUTE_NAMES[attributeIndex(e)]}, recovering ${e.params[1]} every ${Math.max(1,e.params[4])} rounds, for ${rounds(e)}`;
      case FORTIFY: {
        const f = fortification(e);
        return `${ATTRIBUTE_NAMES[attributeIndex(e)] ?? 'An attribute'} +${f.points}, losing ${f.loss} every ${f.everyRounds} rounds, for up to ${rounds(e)}`;
      }
      default:
        return EFFECT_NAMES[e.effect] ?? 'Unknown';
    }
  });
}

/** "Fire", "Cold" ...; undefined for spells of no element. */
export function elementName(spell: SpellRecord): string | undefined {
  return ELEMENTS[spell.element];
}

/** Where the spell goes. */
export function targetWords(spell: SpellRecord): string {
  return TARGET_WORDS[spell.target];
}

export const spellKey = (spell: SpellRecord) => `spell:${spell.index}`;
