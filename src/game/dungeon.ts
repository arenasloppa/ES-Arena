/**
 * One run through a dungeon: the player, the creatures, the doors and the
 * loot, and the rules that tie them together. Pure logic (no Three.js and no
 * sound) so it can be unit tested. The engine feeds it input every frame,
 * draws what it holds and plays out the events it leaves in `events`.
 *
 * Fighting works as in Skyrim: a click swings (each swing in a different
 * direction), holding the button makes a power attack that costs stamina
 * and does double damage, and every swing hits whatever is in front within
 * reach. Blocking takes most of the sting out of blows from the front for
 * stamina, and attacking while blocking bashes. Striking a creature that
 * has not noticed the player sneaking does triple damage. Worn armour takes
 * blows down, and the player's class and attributes (the Hero) change how
 * hard they hit, how often they are hit, how fast they move and more.
 * Monster stats, weapon damage and sounds come from the player's own game;
 * the loot rules are the remake's own.
 *
 * Magic works as in Skyrim's hands with Arena's spells (see magic.ts): a
 * spell readied from the magic menu takes the place of the guard, so the
 * block button casts it. Spells on the caster work at once, touch spells on
 * the creature in reach, and the rest fly as a bolt that bursts on what it
 * hits; area spells catch every creature near the burst. How fast bolts
 * fly and how wide the areas are is the remake's own.
 */
import type { ExeData, WeaponInfo } from '../formats/exe';
import type { SpellRecord } from '../formats/spells';
import {
  bashChance,
  DEFAULT_HERO,
  drinkPotion,
  gainExperience,
  newPlayerStats,
  recover,
  roll,
  spendStamina,
  type Hero,
  type PlayerStats,
  type Random,
  type Weapon,
} from './combat';
import {
  CREATURE_RADIUS,
  hurtCreature,
  isAlive,
  isCalm,
  paralyseCreature,
  spawnCreature,
  staggerCreature,
  updateCreature,
  type Creature,
  type CreatureEvents,
  type CreatureWorld,
} from './creatures';
import { Exploration } from './explore';
import {
  castable,
  CAUSE,
  CAUSE_PARALYSIS,
  CAUSE_POISON,
  chance,
  CONTINUOUS_DAMAGE,
  CONTINUOUS_EVERY,
  CREATE,
  DAMAGE,
  DAMAGE_HEALTH,
  duration,
  HEAL,
  HEALTH,
  INVISIBILITY,
  LIGHT,
  lightReach,
  magickaCost,
  magnitude,
  nextSpell,
  NON_TARGET,
  offensive,
  OPEN,
  poisonDamage,
  recoverMagicka,
  REGENERATE,
  regeneration,
  ROUND,
  spellKey,
  startingSpells,
  TRANSFER,
  amount,
} from './magic';
import { armourReduce, Inventory, itemKey, POTION, randomGear, startingGear, weaponOf, type Item, type NewItem } from './items';
import { Quest, type Objective } from './quest';
import { cellIndex, lineOfSight } from './grid';
import { isBlocking, type DoorSounds, type Level, type LevelItem } from './level';
import { airborne, groundUnder, inChasm, jump, PLAYER_RADIUS, playerBlocked, settle, step, type Body, type PlayerState } from './player';
import type { GameMessages } from '../formats/messages';
import type { CreatureInfo, EncounterTables } from '../formats/exe';
import {
  CAMPING_TIME_SCALE,
  chooseEncounter,
  GAME_SECONDS_PER_SECOND,
  needsRest,
  RECOVERY_TICK,
  restEncounterChance,
  restHealing,
  SAFE_SLEEP_DISTANCE,
  spawnSpot,
  type Rester,
} from './camping';

export interface DoorState {
  /** 0 closed to 1 open. */
  open: number;
  /** Where it is heading: 0 or 1. */
  target: number;
}

export interface DungeonItem extends LevelItem {
  id: number;
  /** Picked up: no longer drawn. */
  taken?: boolean;
  /** Bodies and chests stay where they are once searched. */
  searched?: boolean;
}

export type SwingKind = 'right' | 'left' | 'downRight' | 'downLeft' | 'chop' | 'thrust';

export interface Swing {
  kind: SwingKind;
  power: boolean;
  /** A shove made while blocking: no damage, but it staggers. */
  bash?: boolean;
  /** Seconds since it began. */
  time: number;
  duration: number;
  /** Set once the blow has landed (or met nothing). */
  struck: boolean;
}

export type TargetKind = 'door' | 'exit' | 'item' | 'body';

/** One line in the item menus: a piece of gear, the healing potions, or the keys. */
export interface MenuEntry {
  /** What use(), favourite() and setHotkey() take. */
  key: string;
  name: string;
  category: 'weapons' | 'apparel' | 'potions' | 'misc' | 'spells';
  count: number;
  item?: Item;
  spell?: SpellRecord;
  equipped: boolean;
  favourite: boolean;
  /** The number key it is on, 0 for 1. */
  hotkey?: number;
}

/** Something in front of the player that they can use. */
export interface Target {
  kind: TargetKind;
  /** Cell index for doors and exits, the item's id, or the creature's id. */
  id: number;
  name: string;
  verb: string;
  /** A second line, such as "Locked". */
  note?: string;
}

export type DungeonEvent =
  /** A sound from a place in the level; no place means the player's own. */
  | { type: 'sound'; name: string; at?: { x: number; y: number }; volume?: number }
  /** One of the dungeon's own messages. */
  | { type: 'message'; text: string }
  /** A short note in the corner, as Skyrim's "Key added". */
  | { type: 'notify'; text: string }
  | { type: 'swing'; swing: Swing }
  | { type: 'hurt'; damage: number }
  /** A blow taken on the player's guard; `damage` is what got through. */
  | { type: 'blocked'; damage: number }
  | { type: 'hit'; creature: Creature; damage: number; killed: boolean }
  | { type: 'bashed'; creature: Creature }
  | { type: 'levelUp'; level: number; health: number; stamina: number }
  /** A spell cast; the engine plays the cast and flashes the hand. */
  | { type: 'cast'; spell: SpellRecord }
  /** A spell bursting where it hit; `radius` is the area it catches, 0 for one creature. */
  | { type: 'burst'; spell: SpellRecord; at: { x: number; y: number }; radius: number }
  /** Not enough spell points to cast; the HUD flashes the magicka bar. */
  | { type: 'noMagicka' }
  | { type: 'questStarted'; name: string }
  | { type: 'objective'; text: string; done: boolean }
  /** Every creature in the dungeon is dead. */
  | { type: 'cleared' }
  /** Camping began; the game shows the hours as they pass (see campingText). */
  | { type: 'camping' }
  /** Camping ended, with the game's words for why when there are some. */
  | { type: 'camped'; text?: string }
  /** A monster came upon the player; the engine draws it from now on. */
  | { type: 'spawned'; creature: Creature }
  /** Ria Silmane comes to the sleeping player (see Dungeon.camp). */
  | { type: 'dream'; visions: Vision[] }
  /** The player died; `cause` is the game's words for how, when it has some (drowning). */
  | { type: 'died'; cause?: string }
  | { type: 'escaped' };

/**
 * Ria's visions in the player's dreams: the Staff of Chaos (TEMPLATE.DAT
 * #1500) and where its first piece lies, Fang Lair (#1294).
 */
export type Vision = 'staffIntro' | 'fangLair';

/** What camping says when the game's own words can't be read. */
const CAMP_WORDS = {
  enemiesNearby: 'Monsters are too close to rest.',
  campingNotAllowed: 'You cannot rest here.',
  fullyRested: 'You are already rested.',
  doneWakeUp: 'You wake.',
  doneHealed: 'You are rested.',
  enemiesWhileResting: 'Monsters are upon you!',
  hourPassed: '%u hour passed',
  hoursPassed: '%u hours passed',
  hourRemaining: '%u hour left',
  hoursRemaining: '%u hours left',
};

export interface DungeonInput {
  /** -1..1 each; sneaking and sprinting are applied here. */
  forward: number;
  strafe: number;
  sprint: boolean;
  sneaking: boolean;
  /** The block button is held. */
  block: boolean;
  /** The attack button: held now, and whether it went down or came up since the last update. */
  attack: { held: boolean; pressed: boolean; released: boolean };
}

export const IDLE_INPUT: DungeonInput = {
  forward: 0,
  strafe: 0,
  sprint: false,
  sneaking: false,
  block: false,
  attack: { held: false, pressed: false, released: false },
};

const DOOR_SPEED = 1.6; // of a full opening per second
const SNEAK_PACE = 0.5;
/** How close the player comes to a solid decoration's middle. */
const SOLID_FLAT_RADIUS = 0.3;
const BLOCK_PACE = 0.6;
const SPRINT_STAMINA = 12; // per second
const POWER_STAMINA = 20;
const BASH_STAMINA = 15;
const BASH_TIME = 0.3;
/** Each blow taken on the guard costs this much stamina; with none left, blows go straight through. */
const BLOCK_STAMINA = 10;
/** Share of a blocked blow's damage that still gets through. */
const BLOCK_LEAK = 0.35;
/** Blows from further round than this to either side get past the guard. */
const BLOCK_ARC = (70 * Math.PI) / 180;
export const SNEAK_ATTACK = 3;
/** Holding attack this long makes a power attack. */
const POWER_HOLD = 0.32;
const SWING_TIME = 0.4;
const POWER_SWING_TIME = 0.6;
/** Point of the swing, as a fraction of it, where the blow lands. */
const HIT_AT = 0.5;
/** A pause this long between swings starts the combo over. */
const COMBO_RESET = 1;
const COMBO: SwingKind[] = ['right', 'left', 'downRight', 'downLeft'];
/** From the player's centre to a creature's. */
const WEAPON_REACH = 1.35;
const WEAPON_ARC = Math.PI / 4;
const USE_REACH = 1.4;
const ITEM_REACH = 1.6;
const ITEM_ARC = Math.PI / 6;
const LOOK_EVERY = 0.15;
const STRIDE = 1.1;
/** Seconds between tries at picking the same lock. */
const PICK_TIME = 1.2;
/**
 * The weapon to fight with when the game's weapon table can't be read (and
 * then the dungeon has no monsters either). Its numbers are the remake's own.
 */
const DEFAULT_WEAPON: Weapon = { name: 'Shortsword', damage: [2, 6], cif: 'SWORD.CIF' };
/** A character of their own starts with these, as well as their gear (and gold, unless rolled at creation). */
const START_POTIONS = 1;
const START_GOLD = 25;
/**
 * Swimming tires the player: Arena's waking loss of 11/64 fatigue a game
 * minute, at 13 game seconds a real one, 30 times over, on its 0-256 scale
 * (OpenTESArena's reading); about 0.44 points a second.
 */
const SWIM_TIRING = ((11 / 64) * (86400 / 6646.153846153846)) / 60 * 30 * (100 / 256);
/** Lava burns 10 health a second (OpenTESArena). */
const LAVA_BURN = 10;
/** Pushing forward against the edge this long starts a climb out of water or a pit. */
const CLIMB_PUSH = 0.25;
/**
 * Seconds a climb out takes. UESP says getting out of water "takes a few
 * precious seconds" and a blow, or attacking, throws you back in; the
 * exact times are the remake's own.
 */
const CLIMB_WATER = 2;
const CLIMB_PIT = 4;
/** Seconds after casting before another spell can be cast. */
const CAST_TIME = 0.7;
/** Spell bolts fly this many voxels a second, and give up this far away. */
const BOLT_SPEED = 7;
const BOLT_RANGE = 25;
export const BOLT_RADIUS = 0.12;
/** How far a spell's area reaches from its burst, and from the caster. */
export const AREA_RADIUS = 1.5;
export const AREA_AROUND_CASTER = 2.5;
/** Touch spells, and the Open spell, reach this far. */
const TOUCH_REACH = 1.4;
const OPEN_REACH = 2.5;

/** A spell flying through the dungeon. */
export interface Bolt {
  id: number;
  spell: SpellRecord;
  x: number;
  y: number;
  dx: number;
  dy: number;
  travelled: number;
}

/** Harm a spell keeps doing to a creature: poison or continuous damage, a blow every so many seconds. */
interface Affliction {
  creature: Creature;
  spell: SpellRecord;
  /** Damage of each blow: a fixed number, or the effect to roll. */
  damage: number | SpellRecord['effects'][number];
  every: number;
  next: number;
  until: number;
}

export class Dungeon {
  readonly player: PlayerState;
  readonly stats: PlayerStats;
  readonly creatures: Creature[] = [];
  readonly items: DungeonItem[];
  readonly doors = new Map<number, DoorState>();
  readonly openDoors = new Set<number>();
  readonly explored: Exploration;
  /** Things that happened since the engine last looked; it empties this. */
  readonly events: DungeonEvent[] = [];
  /** The swing in progress. */
  swing?: Swing;
  outcome?: 'dead' | 'escaped';
  /** Seconds of play. */
  time = 0;
  kills = 0;
  /** How far the player has walked, for footsteps and the weapon's sway. */
  walked = 0;
  /** Holding the guard up; the engine draws the weapon raised. */
  blocking = false;
  sneaking = false;
  /** Sprinting this moment, for the camera's widening view. */
  running = false;
  /** In water or lava. */
  swimming = false;
  /** Climbing out of water or a pit: how far along (0 to 1), and where it ends. */
  climb?: { progress: number; seconds: number; from: number; to: { x: number; y: number } };
  /** Objectives toward the way out; undefined in a dungeon without one. */
  readonly quest?: Quest;
  /** The gear the player carries and wears. */
  readonly inventory: Inventory;
  /** The spells the player knows, cheapest first. */
  readonly spellbook: SpellRecord[] = [];
  /** The spell in hand, cast with the block button. */
  readied?: SpellRecord;
  /** Spells in flight. */
  readonly bolts: Bolt[] = [];
  /** Game seconds since the game began; time passes 13 times as fast as play, and 600 times faster again while camping. */
  clock = 0;
  /** Resting: hours left (or, until healed, hours so far) and the time to the next bit of healing. */
  camping?: { hoursLeft?: number; hoursPassed: number; tick: number };
  /** Ria has shown the player the Staff in a dream. */
  dreamt = false;

  private readonly weaponTable: WeaponInfo[];
  private readonly unlocked = new Set<number>();
  private readonly pickedAt = new Map<number, number>();
  private readonly lockTried = new Set<number>();
  private readonly shownTexts = new Set<number>();
  private readonly searchedBodies = new Set<number>();
  private readonly world: CreatureWorld;
  private readonly growlAt = new Map<number, number>();
  private here = -1;
  private sinceStamina = Infinity;
  private pushing = 0;
  private readonly messages: GameMessages;
  private readonly encounters?: EncounterTables;
  private readonly creatureInfo: CreatureInfo[];
  private sinceHurt = Infinity;
  private lookTimer = 0;
  private nextStep = STRIDE;
  private armedAt: number | undefined;
  private queued: boolean | undefined;
  private combo = 0;
  private lastSwingEnd = -Infinity;
  private moving = false;
  private cleared = false;
  private sprintHeld = false;
  private readonly allSpells: SpellRecord[];
  private nextBolt = 0;
  private sinceCast = Infinity;
  private castHeld = false;
  private readonly afflictions: Affliction[] = [];
  /** Spells working on the player: when each ends (seconds of play) and what it holds. */
  private shieldPoints = 0;
  private sanctuary = { chance: 0, until: 0 };
  private invisibleUntil = 0;
  private light = { reach: 1, until: 0 };
  private regen = { health: 0, every: 0, next: 0, until: 0 };

  /**
   * `hero` is what the player's character brings; without one, the player
   * has no class and plain numbers. `spells` is the game's spell list, from
   * which a spellcaster knows some.
   */
  constructor(
    readonly level: Level,
    tables: ExeData | undefined,
    private readonly random: Random = Math.random,
    readonly hero: Hero = DEFAULT_HERO,
    spells: SpellRecord[] = [],
  ) {
    this.player = { x: level.start.x, y: level.start.y, yaw: initialYaw(level), pitch: 0, z: 0, vz: 0 };
    this.messages = tables?.messages ?? {};
    this.encounters = tables?.encounters;
    this.creatureInfo = tables?.creatures ?? [];
    this.weaponTable = tables?.weapons ?? [];
    this.inventory = new Inventory(hero.cls, tables?.character?.cannotEquip);
    for (const gear of startingGear(this.weaponTable, hero.cls)) this.inventory.equip(this.inventory.add(gear));
    const held = this.inventory.weapon;
    this.stats = newPlayerStats(held ? weaponOf(held) : DEFAULT_WEAPON, hero);
    if (hero.cls) {
      this.stats.potions = START_POTIONS;
      this.stats.gold = hero.gold ?? START_GOLD;
    }
    this.allSpells = spells;
    if (hero.magicka > 0) {
      this.spellbook.push(...startingSpells(spells));
      this.readied = this.spellbook.find(offensive) ?? this.spellbook[0];
      for (const s of this.spellbook) this.inventory.toggleFavourite(spellKey(s));
    }
    this.items = level.items.map((item, id) => ({ ...item, id }));
    level.cells.forEach((c, i) => {
      if (c.kind === 'door') this.doors.set(i, { open: 0, target: 0 });
    });
    if (tables) {
      for (const s of level.creatures) {
        const info = tables.creatures[s.type];
        if (info) this.creatures.push(spawnCreature(this.creatures.length, info, s.x, s.y, random));
      }
    }
    this.explored = new Exploration(level);
    this.quest = Quest.forLevel(level, this.exitName());
    this.world = {
      level,
      openDoors: this.openDoors,
      player: { x: this.player.x, y: this.player.y, level: this.stats.level, dodge: hero.dodge },
      sneaking: false,
      now: 0,
      random,
      creatures: this.creatures,
    };
    this.explored.look(this.player.x, this.player.y, this.openDoors);
  }

  update(dt: number, input: DungeonInput): void {
    this.time += dt;
    this.updateDoors(dt);
    this.sneaking = input.sneaking && !this.outcome;
    if (this.camping && !this.outcome) {
      this.updateCamping(dt);
      return;
    }
    this.clock += dt * GAME_SECONDS_PER_SECOND;
    if (!this.outcome) {
      this.move(dt, input);
      this.updateAttack(dt, input);
      this.updateCell();
      // A raised guard holds stamina from coming back.
      if (this.blocking) this.sinceStamina = 0;
      recover(this.stats, dt, this.sinceStamina, this.sinceHurt, this.hero.recovery);
      if (this.hero.regainsMagicka) recoverMagicka(this.stats, dt, this.sinceCast, this.hero.recovery);
      this.sinceCast += dt;
      this.updateMagic(dt);
      this.sinceStamina += dt;
      this.sinceHurt += dt;
      this.lookTimer -= dt;
      if (this.lookTimer <= 0) {
        this.lookTimer = LOOK_EVERY;
        this.explored.look(this.player.x, this.player.y, this.openDoors);
        this.quest?.update(this, this.events);
      }
    } else {
      this.blocking = false;
      this.running = false;
    }
    this.updateCreatures(dt, this.sneaking);
  }

  /**
   * How aware the creatures are of the player, for Skyrim's sneak eye: 0
   * hidden, rising as a creature grows suspicious, 0.6 while one hunts for
   * the player, 1 when one has them in sight.
   */
  detection(): number {
    let level = 0;
    for (const c of this.creatures) {
      if (!isAlive(c)) continue;
      if (c.state === 'chase' || c.state === 'attack') level = Math.max(level, c.unseen < 1 ? 1 : 0.6);
      else level = Math.max(level, c.awareness * 0.6);
    }
    return level;
  }

  /** The current objective's place, for the compass's quest marker. */
  get objective(): Objective | undefined {
    return this.quest?.current;
  }

  // ---- Camping ----

  /**
   * Begins camping for a number of hours or until healed, as Arena's camp
   * button does; returns the game's words for why not when it can't. Arena
   * won't let the player rest with monsters near or anywhere but on the
   * floor, nor rest until healed when there is nothing to heal. The first
   * rest at level 2 or above brings Ria to the player's dreams: the Staff of
   * Chaos and then where its first piece lies, or, as in the original, only
   * the second when the player has already reached level 3 (UESP).
   */
  camp(hours: number | 'healed'): string | undefined {
    if (this.outcome) return undefined;
    const m = this.messages;
    if (this.enemiesNear()) return m.enemiesNearby ?? CAMP_WORDS.enemiesNearby;
    if (this.swimming || this.climb || airborne(this.level, this.player)) return m.campingNotAllowed ?? CAMP_WORDS.campingNotAllowed;
    if (hours === 'healed' && !needsRest(this.stats, this.rester)) return m.fullyRested ?? CAMP_WORDS.fullyRested;
    this.camping = { hoursLeft: hours === 'healed' ? undefined : Math.max(1, Math.floor(hours)), hoursPassed: 0, tick: RECOVERY_TICK };
    this.blocking = false;
    this.running = false;
    this.swing = undefined;
    this.events.push({ type: 'camping' });
    if (!this.dreamt && this.stats.level >= 2) {
      this.dreamt = true;
      this.events.push({ type: 'dream', visions: this.stats.level >= 3 ? ['fangLair'] : ['staffIntro', 'fangLair'] });
    }
    return undefined;
  }

  /** Stops camping early, as pressing Arena's camp button again does. */
  stopCamping(text?: string): void {
    if (!this.camping) return;
    this.camping = undefined;
    this.events.push({ type: 'camped', text });
  }

  /** "3 hours remaining..." or, resting until healed, "2 hours passed....", in the game's words. */
  get campingText(): string | undefined {
    const c = this.camping;
    if (!c) return undefined;
    const m = this.messages;
    const [n, text] =
      c.hoursLeft !== undefined
        ? [c.hoursLeft, c.hoursLeft === 1 ? (m.hourRemaining ?? CAMP_WORDS.hourRemaining) : (m.hoursRemaining ?? CAMP_WORDS.hoursRemaining)]
        : [c.hoursPassed, c.hoursPassed === 1 ? (m.hourPassed ?? CAMP_WORDS.hourPassed) : (m.hoursPassed ?? CAMP_WORDS.hoursPassed)];
    return text.replace('%u', String(n));
  }

  private get rester(): Rester {
    return { className: this.hero.cls?.name, healMod: this.hero.healMod ?? 0, regainsMagicka: this.hero.regainsMagicka };
  }

  /** A living monster within Arena's safe sleeping distance. */
  private enemiesNear(): boolean {
    const p = this.player;
    return this.creatures.some((c) => isAlive(c) && Math.hypot(c.x - p.x, c.y - p.y) <= SAFE_SLEEP_DISTANCE);
  }

  private updateCamping(dt: number): void {
    const c = this.camping!;
    const m = this.messages;
    for (c.tick -= dt; c.tick <= 0 && this.camping; c.tick += RECOVERY_TICK) {
      restHealing(this.stats, this.rester);
      if (c.hoursLeft === undefined && !needsRest(this.stats, this.rester)) this.stopCamping(m.doneHealed ?? CAMP_WORDS.doneHealed);
    }
    const before = Math.floor(this.clock / 3600);
    this.clock += dt * GAME_SECONDS_PER_SECOND * CAMPING_TIME_SCALE;
    for (let hour = before; hour < Math.floor(this.clock / 3600) && this.camping; hour++) {
      if (c.hoursLeft !== undefined) {
        c.hoursLeft--;
        if (c.hoursLeft <= 0) this.stopCamping(m.doneWakeUp ?? CAMP_WORDS.doneWakeUp);
      } else c.hoursPassed++;
      this.encounter();
    }
    // The monsters go about their business meanwhile.
    this.updateCreatures(dt, false);
  }

  /**
   * Each hour of rest, monsters may come upon the player (OpenTESArena's
   * tickGameClock): not up on a platform, nor with monsters already near,
   * and at the chance Arena gives resting in a main quest dungeon. They
   * appear on open floor around the player, and if any are near enough,
   * the rest is over. Encounters of people rather than creatures (24 and
   * up) bring nobody yet: the remake has no human foes so far.
   */
  private encounter(): void {
    const tables = this.encounters;
    const cell = this.level.cells[cellIndex(this.level, this.player.x, this.player.y)];
    if (!tables || cell?.kind === 'raised' || this.enemiesNear()) return;
    if (restEncounterChance(tables) <= Math.floor(this.random() * 100)) return;
    const found = chooseEncounter(tables, this.stats.level, this.random);
    const info = found && found.id <= this.creatureInfo.length ? this.creatureInfo[found.id - 1] : undefined;
    if (!found || !info) return;
    for (let i = 0; i < found.count; i++) {
      const at = spawnSpot(this.level, this.player.x, this.player.y, this.random, this.creatures);
      if (!at) break;
      const creature = spawnCreature(this.creatures.length, info, at.x, at.y, this.random);
      this.creatures.push(creature);
      this.events.push({ type: 'spawned', creature });
    }
    if (this.camping && this.enemiesNear()) this.stopCamping(this.messages.enemiesWhileResting ?? CAMP_WORDS.enemiesWhileResting);
  }

  // ---- Moving ----

  /** Jumps, when on the floor and not in water, a pit or a climb. */
  jump(): boolean {
    if (this.outcome || this.climb || inChasm(this.level, this.player)) return false;
    return jump(this.level, this.player);
  }

  private move(dt: number, input: DungeonInput): void {
    const p = this.player;
    if (this.climb) {
      this.updateClimb(dt);
      return;
    }
    let forward = clamp(input.forward, -1, 1);
    let strafe = clamp(input.strafe, -1, 1);
    const moving = forward !== 0 || strafe !== 0;
    // Too laden to run, as in Skyrim.
    const laden = this.inventory.weight(this.stats.potions) > this.hero.carry;
    if (laden && input.sprint && moving && !this.sprintHeld) this.events.push({ type: 'notify', text: 'You are carrying too much to run' });
    this.sprintHeld = input.sprint && moving;
    let run = input.sprint && moving && this.stats.stamina > 0 && !this.blocking && !laden && !this.swimming;
    if (run) {
      spendStamina(this.stats, SPRINT_STAMINA * dt);
      this.sinceStamina = 0;
    }
    if (input.sneaking && !run) {
      forward *= SNEAK_PACE;
      strafe *= SNEAK_PACE;
    }
    if (this.blocking) {
      forward *= BLOCK_PACE;
      strafe *= BLOCK_PACE;
    }
    if (!moving) run = false;
    const bodies: Body[] = this.creatures.filter(isAlive).map((c) => ({ x: c.x, y: c.y, r: CREATURE_RADIUS }));
    const x0 = p.x;
    const y0 = p.y;
    for (const f of this.level.flats) if (f.solid) bodies.push({ x: f.x, y: f.y, r: SOLID_FLAT_RADIUS });
    const pace = this.swimming ? this.hero.swimPace : this.hero.pace;
    step(this.level, p, { forward, strafe, run, pace }, dt, this.openDoors, bodies);
    const moved = Math.hypot(p.x - x0, p.y - y0);
    this.moving = moved > 0;
    this.running = run && this.moving;
    this.walked += moved;
    this.updateHeight(dt);
    // Pushing on against the edge of water or a pit climbs out of it.
    const edge = this.swimming || inChasm(this.level, p) ? this.climbTarget() : undefined;
    if (edge && input.forward > 0.5 && moved < 0.2 * dt) {
      this.pushing += dt;
      if (this.pushing >= CLIMB_PUSH) this.startClimb(edge);
    } else this.pushing = 0;
    if (this.walked >= this.nextStep && !airborne(this.level, p)) {
      this.nextStep = this.walked + STRIDE;
      // Arena only ever plays the left footstep (OpenTESArena); swimming has its own stroke.
      if (this.swimming) this.events.push({ type: 'sound', name: 'SWIMMING.VOC', volume: 0.4 });
      else if (!input.sneaking) this.events.push({ type: 'sound', name: 'DIRTL.VOC', volume: 0.3 });
    }
  }

  /** Falls, lands, steps up, and goes into or out of water and lava, with what that does. */
  private updateHeight(dt: number): void {
    const p = this.player;
    settle(this.level, p, dt);
    const cell = this.level.cells[cellIndex(this.level, p.x, p.y)];
    const swimming = (cell?.chasm === 'wet' || cell?.chasm === 'lava') && inChasm(this.level, p);
    if (swimming && !this.swimming) this.events.push({ type: 'sound', name: 'SPLASH.VOC' });
    this.swimming = swimming;
    if (!swimming) return;
    // Swimming tires, and fatigue doesn't come back meanwhile; with none left the player drowns.
    this.stats.stamina = Math.max(0, this.stats.stamina - SWIM_TIRING * this.hero.swimTiring * dt);
    this.sinceStamina = 0;
    if (this.stats.stamina <= 0) {
      this.die(this.messages.drowning ?? 'You drown.');
      return;
    }
    if (cell?.chasm === 'lava') this.burn(LAVA_BURN * dt);
  }

  /** The point on firm ground ahead that a climb out of water or a pit would end at. */
  private climbTarget(): { x: number; y: number } | undefined {
    const p = this.player;
    const fx = Math.cos(p.yaw);
    const fy = Math.sin(p.yaw);
    for (const reach of [PLAYER_RADIUS + 0.12, PLAYER_RADIUS + 0.3]) {
      const x = p.x + fx * reach;
      const y = p.y + fy * reach;
      const i = cellIndex(this.level, x, y);
      const cell = this.level.cells[i];
      if (!cell || cell.chasm) continue;
      // Up onto the floor (or a low platform) beside, if there is room to stand there.
      const to = { x: p.x + fx * (PLAYER_RADIUS * 2 + 0.25), y: p.y + fy * (PLAYER_RADIUS * 2 + 0.25) };
      if (!playerBlocked(this.level, to.x, to.y, groundUnder(this.level, { ...p, ...to, z: 0 }), this.openDoors)) return to;
    }
    return undefined;
  }

  private startClimb(to: { x: number; y: number }): void {
    const cell = this.level.cells[cellIndex(this.level, this.player.x, this.player.y)];
    this.pushing = 0;
    this.swing = undefined;
    this.climb = { progress: 0, seconds: cell?.chasm === 'dry' ? CLIMB_PIT : CLIMB_WATER, from: this.player.z ?? 0, to };
  }

  private updateClimb(dt: number): void {
    const c = this.climb!;
    const p = this.player;
    c.progress = Math.min(1, c.progress + dt / c.seconds);
    p.z = c.from * (1 - c.progress);
    p.vz = 0;
    this.moving = false;
    if (c.progress < 1) return;
    p.x = c.to.x;
    p.y = c.to.y;
    p.z = groundUnder(this.level, p);
    this.climb = undefined;
    this.swimming = false;
  }

  /** A blow, or attacking, while climbing out throws the player back in (UESP). */
  private fallBack(): void {
    if (!this.climb) return;
    this.player.z = this.climb.from;
    this.climb = undefined;
  }

  private burn(damage: number): void {
    this.stats.health = Math.max(0, this.stats.health - damage);
    this.sinceHurt = 0;
    if (this.camping) this.stopCamping();
    if (this.stats.health <= 0) this.die();
  }

  private die(cause?: string): void {
    if (this.outcome) return;
    this.outcome = 'dead';
    this.swing = undefined;
    this.climb = undefined;
    this.events.push({ type: 'sound', name: 'MDIE.VOC' }, { type: 'died', cause });
  }

  private updateDoors(dt: number): void {
    for (const [i, door] of this.doors) {
      if (door.open === door.target) continue;
      door.open = clamp(door.open + Math.sign(door.target - door.open) * DOOR_SPEED * dt, 0, 1);
      if (door.open === 1) this.openDoors.add(i);
      const sounds = this.doorSounds(i);
      if (door.open === 0 && sounds?.closeWhenShut && sounds.close) this.events.push({ type: 'sound', name: sounds.close, at: cellCentre(this.level, i) });
    }
  }

  /** The sounds of the door in a cell, by its kind; the remake's own creak and thud for a level without them. */
  private doorSounds(cell: number): DoorSounds | undefined {
    const kind = this.level.cells[cell]?.door ?? 'raising';
    if (!this.level.doorSounds) return { open: 'OPENDOOR.VOC', close: 'CLOSDOOR.VOC', closeWhenShut: false };
    return this.level.doorSounds[kind];
  }

  /**
   * Messages and sounds for the cell the player has just walked into, as
   * Arena does: the sound each time, the text each time too unless it is one
   * to show only once ("~" in the INF).
   */
  private updateCell(): void {
    const here = cellIndex(this.level, this.player.x, this.player.y);
    if (here === this.here) return;
    this.here = here;
    this.level.triggers.forEach((t, n) => {
      if (t.y * this.level.width + t.x !== here) return;
      if (t.text && !(t.once && this.shownTexts.has(n))) {
        this.shownTexts.add(n);
        this.events.push({ type: 'message', text: t.text });
      }
      if (t.sound) this.events.push({ type: 'sound', name: t.sound, at: { x: t.x + 0.5, y: t.y + 0.5 } });
    });
  }

  // ---- Creatures ----

  private updateCreatures(dt: number, sneaking: boolean): void {
    const w = this.world;
    w.player.x = this.player.x;
    w.player.y = this.player.y;
    w.player.level = this.stats.level;
    w.sneaking = sneaking;
    w.invisible = this.invisible;
    w.now = this.time;
    for (const c of this.creatures) {
      updateCreature(c, w, dt, this.creatureEvents);
      // Now and then a hunting creature calls out.
      if (c.state === 'chase' && this.time >= (this.growlAt.get(c.id) ?? Infinity)) {
        this.growlAt.set(c.id, this.time + 4 + this.random() * 6);
        this.creatureSound(c);
      }
    }
  }

  private readonly creatureEvents: CreatureEvents = {
    notice: (c) => {
      this.creatureSound(c);
      this.growlAt.set(c.id, this.time + 3 + this.random() * 5);
    },
    swing: (c) => this.events.push({ type: 'sound', name: 'SWISH.VOC', at: { x: c.x, y: c.y }, volume: 0.5 }),
    strike: (c, damage) => {
      // Sanctuary: a chance the creature ignores the player.
      if (damage > 0 && this.time < this.sanctuary.until && this.random() * 100 < this.sanctuary.chance) return;
      if (!this.outcome && damage > 0) this.hurtPlayer(damage, c);
    },
  };

  private creatureSound(c: Creature): void {
    if (c.info.sound) this.events.push({ type: 'sound', name: c.info.sound, at: { x: c.x, y: c.y } });
  }

  private hurtPlayer(damage: number, from?: Creature): void {
    if (this.blocking && from && angleTo(this.player, from.x, from.y) <= BLOCK_ARC && spendStamina(this.stats, BLOCK_STAMINA)) {
      this.sinceStamina = 0;
      damage = Math.round(damage * BLOCK_LEAK);
      this.events.push({ type: 'blocked', damage }, { type: 'sound', name: 'CLANK.VOC', volume: 0.8 });
      if (damage <= 0) return;
    }
    if (this.shieldPoints > 0) {
      const absorbed = Math.min(damage, this.shieldPoints);
      this.shieldPoints -= absorbed;
      damage -= absorbed;
      if (this.shieldPoints <= 0) this.events.push({ type: 'notify', text: 'Your shield is gone' });
      if (damage <= 0) {
        this.events.push({ type: 'blocked', damage: 0 }, { type: 'sound', name: 'CLANK.VOC', volume: 0.6 });
        return;
      }
    }
    damage = armourReduce(damage, this.inventory.armourRating());
    this.stats.health = Math.max(0, this.stats.health - damage);
    this.sinceHurt = 0;
    this.events.push({ type: 'hurt', damage }, { type: 'sound', name: 'UHIT.VOC' });
    this.fallBack();
    if (this.stats.health <= 0) this.die();
  }

  // ---- Fighting ----

  private updateAttack(dt: number, input: DungeonInput): void {
    if (this.climb) {
      // Attacking too soon while climbing out drops the player back in.
      if (input.attack.pressed) this.fallBack();
      return;
    }
    // A readied spell takes the guard's place, as a spell in Skyrim's left hand does.
    const castPressed = input.block && !this.castHeld;
    this.castHeld = input.block;
    if (this.readied) {
      if (castPressed) this.cast(this.readied);
      input = { ...input, block: false };
    }
    const a = input.attack;
    if (input.block) {
      // Attacking with the guard up is a bash.
      this.armedAt = this.queued = undefined;
      if (a.pressed && !this.swing) this.bash();
    } else {
      if (a.pressed) this.armedAt = this.time;
      if (this.armedAt !== undefined) {
        if (a.released || !a.held) {
          this.armedAt = undefined;
          this.attack(false);
        } else if (this.time - this.armedAt >= POWER_HOLD) {
          this.armedAt = undefined;
          this.attack(true);
        }
      }
    }
    const s = this.swing;
    if (s) {
      s.time += dt;
      if (!s.struck && s.time >= s.duration * HIT_AT) {
        s.struck = true;
        this.strike(s);
      }
      if (s.time >= s.duration) {
        this.swing = undefined;
        this.lastSwingEnd = this.time;
      }
    }
    if (!this.swing && this.queued !== undefined) {
      const power = this.queued;
      this.queued = undefined;
      this.startSwing(power);
    }
    this.blocking = input.block && !this.swing;
  }

  private bash(): void {
    if (!spendStamina(this.stats, BASH_STAMINA)) return;
    this.sinceStamina = 0;
    this.swing = { kind: 'thrust', power: false, bash: true, time: 0, duration: BASH_TIME, struck: false };
    this.events.push({ type: 'swing', swing: this.swing }, { type: 'sound', name: 'SWISH.VOC', volume: 0.7 });
  }

  /** Swings now, or straight after the swing in progress. */
  private attack(power: boolean): void {
    if (this.swing) this.queued = power;
    else this.startSwing(power);
  }

  private startSwing(power: boolean): void {
    if (power && spendStamina(this.stats, POWER_STAMINA)) this.sinceStamina = 0;
    else power = false;
    if (this.time - this.lastSwingEnd > COMBO_RESET) this.combo = 0;
    // A power attack on the move lunges forward; standing, it chops down.
    const kind: SwingKind = power ? (this.moving ? 'thrust' : 'chop') : COMBO[this.combo++ % COMBO.length];
    this.swing = { kind, power, time: 0, duration: power ? POWER_SWING_TIME : SWING_TIME, struck: false };
    this.events.push({ type: 'swing', swing: this.swing }, { type: 'sound', name: 'SWISH.VOC' });
  }

  /** The moment a swing lands: on a creature in front, else on a door or wall. */
  private strike(s: Swing): void {
    const target = this.creatureInReach();
    if (s.bash) {
      if (!target) return;
      staggerCreature(target, this.world, this.player);
      this.events.push({ type: 'bashed', creature: target }, { type: 'sound', name: 'BASH.VOC', at: { x: target.x, y: target.y }, volume: 0.7 });
      return;
    }
    if (target) {
      let damage = Math.max(1, roll(this.random, ...this.stats.weapon.damage) + this.hero.damageBonus) * (s.power ? 2 : 1);
      if (this.hero.critical > 0 && this.random() < this.hero.critical) {
        damage *= 2;
        this.events.push({ type: 'notify', text: 'Critical strike!' });
      }
      if (this.sneaking && isCalm(target)) {
        damage *= SNEAK_ATTACK;
        this.events.push({ type: 'notify', text: `Sneak attack for ${SNEAK_ATTACK}x damage!` });
      }
      const killed = hurtCreature(target, damage, this.world, s.power);
      this.events.push({ type: 'hit', creature: target, damage, killed }, { type: 'sound', name: 'EHIT.VOC', at: { x: target.x, y: target.y } });
      if (killed) this.killed(target);
      return;
    }
    const ahead = this.ahead(1.1);
    if (!ahead) return;
    if (ahead.kind === 'door' && this.locked(ahead.cell)) {
      this.events.push({ type: 'sound', name: 'BASH.VOC', at: ahead.at });
      if (this.random() < bashChance(this.level.locks.get(ahead.cell) ?? 0) * (s.power ? 2 : 1)) {
        this.unlocked.add(ahead.cell);
        this.events.push({ type: 'notify', text: 'You broke the lock' });
        this.openDoor(ahead.cell);
      }
    } else this.events.push({ type: 'sound', name: 'NHIT.VOC', at: ahead.at, volume: 0.6 });
  }

  private killed(c: Creature): void {
    this.kills++;
    this.events.push({ type: 'sound', name: 'BODYFALL.VOC', at: { x: c.x, y: c.y } });
    const s = this.stats;
    const before = { health: s.maxHealth, stamina: s.maxStamina };
    const gained = gainExperience(s, c.info.experience + c.info.experiencePerHealth * c.maxHealth, this.random, this.hero);
    if (gained) {
      this.events.push(
        { type: 'levelUp', level: s.level, health: s.maxHealth - before.health, stamina: s.maxStamina - before.stamina },
        { type: 'sound', name: 'FANFARE1.VOC' },
      );
      // Until there is a Mages Guild, each level teaches a spell.
      for (let i = 0; i < gained && this.hero.magicka > 0; i++) {
        const spell = nextSpell(this.allSpells, this.spellbook);
        if (!spell) break;
        this.spellbook.push(spell);
        this.events.push({ type: 'notify', text: `Spell learned: ${spell.name}` });
      }
    }
    if (!this.cleared && this.creatures.every((o) => !isAlive(o))) {
      this.cleared = true;
      this.events.push({ type: 'cleared' });
    }
  }

  /** The nearest living creature the swing can reach. */
  private creatureInReach(reach = WEAPON_REACH): Creature | undefined {
    const p = this.player;
    let best: Creature | undefined;
    let bestDist = Infinity;
    for (const c of this.creatures) {
      if (!isAlive(c)) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d > reach || d >= bestDist) continue;
      if (d > PLAYER_RADIUS + CREATURE_RADIUS && angleTo(p, c.x, c.y) > WEAPON_ARC) continue;
      if (!lineOfSight(this.level, p.x, p.y, c.x, c.y, this.openDoors)) continue;
      best = c;
      bestDist = d;
    }
    return best;
  }

  // ---- Magic ----

  /** Invisible: the creatures can't see the player. */
  get invisible(): boolean {
    return this.time < this.invisibleUntil;
  }

  /** How far the dungeon can be seen, as a multiple of the usual: more under a Light spell. */
  get lightReach(): number {
    return this.time < this.light.until ? this.light.reach : 1;
  }

  /** Hit points left on a shield spell. */
  get shield(): number {
    return this.shieldPoints;
  }

  /** The spells working on the player now, for the HUD and the magic menu. */
  activeEffects(): string[] {
    const list: string[] = [];
    if (this.shieldPoints > 0) list.push(`Shield (${this.shieldPoints})`);
    if (this.time < this.sanctuary.until) list.push('Sanctuary');
    if (this.invisible) list.push('Invisible');
    if (this.time < this.light.until) list.push('Light');
    if (this.time < this.regen.until) list.push('Regenerating');
    return list;
  }

  /** Spell points the spell costs at the player's level. */
  spellCost(spell: SpellRecord): number {
    return magickaCost(spell, this.stats.level);
  }

  /** Casts a spell, if there are spell points enough and it has something to work on. */
  cast(spell: SpellRecord): boolean {
    if (this.outcome || this.swing || this.sinceCast < CAST_TIME) return false;
    const notify = (text: string) => this.events.push({ type: 'notify', text });
    if (!castable(spell)) return false;
    const cost = this.spellCost(spell);
    if (this.stats.magicka < cost) {
      this.events.push({ type: 'noMagicka' });
      notify(`You need ${cost} spell points to cast ${spell.name}`);
      return false;
    }
    // In sanctuary, a caster may not cast offensive spells.
    if (this.time < this.sanctuary.until && spell.target !== 'caster') {
      notify('You can’t cast that in sanctuary');
      return false;
    }
    let touched: Creature | undefined;
    if (spell.target === 'touch') {
      touched = this.creatureInReach(TOUCH_REACH);
      if (!touched) {
        notify('There is nothing in reach to touch');
        return false;
      }
    }
    const opens = spell.effects.some((e) => e.effect === OPEN);
    const door = opens ? this.ahead(OPEN_REACH) : undefined;
    if (opens && spell.effects.length === 1 && !(door?.kind === 'door' && this.locked(door.cell))) {
      notify('There is no locked door in front of you');
      return false;
    }

    this.stats.magicka -= cost;
    this.sinceCast = 0;
    this.events.push({ type: 'cast', spell }, { type: 'sound', name: spell.target === 'caster' ? 'BURST5.VOC' : 'SLOWBALL.VOC', volume: 0.7 });
    const p = this.player;
    switch (spell.target) {
      case 'caster':
        this.onCaster(spell, door?.kind === 'door' ? door.cell : undefined);
        break;
      case 'touch':
        this.burst(spell, { x: touched!.x, y: touched!.y }, touched);
        break;
      case 'areaCaster':
        this.burst(spell, { x: p.x, y: p.y }, undefined, AREA_AROUND_CASTER);
        break;
      default: {
        // From just in front of the eyes, the way the player faces.
        const dx = Math.cos(p.yaw);
        const dy = Math.sin(p.yaw);
        this.bolts.push({ id: this.nextBolt++, spell, x: p.x + dx * 0.3, y: p.y + dy * 0.3, dx, dy, travelled: 0 });
      }
    }
    return true;
  }

  /** A spell on the caster: healing, a shield, sanctuary, invisibility, light, opening a lock or regenerating. */
  private onCaster(spell: SpellRecord, door: number | undefined): void {
    const level = this.stats.level;
    const s = this.stats;
    for (const e of spell.effects) {
      switch (e.effect) {
        case HEAL:
          if (e.sub === HEALTH) s.health = Math.min(s.maxHealth, s.health + magnitude(e, level, this.random));
          else s.stamina = Math.min(s.maxStamina, s.stamina + magnitude(e, level, this.random));
          break;
        case CREATE:
          this.shieldPoints = Math.max(this.shieldPoints, amount(e, level));
          this.events.push({ type: 'notify', text: `Shielded for ${this.shieldPoints} hit points` });
          break;
        case NON_TARGET:
          this.sanctuary = { chance: chance(e, level), until: this.time + duration(e, level) };
          break;
        case INVISIBILITY:
          this.invisibleUntil = this.time + duration(e, level);
          this.events.push({ type: 'notify', text: 'You are invisible' });
          break;
        case LIGHT:
          this.light = { reach: lightReach(e), until: this.time + duration(e, level) };
          break;
        case REGENERATE: {
          const r = regeneration(e);
          const every = r.everyRounds * ROUND;
          this.regen = { health: r.health, every, next: this.time + every, until: this.time + duration(e, level) };
          break;
        }
        case OPEN:
          if (door === undefined || !this.locked(door)) break;
          if (this.random() * 100 < chance(e, level)) {
            this.unlocked.add(door);
            this.events.push({ type: 'notify', text: 'The lock opens' });
            this.openDoor(door);
          } else this.events.push({ type: 'notify', text: 'The lock holds' }, { type: 'sound', name: 'LOCK.VOC', at: cellCentre(this.level, door) });
          break;
      }
    }
  }

  /** A spell bursting at `at`: on `hit`, or on every creature in `radius` that the burst can reach. */
  private burst(spell: SpellRecord, at: { x: number; y: number }, hit?: Creature, radius = spell.target === 'areaTarget' ? AREA_RADIUS : 0): void {
    this.events.push({ type: 'burst', spell, at, radius }, { type: 'sound', name: radius ? 'EXPLODE.VOC' : 'BURST5.VOC', at });
    if (radius === 0) {
      if (hit) this.onCreature(spell, hit);
      return;
    }
    for (const c of this.creatures) {
      if (!isAlive(c) || Math.hypot(c.x - at.x, c.y - at.y) > radius + CREATURE_RADIUS) continue;
      if (!lineOfSight(this.level, at.x, at.y, c.x, c.y, this.openDoors)) continue;
      this.onCreature(spell, c);
    }
  }

  /** A spell's effects on a creature it reached. */
  private onCreature(spell: SpellRecord, c: Creature): void {
    const level = this.stats.level;
    let damage = 0;
    for (const e of spell.effects) {
      switch (e.effect) {
        case DAMAGE:
          if (e.sub === DAMAGE_HEALTH) damage += magnitude(e, level, this.random);
          break;
        case CONTINUOUS_DAMAGE:
          if (e.sub !== DAMAGE_HEALTH) break;
          this.afflict(c, spell, e, CONTINUOUS_EVERY * ROUND, duration(e, level));
          break;
        case TRANSFER: {
          const taken = Math.min(e.params[0], c.health);
          damage += taken;
          this.stats.health = Math.min(this.stats.maxHealth, this.stats.health + taken);
          break;
        }
        case CAUSE:
          if (this.random() * 100 >= chance(e, level)) {
            this.events.push({ type: 'notify', text: `The ${c.info.name} resists` });
            break;
          }
          if (e.sub === CAUSE_PARALYSIS) {
            paralyseCreature(c, duration(e, level), this.world);
            this.events.push({ type: 'notify', text: `The ${c.info.name} is paralyzed` });
          } else if (e.sub === CAUSE_POISON) {
            const p = poisonDamage(e);
            this.afflict(c, spell, p.damage, p.everyRounds * ROUND, duration(e, level));
            this.events.push({ type: 'notify', text: `The ${c.info.name} is poisoned` });
          }
          break;
      }
    }
    // Whatever the spell does, the creature knows it was attacked.
    this.hurtByMagic(c, damage);
  }

  private afflict(c: Creature, spell: SpellRecord, damage: Affliction['damage'], every: number, lasts: number): void {
    if (lasts <= 0) return;
    this.afflictions.push({ creature: c, spell, damage, every, next: this.time + every, until: this.time + lasts });
  }

  private hurtByMagic(c: Creature, damage: number): void {
    const killed = hurtCreature(c, damage, this.world);
    if (damage > 0) this.events.push({ type: 'hit', creature: c, damage, killed }, { type: 'sound', name: 'EHIT.VOC', at: { x: c.x, y: c.y } });
    if (killed) this.killed(c);
  }

  /** Bolts in flight, harm that lasts, and spells on the player wearing off. */
  private updateMagic(dt: number): void {
    for (const b of [...this.bolts]) this.flyBolt(b, dt);
    for (const a of [...this.afflictions]) {
      if (!isAlive(a.creature) || this.time > a.until + 1e-6) {
        this.afflictions.splice(this.afflictions.indexOf(a), 1);
        continue;
      }
      if (this.time < a.next) continue;
      a.next += a.every;
      const damage = typeof a.damage === 'number' ? a.damage : magnitude(a.damage, this.stats.level, this.random);
      this.hurtByMagic(a.creature, damage);
    }
    const r = this.regen;
    if (r.until > 0) {
      while (this.time >= r.next && r.next <= r.until) {
        this.stats.health = Math.min(this.stats.maxHealth, this.stats.health + r.health);
        r.next += r.every;
      }
      if (this.time >= r.until) r.until = 0;
    }
    if (this.invisibleUntil > 0 && this.time >= this.invisibleUntil) {
      this.invisibleUntil = 0;
      this.events.push({ type: 'notify', text: 'You are visible again' });
    }
  }

  private flyBolt(b: Bolt, dt: number): void {
    const remove = () => this.bolts.splice(this.bolts.indexOf(b), 1);
    for (let left = BOLT_SPEED * dt; left > 0; left -= 0.1) {
      const stepLen = Math.min(0.1, left);
      const nx = b.x + b.dx * stepLen;
      const ny = b.y + b.dy * stepLen;
      const hit = this.creatures.find((c) => isAlive(c) && Math.hypot(c.x - nx, c.y - ny) < CREATURE_RADIUS + BOLT_RADIUS);
      if (hit) {
        remove();
        this.burst(b.spell, { x: nx, y: ny }, hit);
        return;
      }
      const cell = cellIndex(this.level, nx, ny);
      if (cell < 0 || isBlocking(this.level.cells[cell], this.openDoors, cell)) {
        remove();
        this.burst(b.spell, { x: b.x, y: b.y });
        return;
      }
      b.x = nx;
      b.y = ny;
      b.travelled += stepLen;
      if (b.travelled > BOLT_RANGE) {
        remove();
        return;
      }
    }
  }

  /** The spells the player knows, as the magic menu lists them. */
  spellEntries(): MenuEntry[] {
    const inv = this.inventory;
    return this.spellbook.map((spell) => {
      const key = spellKey(spell);
      return { key, name: spell.name, category: 'spells', count: 1, spell, equipped: spell === this.readied, favourite: inv.isFavourite(key), hotkey: inv.hotkeyOf(key) };
    });
  }

  private spellByKey(key: string): SpellRecord | undefined {
    return this.spellbook.find((s) => spellKey(s) === key);
  }

  // ---- Using things ----

  /** What the player would use now, if anything. */
  target(): Target | undefined {
    if (this.outcome) return undefined;
    const ahead = this.ahead(USE_REACH);
    let best: Target | undefined;
    let bestDist = ahead?.distance ?? Infinity;
    if (ahead?.kind === 'door') best = this.doorTarget(ahead.cell);
    else if (ahead?.kind === 'exit') best = { kind: 'exit', id: ahead.cell, name: this.exitName(), verb: 'Enter' };
    else bestDist = Infinity;
    const p = this.player;
    const consider = (x: number, y: number, make: () => Target) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > ITEM_REACH || d >= bestDist || angleTo(p, x, y) > ITEM_ARC) return;
      if (!lineOfSight(this.level, p.x, p.y, x, y, this.openDoors)) return;
      best = make();
      bestDist = d;
    };
    for (const item of this.items) {
      if (item.taken || item.searched) continue;
      consider(item.x, item.y, () => ({ kind: 'item', id: item.id, ...ITEM_PROMPTS[item.kind] }));
    }
    for (const c of this.creatures) {
      if (c.state !== 'dead' || c.info.noCorpse || this.searchedBodies.has(c.id)) continue;
      consider(c.x, c.y, () => ({ kind: 'body', id: c.id, name: c.info.name, verb: 'Search' }));
    }
    return best;
  }

  /** "Shift Gate" in the dungeon Arena starts in, whose messages speak of it. */
  exitName(): string {
    return /shift gate/i.test(this.level.triggers.map((t) => t.text ?? '').join(' ')) ? 'Shift Gate' : 'Way out';
  }

  private doorTarget(cell: number): Target {
    const door = this.doors.get(cell)!;
    const name = this.level.cells[cell].seeThrough ? 'Cell door' : 'Door';
    if (door.target === 1) return { kind: 'door', id: cell, name, verb: 'Close' };
    if (!this.locked(cell)) return { kind: 'door', id: cell, name, verb: 'Open' };
    if (this.stats.keys.has(this.level.locks.get(cell)!)) return { kind: 'door', id: cell, name, verb: 'Unlock' };
    if (this.hero.lockpicking > 0) return { kind: 'door', id: cell, name, verb: 'Pick lock', note: 'Locked' };
    return { kind: 'door', id: cell, name, verb: 'Open', note: 'Locked' };
  }

  /** Chance of picking a lock: thieves get better with each level, and harder locks take more. */
  pickChance(cell: number): number {
    if (this.hero.lockpicking <= 0) return 0;
    const chance = this.hero.lockpicking + 0.05 * (this.stats.level - 1) - (this.level.locks.get(cell) ?? 0) / 100;
    return Math.min(0.95, Math.max(0.05, chance));
  }

  activate(): void {
    const t = this.target();
    if (!t) return;
    if (t.kind === 'door') this.useDoor(t.id);
    else if (t.kind === 'exit') {
      this.outcome = 'escaped';
      this.swing = undefined;
      this.quest?.update(this, this.events);
      this.events.push({ type: 'sound', name: 'FANFARE2.VOC' }, { type: 'escaped' });
    } else if (t.kind === 'item') this.useItem(this.items[t.id]);
    else this.searchBody(this.creatures[t.id]);
  }

  locked(cell: number): boolean {
    return this.level.locks.has(cell) && !this.unlocked.has(cell);
  }

  private useDoor(cell: number): void {
    const door = this.doors.get(cell)!;
    const at = cellCentre(this.level, cell);
    if (door.target === 1) {
      // Not on anyone standing in the doorway.
      const blocked = [this.player, ...this.creatures.filter(isAlive)].some((b) => cellIndex(this.level, b.x, b.y) === cell);
      if (blocked) return;
      door.target = 0;
      this.openDoors.delete(cell);
      const sounds = this.doorSounds(cell);
      if (sounds?.close && !sounds.closeWhenShut) this.events.push({ type: 'sound', name: sounds.close, at });
      return;
    }
    if (this.locked(cell)) {
      if (!this.stats.keys.has(this.level.locks.get(cell)!) && this.hero.lockpicking > 0) {
        if (this.time - (this.pickedAt.get(cell) ?? -Infinity) < PICK_TIME) return;
        this.pickedAt.set(cell, this.time);
        this.events.push({ type: 'sound', name: 'LOCK.VOC', at });
        if (this.random() >= this.pickChance(cell)) {
          this.events.push({ type: 'notify', text: 'You failed to pick the lock' });
          return;
        }
        this.unlocked.add(cell);
        this.events.push({ type: 'notify', text: 'You picked the lock' });
      } else if (!this.stats.keys.has(this.level.locks.get(cell)!)) {
        this.events.push({ type: 'sound', name: 'LOCK.VOC', at });
        this.events.push({
          type: 'notify',
          text: this.lockTried.has(cell) ? 'The door is locked' : 'The door is locked. Find its key, or attack the lock to break it',
        });
        this.lockTried.add(cell);
        return;
      } else {
        this.unlocked.add(cell);
        this.events.push({ type: 'sound', name: 'LOCK.VOC', at }, { type: 'notify', text: 'Unlocked with the key' });
      }
    }
    this.openDoor(cell);
  }

  private openDoor(cell: number): void {
    const door = this.doors.get(cell)!;
    if (door.target === 1) return;
    door.target = 1;
    const open = this.doorSounds(cell)?.open;
    if (open) this.events.push({ type: 'sound', name: open, at: cellCentre(this.level, cell) });
  }

  private useItem(item: DungeonItem): void {
    const notify = (text: string) => this.events.push({ type: 'notify', text });
    switch (item.kind) {
      case 'key':
        this.stats.keys.add(item.key ?? 0);
        item.taken = true;
        notify('Key added');
        return;
      case 'treasure':
        item.taken = true;
        if (this.random() < 0.3) this.addPotion();
        else this.addGold(roll(this.random, 10, 40));
        return;
      case 'equipment': {
        item.taken = true;
        if (this.weaponTable.length && this.random() < 0.75) this.addGear(randomGear(this.weaponTable, this.stats.level, this.random));
        else if (this.random() < 0.5) this.addPotion();
        else this.addGold(roll(this.random, 5, 25));
        return;
      }
      case 'corpse':
        item.searched = true;
        if (this.random() < 0.5) this.addGold(roll(this.random, 1, 20));
        else notify('Nothing of value');
        return;
      case 'chest':
        item.searched = true;
        this.addGold(roll(this.random, 20, 80));
        if (this.random() < 0.4) this.addPotion();
        if (this.weaponTable.length && this.random() < 0.3) this.addGear(randomGear(this.weaponTable, this.stats.level + 1, this.random));
        return;
    }
  }

  private searchBody(c: Creature): void {
    this.searchedBodies.add(c.id);
    // Tougher creatures carry more.
    if (this.random() < Math.min(0.6, 0.15 * c.info.level)) this.addGold(roll(this.random, 1, 10 * c.info.level));
    else this.events.push({ type: 'notify', text: 'Nothing of value' });
  }

  private addGold(n: number): void {
    // Lucky characters find more.
    n = Math.max(1, Math.round(n * this.hero.fortune));
    this.stats.gold += n;
    this.events.push({ type: 'notify', text: `${n} gold added` });
  }

  private addPotion(): void {
    this.stats.potions++;
    this.events.push({ type: 'notify', text: 'Healing potion added' });
  }

  private addGear(gear: NewItem): void {
    const item = this.inventory.add(gear);
    this.events.push({ type: 'notify', text: `${item.name} added` }, { type: 'sound', name: 'CLANK.VOC', volume: 0.6 });
  }

  // ---- The item menus ----

  /** Everything the player carries, as the item menus list it. */
  entries(): MenuEntry[] {
    const inv = this.inventory;
    const entry = (key: string, name: string, category: MenuEntry['category'], count: number, item?: Item): MenuEntry => ({
      key,
      name,
      category,
      count,
      item,
      equipped: !!item && inv.isEquipped(item),
      favourite: inv.isFavourite(key),
      hotkey: inv.hotkeyOf(key),
    });
    const list = inv.items.map((item) => entry(itemKey(item), item.name, item.kind === 'weapon' ? 'weapons' : 'apparel', 1, item));
    if (this.stats.potions > 0) list.push(entry(POTION, 'Healing Potion', 'potions', this.stats.potions));
    if (this.stats.keys.size) list.push(entry('keys', 'Key', 'misc', this.stats.keys.size));
    return list;
  }

  /**
   * Uses an entry from the item or magic menus: equips a piece of gear or
   * takes it off, drinks a healing potion, or readies a spell or puts it
   * away. Returns what happened, to tell the player.
   */
  use(key: string): string | undefined {
    if (this.outcome) return undefined;
    const spell = this.spellByKey(key);
    if (spell) {
      if (this.readied === spell) {
        this.readied = undefined;
        return `${spell.name} put away`;
      }
      this.readied = spell;
      return `${spell.name} readied`;
    }
    if (key === POTION) {
      if (this.stats.potions <= 0) return 'No healing potions';
      if (this.stats.health >= this.stats.maxHealth) return 'Your health is full';
      drinkPotion(this.stats);
      return 'Healing potion drunk';
    }
    const item = this.inventory.byKey(key);
    if (!item) return undefined;
    const wasOn = this.inventory.isEquipped(item);
    const result = this.inventory.toggle(item);
    if (!result.ok) return result.message;
    const held = this.inventory.weapon;
    if (held) this.stats.weapon = weaponOf(held);
    const done = wasOn ? `${item.name} removed` : `${item.name} equipped`;
    return result.message ? `${done}. ${result.message}` : done;
  }

  /**
   * Leaves a piece of gear behind for good, to carry less: there is no
   * putting things down in the dungeon to pick up again yet. Returns what
   * happened, to tell the player.
   */
  drop(key: string): string | undefined {
    if (this.outcome) return undefined;
    const item = this.inventory.byKey(key);
    if (!item) return undefined;
    if (item === this.inventory.weapon) return 'Equip another weapon before you drop this one';
    this.inventory.remove(item);
    return `${item.name} dropped`;
  }

  /** Adds the entry to the favourites or takes it off; true when it is one now. Only gear, potions and spells can be. */
  favourite(key: string): boolean {
    if (!this.favourable(key)) return false;
    return this.inventory.toggleFavourite(key);
  }

  /** Puts a favourite on number key n + 1 (0 for 1). */
  setHotkey(n: number, key: string): void {
    if (this.favourable(key)) this.inventory.setHotkey(n, key);
  }

  private favourable(key: string): boolean {
    return key === POTION || !!this.inventory.byKey(key) || !!this.spellByKey(key);
  }

  /** Uses what is on number key n + 1 (0 for 1), with a note to say what happened. */
  hotkey(n: number): void {
    if (this.outcome) return;
    const key = this.inventory.hotkeys[n];
    // A spell's key readies it, as in Skyrim, rather than putting it away again.
    const spell = key === undefined ? undefined : this.spellByKey(key);
    if (spell && this.readied === spell) return;
    const text = key === undefined ? `Nothing is on ${n + 1}: choose a favourite and press ${n + 1} to put it there` : this.use(key);
    if (text) this.events.push({ type: 'notify', text });
  }

  /** The door, exit or wall straight ahead within `reach`, if any. Open doors are looked through unless the player stands in one. */
  private ahead(reach: number): { kind: 'door' | 'exit' | 'wall'; cell: number; distance: number; at: { x: number; y: number } } | undefined {
    const p = this.player;
    const fx = Math.cos(p.yaw);
    const fy = Math.sin(p.yaw);
    const standing = cellIndex(this.level, p.x, p.y);
    for (let t = 0.1; t <= reach; t += 0.05) {
      const cell = cellIndex(this.level, p.x + fx * t, p.y + fy * t);
      if (cell < 0) return undefined;
      const c = this.level.cells[cell];
      const at = { x: p.x + fx * t, y: p.y + fy * t };
      if (c.kind === 'door' && cell !== standing) return { kind: 'door', cell, distance: t, at };
      if (c.kind === 'wall') return { kind: c.exit ? 'exit' : 'wall', cell, distance: t, at };
      if (c.kind === 'transparent' || c.kind === 'diagonal') return { kind: 'wall', cell, distance: t, at };
    }
    return undefined;
  }
}

const ITEM_PROMPTS: Record<DungeonItem['kind'], { name: string; verb: string }> = {
  key: { name: 'Key', verb: 'Take' },
  treasure: { name: 'Treasure', verb: 'Take' },
  equipment: { name: 'Equipment', verb: 'Search' },
  corpse: { name: 'Body', verb: 'Search' },
  chest: { name: 'Chest', verb: 'Open' },
};

/** Faces the most open direction from the start. */
function initialYaw(level: Level): number {
  let best = 0;
  let bestRun = -1;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    let run = 0;
    for (let t = 1; t < 8; t++) {
      const i = cellIndex(level, level.start.x + Math.cos(yaw) * t, level.start.y + Math.sin(yaw) * t);
      if (i < 0 || level.cells[i].kind !== 'empty') break;
      run++;
    }
    if (run > bestRun) {
      bestRun = run;
      best = yaw;
    }
  }
  return best;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Angle between where the player faces and the direction to (x, y). */
function angleTo(p: PlayerState, x: number, y: number): number {
  const a = Math.atan2(y - p.y, x - p.x) - p.yaw;
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
}

function cellCentre(level: Level, cell: number): { x: number; y: number } {
  return { x: (cell % level.width) + 0.5, y: Math.floor(cell / level.width) + 0.5 };
}
