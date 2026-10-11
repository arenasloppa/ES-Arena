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
 */
import type { ExeData, WeaponInfo } from '../formats/exe';
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
  spawnCreature,
  staggerCreature,
  updateCreature,
  type Creature,
  type CreatureEvents,
  type CreatureWorld,
} from './creatures';
import { Exploration } from './explore';
import { armourReduce, Inventory, itemKey, POTION, randomGear, startingGear, weaponOf, type Item, type NewItem } from './items';
import { Quest, type Objective } from './quest';
import { cellIndex, lineOfSight } from './grid';
import type { Level, LevelItem } from './level';
import { PLAYER_RADIUS, step, type Body, type PlayerState } from './player';

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
  category: 'weapons' | 'apparel' | 'potions' | 'misc';
  count: number;
  item?: Item;
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
  | { type: 'questStarted'; name: string }
  | { type: 'objective'; text: string; done: boolean }
  /** Every creature in the dungeon is dead. */
  | { type: 'cleared' }
  | { type: 'died' }
  | { type: 'escaped' };

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
/** A character of their own starts with these, as well as their gear. */
const START_POTIONS = 1;
const START_GOLD = 25;

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
  /** Objectives toward the way out; undefined in a dungeon without one. */
  readonly quest?: Quest;
  /** The gear the player carries and wears. */
  readonly inventory: Inventory;

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
  private sinceHurt = Infinity;
  private lookTimer = 0;
  private nextStep = STRIDE;
  private footstep = 0;
  private armedAt: number | undefined;
  private queued: boolean | undefined;
  private combo = 0;
  private lastSwingEnd = -Infinity;
  private moving = false;
  private cleared = false;
  private sprintHeld = false;

  /** `hero` is what the player's character brings; without one, the player has no class and plain numbers. */
  constructor(
    readonly level: Level,
    tables: ExeData | undefined,
    private readonly random: Random = Math.random,
    readonly hero: Hero = DEFAULT_HERO,
  ) {
    this.player = { x: level.start.x, y: level.start.y, yaw: initialYaw(level), pitch: 0 };
    this.weaponTable = tables?.weapons ?? [];
    this.inventory = new Inventory(hero.cls, tables?.character?.cannotEquip);
    for (const gear of startingGear(this.weaponTable, hero.cls)) this.inventory.equip(this.inventory.add(gear));
    const held = this.inventory.weapon;
    this.stats = newPlayerStats(held ? weaponOf(held) : DEFAULT_WEAPON, hero);
    if (hero.cls) {
      this.stats.potions = START_POTIONS;
      this.stats.gold = START_GOLD;
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
    if (!this.outcome) {
      this.move(dt, input);
      this.updateAttack(dt, input);
      this.updateCell();
      // A raised guard holds stamina from coming back.
      if (this.blocking) this.sinceStamina = 0;
      recover(this.stats, dt, this.sinceStamina, this.sinceHurt, this.hero.recovery);
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

  // ---- Moving ----

  private move(dt: number, input: DungeonInput): void {
    const p = this.player;
    let forward = clamp(input.forward, -1, 1);
    let strafe = clamp(input.strafe, -1, 1);
    const moving = forward !== 0 || strafe !== 0;
    // Too laden to run, as in Skyrim.
    const laden = this.inventory.weight(this.stats.potions) > this.hero.carry;
    if (laden && input.sprint && moving && !this.sprintHeld) this.events.push({ type: 'notify', text: 'You are carrying too much to run' });
    this.sprintHeld = input.sprint && moving;
    let run = input.sprint && moving && this.stats.stamina > 0 && !this.blocking && !laden;
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
    step(this.level, p, { forward, strafe, run, pace: this.hero.pace }, dt, this.openDoors, bodies);
    const moved = Math.hypot(p.x - x0, p.y - y0);
    this.moving = moved > 0;
    this.running = run && this.moving;
    this.walked += moved;
    if (this.walked >= this.nextStep) {
      this.nextStep = this.walked + STRIDE;
      const cell = this.level.cells[cellIndex(this.level, p.x, p.y)];
      const wading = cell?.chasm === 'wet' || cell?.chasm === 'lava';
      if (!input.sneaking) {
        this.events.push({ type: 'sound', name: wading ? 'SPLASH.VOC' : this.footstep++ % 2 ? 'DIRTR.VOC' : 'DIRTL.VOC', volume: wading ? 0.25 : 0.3 });
      }
    }
  }

  private updateDoors(dt: number): void {
    for (const [i, door] of this.doors) {
      if (door.open === door.target) continue;
      door.open = clamp(door.open + Math.sign(door.target - door.open) * DOOR_SPEED * dt, 0, 1);
      if (door.open === 1) this.openDoors.add(i);
    }
  }

  /** Messages and sounds for the cell the player has just walked into. */
  private updateCell(): void {
    const here = cellIndex(this.level, this.player.x, this.player.y);
    if (here === this.here) return;
    this.here = here;
    this.level.triggers.forEach((t, n) => {
      if (t.y * this.level.width + t.x !== here) return;
      if (t.text && !this.shownTexts.has(n)) {
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
    damage = armourReduce(damage, this.inventory.armourRating());
    this.stats.health = Math.max(0, this.stats.health - damage);
    this.sinceHurt = 0;
    this.events.push({ type: 'hurt', damage }, { type: 'sound', name: 'UHIT.VOC' });
    if (this.stats.health <= 0) {
      this.outcome = 'dead';
      this.swing = undefined;
      this.events.push({ type: 'sound', name: 'MDIE.VOC' }, { type: 'died' });
    }
  }

  // ---- Fighting ----

  private updateAttack(dt: number, input: DungeonInput): void {
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
    if (gainExperience(s, c.info.experience + c.info.experiencePerHealth * c.maxHealth, this.random, this.hero)) {
      this.events.push(
        { type: 'levelUp', level: s.level, health: s.maxHealth - before.health, stamina: s.maxStamina - before.stamina },
        { type: 'sound', name: 'FANFARE1.VOC' },
      );
    }
    if (!this.cleared && this.creatures.every((o) => !isAlive(o))) {
      this.cleared = true;
      this.events.push({ type: 'cleared' });
    }
  }

  /** The nearest living creature the swing can reach. */
  private creatureInReach(): Creature | undefined {
    const p = this.player;
    let best: Creature | undefined;
    let bestDist = Infinity;
    for (const c of this.creatures) {
      if (!isAlive(c)) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d > WEAPON_REACH || d >= bestDist) continue;
      if (d > PLAYER_RADIUS + CREATURE_RADIUS && angleTo(p, c.x, c.y) > WEAPON_ARC) continue;
      if (!lineOfSight(this.level, p.x, p.y, c.x, c.y, this.openDoors)) continue;
      best = c;
      bestDist = d;
    }
    return best;
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
      this.events.push({ type: 'sound', name: 'CLOSDOOR.VOC', at });
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
    this.events.push({ type: 'sound', name: 'OPENDOOR.VOC', at: cellCentre(this.level, cell) });
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
   * Uses an entry from the item menus: equips a piece of gear or takes it
   * off, or drinks a healing potion. Returns what happened, to tell the
   * player.
   */
  use(key: string): string | undefined {
    if (this.outcome) return undefined;
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

  /** Adds the entry to the favourites or takes it off; true when it is one now. Only gear and potions can be. */
  favourite(key: string): boolean {
    if (key !== POTION && !this.inventory.byKey(key)) return false;
    return this.inventory.toggleFavourite(key);
  }

  /** Puts a favourite on number key n + 1 (0 for 1). */
  setHotkey(n: number, key: string): void {
    if (key === POTION || this.inventory.byKey(key)) this.inventory.setHotkey(n, key);
  }

  /** Uses what is on number key n + 1 (0 for 1), with a note to say what happened. */
  hotkey(n: number): void {
    if (this.outcome) return;
    const key = this.inventory.hotkeys[n];
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
