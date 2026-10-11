/**
 * The player's character, made as in Arena: a class, a gender, a name, a
 * race (chosen by the province they come from), eight attributes rolled and
 * topped up with bonus points, and a face. Pure logic so it can be unit
 * tested; the screens that ask for each choice are in ui/creation.ts.
 *
 * The classes, races and words come from the player's own game when they can
 * be read (formats/classes.ts, formats/creation.ts). Otherwise the remake
 * uses three classes and plain words of its own. Attributes, health, gold
 * and what the character sheet shows are rolled and worked out as in Arena
 * (OpenTESArena's reading of it); turning them into chances in a fight
 * (heroFor) is partly the remake's own.
 */
import type { CharacterTables, ClassInfo, CreationTexts, RaceInfo } from '../formats/classes';
import type { ClassChooser, Question } from '../formats/creation';
import type { GameMessages } from '../formats/messages';
import { COLD, MAGIC, POISON, to256, type Hero, type Random, type WeaponKnack } from './combat';
import { regainsMagicka, startingMagicka } from './magic';

export type Gender = 'male' | 'female';

/** The attributes, in the game's order. */
export const STRENGTH = 0;
export const INTELLIGENCE = 1;
export const WILLPOWER = 2;
export const AGILITY = 3;
export const SPEED = 4;
export const ENDURANCE = 5;
export const PERSONALITY = 6;
export const LUCK = 7;
export const ATTRIBUTE_COUNT = 8;
/** The races, in the game's order. */
export const BRETON = 0;
export const REDGUARD = 1;
export const NORD = 2;
export const DARK_ELF = 3;
export const HIGH_ELF = 4;
export const WOOD_ELF = 5;
export const KHAJIIT = 6;
export const ARGONIAN = 7;
/** Classes whose places in the game's list Arena's rules go by. */
export const ACROBAT = 9;
export const MONK = 12;
export const ARCHER = 13;
export const RANGER = 14;
export const KNIGHT = 17;
/** No attribute goes above this, bonus points included. */
export const ATTRIBUTE_MAX = 100;
/** Faces each race has to choose from. */
export const FACES = 10;

export interface Character {
  name: string;
  gender: Gender;
  /** Place in the race list, 0 to 7. */
  race: number;
  /** Place in the class list. */
  cls: number;
  /** The eight attributes, bonus points included, in the game's order. */
  attributes: number[];
  /** Which of the race's faces, 0 to 9. */
  face: number;
  /** Health and gold rolled at creation; missing for characters made before they were. */
  health?: number;
  gold?: number;
}

/** Everything character creation needs, from the game or the remake's own fallbacks. */
export interface CreationData {
  classes: ClassInfo[];
  races: RaceInfo[];
  attributes: string[];
  texts: CreationTexts;
  /** "%ss cannot equip this item.": %s class. */
  cannotEquip: string;
  /** The questions that pick a class; empty when the game's are missing. */
  questions: Question[];
  /** Which class a tally of answers leads to (CLASSES.DAT). */
  chooser?: ClassChooser;
  /** Groups of name pieces (NAMECHNK.DAT). */
  names?: string[][];
  /** Each race's description (TEMPLATE.DAT #1409 to #1416), in the races' order. */
  raceLore?: string[];
  /** Each race's starting attributes by gender, from the program (see raceAttributes). */
  raceAttributes?: number[][];
  /** The words around the attributes, the game's or the remake's. */
  sheet: SheetTexts;
}

/** What the game says around rolling the attributes. */
export interface SheetTexts {
  /** Before the race's description. */
  knowYe: string;
  /** Asks what to do with the attributes once the points are shared out. */
  choose: string;
  save: string;
  reroll: string;
  /** Said when the points are not all shared out. */
  distributeAll: string;
}

const FALLBACK_SHEET: SheetTexts = {
  knowYe: 'Know this too:',
  choose: 'Keep these attributes?',
  save: 'Keep',
  reroll: 'Roll again',
  distributeAll: 'Share out all your bonus points first.',
};

/** The remake's own classes, for when the game's can't be read. */
export const FALLBACK_CLASSES: ClassInfo[] = [
  { name: 'Warrior', id: 16, healthDie: 15, experience: 1100, spellcaster: false, critical: true, thief: false, armour: 0, shields: [0, 1, 2, 3], needs: 'mighty and tough' },
  {
    name: 'Mage',
    id: 0,
    healthDie: 7,
    experience: 1100,
    spellcaster: true,
    critical: false,
    thief: false,
    armour: 3,
    shields: [],
    weapons: [0, 1],
    needs: 'learned and strong of will',
  },
  {
    name: 'Thief',
    id: 10,
    healthDie: 11,
    experience: 1100,
    spellcaster: false,
    critical: true,
    thief: true,
    armour: 2,
    shields: [0],
    weapons: [1, 2, 3, 4, 5, 7, 8, 11],
    needs: 'nimble and quick of hand',
  },
];

export const FALLBACK_RACES: RaceInfo[] = [
  { name: 'Breton', plural: 'Bretons', province: 'High Rock' },
  { name: 'Redguard', plural: 'Redguards', province: 'Hammerfell' },
  { name: 'Nord', plural: 'Nords', province: 'Skyrim' },
  { name: 'Dark Elf', plural: 'Dark Elves', province: 'Morrowind' },
  { name: 'High Elf', plural: 'High Elves', province: 'Summerset Isle' },
  { name: 'Wood Elf', plural: 'Wood Elves', province: 'Valenwood' },
  { name: 'Khajiit', plural: 'Khajiit', province: 'Elsweyr' },
  { name: 'Argonian', plural: 'Argonians', province: 'Black Marsh' },
];

export const FALLBACK_ATTRIBUTES = ['Strength', 'Intelligence', 'Willpower', 'Agility', 'Speed', 'Endurance', 'Personality', 'Luck'];

/** The remake's own words for each step, with the same names in the same places as the game's. */
export const FALLBACK_TEXTS: CreationTexts = {
  method: 'Choose your class from the list, or answer some questions and let the answers choose it for you.',
  questions: 'Answer each question as your character would.',
  name: 'What name will your %s go by?',
  gender: 'Is your character a man or a woman?',
  race: 'Where was %s the %s born?',
  classResult: 'Your answers suit the %s best.',
  home: 'You come from %s, among the %s. Is that your home?',
  knownAs: 'So be it: the %s %s of %s, kin to the %s.',
  needs: 'To do well you must be %s, as every %s is.',
  farewell: 'Your story begins in a cell beneath the Imperial City. Find a way out.',
  distribute: 'Share out your bonus points among your attributes.',
  appearance: 'Choose how you look. Click your face to change it.',
};

const FALLBACK_CANNOT_EQUIP = 'A %s cannot use that.';

/** Gathers the game's character tables and creation files, filling gaps with the remake's own. */
export function creationData(
  tables: CharacterTables | undefined,
  files: { questions?: Question[]; chooser?: ClassChooser; names?: string[][]; raceLore?: string[] } = {},
  program: { raceAttributes?: number[][]; messages?: GameMessages } = {},
): CreationData {
  const m = program.messages ?? {};
  return {
    classes: tables?.classes ?? FALLBACK_CLASSES,
    races: tables?.races ?? FALLBACK_RACES,
    attributes: tables?.attributes ?? FALLBACK_ATTRIBUTES,
    texts: tables?.texts ?? FALLBACK_TEXTS,
    cannotEquip: tables?.cannotEquip ?? FALLBACK_CANNOT_EQUIP,
    // Without the game's classes, the game's answers would lead to classes that aren't there.
    questions: tables ? (files.questions ?? []) : [],
    chooser: tables ? files.chooser : undefined,
    names: files.names,
    raceLore: tables ? files.raceLore : undefined,
    raceAttributes: tables ? program.raceAttributes : undefined,
    sheet: {
      knowYe: m.knowYe ?? FALLBACK_SHEET.knowYe,
      choose: m.chooseStats ?? FALLBACK_SHEET.choose,
      save: m.saveStats ?? FALLBACK_SHEET.save,
      reroll: m.rerollStats ?? FALLBACK_SHEET.reroll,
      distributeAll: m.distributeAll ?? FALLBACK_SHEET.distributeAll,
    },
  };
}

/**
 * Puts names into one of the creation texts in order, and speaks of a woman
 * as "her" where the game's text says "his".
 */
export function fillText(text: string, slots: string[], gender: Gender = 'male'): string {
  let i = 0;
  let out = text.replace(/%s/g, () => slots[i++] ?? '');
  if (gender === 'female') out = out.replace(/\b([Hh])is\b/g, (_, h: string) => (h === 'H' ? 'Her' : 'her'));
  return out;
}

// ---- Attributes ----
//
// Checked against the original running in DOSBox (88 rolled sheets) and its
// program: Arena keeps attributes on a scale of 0 to 255 and shows them out of
// 100; each starts at the race's value for the gender plus a dice roll, and
// the sheet's other numbers are worked out from them as below.

/** Starting attributes, 0 to 255, when the game's own table can't be read: the remake's own, 40 out of 100 across the board. */
const FALLBACK_RACE_ATTRIBUTES = Array.from({ length: ATTRIBUTE_COUNT }, () => 102);

/** The race's starting attributes for the gender, 0 to 255, from the game's table when there is one. */
export function raceAttributes(race: number, gender: Gender, table?: number[][]): number[] {
  const row = table?.[race * 2 + (gender === 'female' ? 1 : 0)];
  return row?.length === ATTRIBUTE_COUNT ? [...row] : [...FALLBACK_RACE_ATTRIBUTES];
}

/** A whole number from 0 to 65535, the size of what Arena's own random numbers give. */
function next(random: Random): number {
  return Math.floor(random() * 0x10000) & 0xffff;
}

/** 0 to n - 1. */
function below(n: number, random: Random): number {
  return next(random) % n;
}

/**
 * Arena's dice (its program at 0x161D2): up to 8, a plain roll from 0 to
 * n - 1; above that, n is split into dice of six or five (going up from n
 * until one divides it), each counting 0 to its size, rolled again whenever
 * the total comes to more than n. 20 is four dice of 0 to 5; 25 is five.
 */
export function arenaRoll(n: number, random: Random): number {
  if (n <= 0) return 0;
  for (;;) {
    let total: number;
    if (n <= 8) total = below(n, random);
    else {
      let m = n;
      while (m % 6 !== 0 && m % 5 !== 0) m++;
      const sides = m % 6 === 0 ? 6 : 5;
      total = 0;
      for (let i = 0; i < m / sides; i++) total += below(sides + 1, random);
    }
    if (total <= n) return total;
  }
}


export { to256 };

/** Arena's 0 to 255 to the 100 the sheet shows, rounded. */
export function to100(raw: number): number {
  return Math.floor((raw * 100 + 128) / 256);
}

const ATTRIBUTE_ROLL = 20;
const BONUS_ROLL = 25;

export interface AttributeRoll {
  /** Out of 100, as the sheet shows them. */
  attributes: number[];
  /** Points to share out on top. */
  bonus: number;
  /** The class's hit die, rolled for the health to start with (see startingHealth), and the gold, rolled with the attributes. */
  healthRoll: number;
  gold: number;
}

/**
 * Rolls a character as Arena does: each attribute is the race's plus a roll
 * of 20 and one more, on Arena's scale; 25 is rolled for the bonus points;
 * the class's hit die for health; and gold is 50 to 199.
 */
export function rollAttributes(race: number, gender: Gender, cls: ClassInfo, random: Random, table?: number[][]): AttributeRoll {
  const attributes = raceAttributes(race, gender, table).map((raw) => to100(Math.min(255, raw + to256(arenaRoll(ATTRIBUTE_ROLL, random) + 1))));
  return {
    attributes,
    bonus: arenaRoll(BONUS_ROLL, random),
    healthRoll: arenaRoll(cls.healthDie, random),
    gold: 50 + below(150, random),
  };
}

/**
 * 25 plus the hit die's roll plus Endurance's health bonus, those two
 * counting at least 1. Arena works it out once the bonus points are shared
 * out (its program at 0x1446A), so with Endurance as it ends up.
 */
export function startingHealth(healthRoll: number, healthBonus: number): number {
  return 25 + Math.max(1, healthRoll + healthBonus);
}

/** How many more points the attributes can take before every one is at 100: Arena gives no more bonus points than that. */
export function attributeRoom(attributes: number[]): number {
  return attributes.reduce((room, a) => room + Math.max(0, ATTRIBUTE_MAX - a), 0);
}

/** The values the character sheet shows beside the attributes. */
export interface DerivedAttributes {
  /** From Strength. */
  damage: number;
  maxKilos: number;
  /** From Willpower. */
  magicDefence: number;
  /** From Agility. */
  toHit: number;
  toDefend: number;
  /** From Endurance: health each level adds on top of the hit die, and how quickly wounds heal. */
  health: number;
  healMod: number;
  /** From Personality. */
  charisma: number;
}

/**
 * The sheet's numbers, as the original shows them for every roll seen:
 * Strength's damage and Endurance's health on Arena's own scale, as its
 * program works them out ((Strength - 122) / 13 and (Endurance - 116) / 25,
 * at 0x14F61 and 0x14FD5); the others a step for every five points from 50,
 * each cut toward zero. OpenTESArena's versions hold some of these at 0 or
 * -1 below a point; the original doesn't.
 */
export function derivedAttributes(a: number[]): DerivedAttributes {
  // Adding 0 turns -0 into 0.
  const step = (v: number, from: number, every: number) => Math.trunc((v - from) / every) + 0;
  const health = step(to256(a[ENDURANCE]), 116, 25);
  return {
    damage: step(to256(a[STRENGTH]), 122, 13),
    maxKilos: a[STRENGTH] * 2,
    magicDefence: step(a[WILLPOWER], 50, 5),
    toHit: step(a[AGILITY], 50, 5),
    toDefend: step(a[AGILITY], 50, 5),
    health,
    healMod: health,
    charisma: step(a[PERSONALITY], 50, 5),
  };
}

/** Fatigue (the remake's stamina): Strength plus Endurance. */
export function maxFatigue(a: number[]): number {
  return a[STRENGTH] + a[ENDURANCE];
}

/**
 * Each race's knack with weapons, as the manual gives it: Redguards with
 * anything but bows, a point of damage every 3 levels; Dark Elves with any
 * weapon, every 4; Wood Elves with bows, every 3. (Arena's program has the
 * Redguard's and the Wood Elf's weapons the other way round, and counts
 * daggers with bows; the remake goes by the manual.)
 */
const KNACKS: Record<number, WeaponKnack> = {
  [REDGUARD]: { levels: 3, weapons: 'melee' },
  [DARK_ELF]: { levels: 4, weapons: 'any' },
  [WOOD_ELF]: { levels: 3, weapons: 'bows' },
};

/**
 * One of Arena's saves, a chance out of 100 of failing it, from its value on
 * Arena's scale: the program turns it into a percentage at creation, but
 * from the first level up keeps it as it is (its program at 0x12DC1 and
 * 0x1503B). Below nothing counts as nothing here; Arena reads it as a chance
 * over 100, so a save that strong would always fail.
 */
export function saveChance(raw: number, levelled = false): number {
  return Math.max(0, levelled ? raw : to100(raw));
}

/**
 * The saves against fire, cold, poison, shock and magic. Arena's program
 * leaves fire, cold and shock at nothing, so those are always saved against;
 * poison's is a quarter of Endurance, and magic's is how far Willpower falls
 * short of the middle of its scale.
 */
export function saves(a: number[], levelled = false): number[] {
  const poison = saveChance(to256(a[ENDURANCE]) >> 2, levelled);
  const magic = saveChance(128 - to256(a[WILLPOWER]), levelled);
  return [0, 0, poison, 0, magic];
}

/**
 * What the character brings to a fight, worked out from their race, class
 * and attributes. `levelled` once they have gone up a level, which changes
 * how Arena keeps their saves (see saveChance).
 */
export function heroFor(character: Character, cls: ClassInfo, { levelled = false } = {}): Hero {
  const a = character.attributes;
  const d = derivedAttributes(a);
  const race = character.race;
  const s = saves(a, levelled);
  // The remake's own rules turn the sheet's steps into chances: a step is five points of Agility or Luck.
  // Arena keeps what Luck does hidden; UESP says it nudges nearly everything (fights, locks, bargains), so here
  // it adds a little to picking locks, critical hits and the gold found.
  const step = (i: number) => Math.trunc((a[i] - 50) / 5);
  return {
    cls,
    // A character from before health was rolled at creation gets the die's highest.
    health: character.health ?? 25 + cls.healthDie,
    stamina: maxFatigue(a),
    healthDie: cls.healthDie,
    healthBonus: d.health,
    healMod: d.healMod,
    experience: cls.experience,
    damageBonus: d.damage,
    knack: KNACKS[race],
    levelDamage: cls.id === RANGER,
    agility: to256(a[AGILITY]),
    evasive: cls.id === MONK || cls.id === ACROBAT,
    willpower: to256(a[WILLPOWER]),
    saves: s,
    resists: race === NORD ? COLD : race === BRETON ? MAGIC : undefined,
    shrugsOff: cls.id === MONK,
    // High Elves and Knights can't be paralysed.
    paralysis: race === HIGH_ELF || cls.id === KNIGHT ? 0 : s[POISON],
    // Arena's base speed: 20 plus up to 20 more for Speed (OpenTESArena's getBaseSpeed), against the remake's walk at 40.
    pace: (20 + Math.trunc((Math.trunc((a[SPEED] * 256) / 100) * 20) / 256)) / 30,
    recovery: 0.8 + a[WILLPOWER] * 0.004,
    critical: cls.critical ? Math.max(0.02, 0.08 + 0.01 * step(LUCK)) : 0,
    // Arena's Archers land critical hits only with bows, and every other class only with other weapons.
    criticalWith: cls.id === ARCHER ? 'bows' : 'melee',
    lockpicking: cls.thief ? Math.max(0.1, 0.35 + 0.05 * d.toHit + 0.02 * step(LUCK)) : 0,
    fortune: Math.max(0.5, 1 + 0.05 * step(LUCK)),
    carry: d.maxKilos,
    magicka: startingMagicka(cls, a[INTELLIGENCE]),
    regainsMagicka: regainsMagicka(cls),
    // OpenTESArena's values for the original: everyone swims at half speed and 30 times their usual tiring, Argonians at full speed and 12 times.
    swimPace: race === ARGONIAN ? 1 : 0.5,
    swimTiring: race === ARGONIAN ? 12 / 30 : 1,
    // Arena's program lets Khajiit and Acrobats climb a pit's walls four times as fast.
    climbPace: race === KHAJIIT || cls.id === ACROBAT ? 4 : 1,
    // An Acrobat's jumps go twice as high and last twice as long, as in Arena's program (0x2852B).
    leap: cls.id === ACROBAT ? 2 : 1,
    gold: character.gold,
  };
}

// ---- Choosing a class ----

/** `count` questions picked at random, in random order. */
export function pickQuestions(questions: Question[], count: number, random: Random): Question[] {
  const pool = [...questions];
  const picked: Question[] = [];
  while (picked.length < count && pool.length) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return picked;
}

/** The class the answers lead to: `paths` holds each answer's path (0 warrior, 1 thief, 2 mage). */
export function classFromAnswers(paths: number[], data: CreationData): number {
  const counts = [0, 1, 2].map((p) => paths.filter((x) => x === p).length);
  const chosen = data.chooser?.(counts);
  if (chosen !== undefined && chosen < data.classes.length) return chosen;
  // Without the game's table, the path most answers took.
  const path = counts.indexOf(Math.max(...counts));
  return Math.max(0, data.classes.findIndex((c) => c.name === ['Warrior', 'Thief', 'Mage'][path]));
}

// ---- Keeping the character ----

const STORAGE_KEY = 'es-arena.character';

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function saveCharacter(character: Character, cls: ClassInfo, store = storage()): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify({ ...character, className: cls.name }));
  } catch {
    // Private windows may refuse; the character then lasts until the page closes.
  }
}

/** The character made last time, if it is still a valid one for these classes and races. */
export function loadCharacter(data: CreationData, store = storage()): Character | undefined {
  let saved: Partial<Character> & { className?: string };
  try {
    saved = JSON.parse(store?.getItem(STORAGE_KEY) ?? 'null') ?? {};
  } catch {
    return undefined;
  }
  const byName = data.classes.findIndex((c) => c.name === saved.className);
  const cls = byName >= 0 ? byName : saved.cls;
  const whole = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < max;
  const attributes = saved.attributes;
  if (
    typeof saved.name !== 'string' ||
    !saved.name.trim() ||
    (saved.gender !== 'male' && saved.gender !== 'female') ||
    !whole(saved.race, data.races.length) ||
    !whole(cls, data.classes.length) ||
    !whole(saved.face, FACES) ||
    !Array.isArray(attributes) ||
    attributes.length !== ATTRIBUTE_COUNT ||
    !attributes.every((v) => whole(v, ATTRIBUTE_MAX + 1))
  ) {
    return undefined;
  }
  const character: Character = { name: saved.name.trim().slice(0, 32), gender: saved.gender, race: saved.race!, cls: cls!, attributes: [...attributes], face: saved.face! };
  if (whole(saved.health, 1000) && saved.health! > 0) character.health = saved.health;
  if (whole(saved.gold, 100000)) character.gold = saved.gold;
  return character;
}

export function forgetCharacter(store = storage()): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}
