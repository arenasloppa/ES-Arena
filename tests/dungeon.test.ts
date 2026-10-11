import { LEATHER, makeArmour } from '../src/game/items';
import { describe, expect, it } from 'vitest';
import type { ExeData } from '../src/formats/exe';
import {
  creatureHitChance,
  DEFAULT_HERO,
  drinkPotion,
  experienceFor,
  gainExperience,
  newPlayerStats,
  recover,
  roll,
  spendStamina,
  weaponCif,
} from '../src/game/combat';
import {
  ATTACK_TIME,
  creatureFrame,
  hurtCreature,
  spawnCreature,
  staggerCreature,
  updateCreature,
  viewAngle,
  type Creature,
  type CreatureWorld,
} from '../src/game/creatures';
import { Dungeon, IDLE_INPUT, type DungeonEvent, type DungeonInput } from '../src/game/dungeon';
import type { Hero } from '../src/game/combat';
import type { ClassInfo } from '../src/formats/classes';
import { swingFrame } from '../src/render/weaponView';
import { Exploration } from '../src/game/explore';
import type { Level } from '../src/game/level';
import { always, fakeCreature, textLevel } from './helpers/level';

const SWORD = { name: 'Shortsword', damage: [2, 6] as [number, number], cif: 'SWORD.CIF' };

describe('combat rules', () => {
  it('rolls whole numbers from min to max', () => {
    expect(roll(always(0), 2, 5)).toBe(2);
    expect(roll(always(0.999), 2, 5)).toBe(5);
  });

  it('lets stronger creatures hit more often, within limits', () => {
    expect(creatureHitChance(1, 1)).toBeCloseTo(0.55);
    expect(creatureHitChance(3, 1)).toBeGreaterThan(creatureHitChance(1, 1));
    expect(creatureHitChance(40, 1)).toBe(0.9);
    expect(creatureHitChance(1, 40)).toBe(0.2);
  });

  it('picks a swing for each kind of weapon in the game’s list', () => {
    expect([0, 1, 10, 11, 12, 13, 14, 15, 16].map(weaponCif)).toEqual([
      'STAFF.CIF',
      'SWORD.CIF',
      'SWORD.CIF',
      'MACE.CIF',
      'STAR.CIF',
      'HAMMER.CIF',
      'AXE.CIF',
      'AXE.CIF',
      undefined,
    ]);
  });

  it('spends and recovers stamina, and heals slowly when left alone', () => {
    const p = newPlayerStats(SWORD);
    expect(spendStamina(p, 150)).toBe(true);
    expect(p.stamina).toBe(0);
    expect(spendStamina(p, 10)).toBe(false);
    recover(p, 1, 0.1, 0);
    expect(p.stamina).toBe(0); // still catching breath
    recover(p, 1, 2, 0);
    expect(p.stamina).toBeGreaterThan(0);
    p.health = 10;
    recover(p, 1, 2, 1);
    expect(p.health).toBe(10);
    recover(p, 4, 2, 10);
    expect(p.health).toBe(11);
  });

  it('drinks potions only when they help', () => {
    const p = newPlayerStats(SWORD);
    p.potions = 1;
    expect(drinkPotion(p)).toBe(false);
    p.health = 3;
    expect(drinkPotion(p)).toBe(true);
    expect(p.health).toBe(28);
    expect(p.potions).toBe(0);
    expect(drinkPotion(p)).toBe(false);
  });

  it('raises the player’s level with experience, each level needing twice the last', () => {
    expect([1, 2, 3, 4].map((level) => experienceFor(level))).toEqual([0, 1000, 3000, 7000]);
    expect(experienceFor(3, 900)).toBe(2700);
    const p = newPlayerStats(SWORD);
    p.health = 5;
    expect(gainExperience(p, 999, always(0))).toBe(0);
    expect(gainExperience(p, 1, always(0))).toBe(1);
    // A roll of 0 on the hit die plus the bonus of 3; fatigue doesn't grow with level.
    expect(p).toMatchObject({ level: 2, maxHealth: 33, health: 33, maxStamina: 100 });
    expect(gainExperience(p, 6000, always(0))).toBe(2);
    expect(p.level).toBe(4);
  });

  it('levels a character by their class: its experience, and its health die plus their endurance', () => {
    const hero = { ...DEFAULT_HERO, health: 40, stamina: 90, experience: 500, healthDie: 12, healthBonus: -2 };
    const p = newPlayerStats(SWORD, hero);
    expect(p).toMatchObject({ health: 40, maxHealth: 40, stamina: 90 });
    expect(gainExperience(p, 500, always(0.999), hero)).toBe(1);
    expect(p.maxHealth).toBe(40 + 12 - 2);
    // Never less than 1 a level.
    gainExperience(p, 1000, always(0), hero);
    expect(p.maxHealth).toBe(51);
  });

  it('lets an agile character dodge some blows, within the same limits', () => {
    expect(creatureHitChance(1, 1, 0.1)).toBeCloseTo(0.45);
    expect(creatureHitChance(1, 40, 0.1)).toBe(0.2);
  });
});

function world(level: Level, player: { x: number; y: number }, creatures: Creature[], random = always(0.1)): CreatureWorld {
  return { level, openDoors: new Set(), player: { ...player, level: 1 }, sneaking: false, now: 0, random, creatures };
}

/** Runs one creature for `seconds`, collecting its blows. */
function run(c: Creature, w: CreatureWorld, seconds: number): number[] {
  const strikes: number[] = [];
  for (let t = 0; t < seconds; t += 0.05) {
    w.now += 0.05;
    updateCreature(c, w, 0.05, { strike: (_, damage) => strikes.push(damage) });
  }
  return strikes;
}

describe('creatures', () => {
  const hall = textLevel(['##########', '#........#', '##########']);

  it('roll their health from the game’s range', () => {
    expect(spawnCreature(0, fakeCreature(), 1.5, 1.5, always(0)).health).toBe(3);
    expect(spawnCreature(0, fakeCreature(), 1.5, 1.5, always(0.999)).health).toBe(9);
  });

  it('notice the player in sight, from closer when the player sneaks', () => {
    const c = spawnCreature(0, fakeCreature(), 1.5, 1.5, always(0.5));
    const w = world(hall, { x: 6.5, y: 1.5 }, [c]);
    w.sneaking = true;
    run(c, w, 0.05);
    expect(c.state).not.toBe('chase');
    w.sneaking = false;
    run(c, w, 0.05);
    expect(c.state).toBe('chase');
  });

  it('notice a sneaking player bit by bit, and slower from behind', () => {
    // Spawned with random 0, a creature faces east.
    const ahead = spawnCreature(0, fakeCreature(), 1.5, 1.5, always(0));
    const w = world(hall, { x: 3.5, y: 1.5 }, [ahead], always(0));
    w.sneaking = true;
    run(ahead, w, 0.3);
    expect(ahead.state).not.toBe('chase');
    expect(ahead.awareness).toBeGreaterThan(0);
    run(ahead, w, 1);
    expect(ahead.state).toBe('chase');

    const behind = spawnCreature(0, fakeCreature(), 3.5, 1.5, always(0));
    const w2 = world(hall, { x: 1.5, y: 1.5 }, [behind], always(0));
    w2.sneaking = true;
    run(behind, w2, 1.3);
    expect(behind.state).not.toBe('chase');
    run(behind, w2, 2);
    expect(behind.awareness).toBe(1);
    expect(['chase', 'attack']).toContain(behind.state);
  });

  it('are knocked back out of a swing by a bash', () => {
    const c = spawnCreature(0, fakeCreature(), 3, 1.5, always(0));
    const w = world(hall, { x: 2, y: 1.5 }, [c]);
    c.state = 'attack';
    c.time = 0.1;
    c.struck = false;
    staggerCreature(c, w, w.player);
    expect(c.state).toBe('chase');
    expect(c.cooldown).toBeGreaterThan(0.5);
    expect(c.x).toBeGreaterThan(3.2);
  });

  it('do not see through walls', () => {
    const level = textLevel(['#######', '#..#..#', '#######']);
    const c = spawnCreature(0, fakeCreature(), 1.5, 1.5, always(0.5));
    run(c, world(level, { x: 4.5, y: 1.5 }, [c]), 0.5);
    expect(c.state).not.toBe('chase');
  });

  it('close in and strike, without walking into the player', () => {
    const c = spawnCreature(0, fakeCreature(), 1.5, 1.5, always(0.1));
    const strikes = run(c, world(hall, { x: 7.5, y: 1.5 }, [c]), 5);
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes[0]).toBe(2);
    expect(c.x).toBeGreaterThan(6.4);
    expect(c.x).toBeLessThan(7);
  });

  it('miss when the dice say so', () => {
    const c = spawnCreature(0, fakeCreature(), 6.5, 1.5, always(0.1));
    const w = world(hall, { x: 7.5, y: 1.5 }, [c], always(0.95));
    expect(run(c, w, 3).every((d) => d === 0)).toBe(true);
  });

  it('find their way round corners once hurt', () => {
    const level = textLevel(['#######', '#.....#', '#####.#', '#.....#', '#######']);
    const c = spawnCreature(0, fakeCreature(), 1.5, 1.5, always(0));
    const w = world(level, { x: 1.5, y: 3.5 }, [c]);
    expect(hurtCreature(c, 1, w)).toBe(false);
    expect(c.state).toBe('chase');
    const strikes = run(c, w, 12);
    expect(strikes.length).toBeGreaterThan(0);
    expect(Math.hypot(c.x - 1.5, c.y - 3.5)).toBeLessThan(1.1);
  });

  it('fall and leave a body when killed', () => {
    const c = spawnCreature(0, fakeCreature(), 1.5, 1.5, always(0));
    const w = world(hall, { x: 8.5, y: 1.5 }, [c]);
    expect(hurtCreature(c, 100, w)).toBe(true);
    expect(creatureFrame(c, 4)).toEqual({ death: true, frame: 0 });
    run(c, w, 0.3);
    expect(creatureFrame(c, 4)).toEqual({ death: true, frame: 1 });
    run(c, w, 0.3);
    expect(c.state).toBe('dead');
    expect(creatureFrame(c, 4)).toEqual({ death: true, frame: 2 });
    expect(hurtCreature(c, 5, w)).toBe(false);
  });

  it('pick attack and walking frames', () => {
    const c = spawnCreature(0, fakeCreature(), 1.5, 1.5, always(0));
    c.state = 'attack';
    c.time = 0;
    expect(creatureFrame(c, 4).frame).toBe(8);
    c.time = ATTACK_TIME - 0.01;
    expect(creatureFrame(c, 4).frame).toBe(11);
    expect(creatureFrame(c, 0).frame).toBe(0);
    c.state = 'chase';
    c.stride = 7.3;
    expect(creatureFrame(c, 4).frame).toBe(1);
  });

  it('are drawn from the side the viewer sees', () => {
    // The viewer stands west of the creature and looks east, so south is to the viewer's right.
    const view = (facing: number) => viewAngle(5, 0, facing, 0, 0);
    expect(view(Math.PI).file).toBe(0);
    expect(view(0).file).toBe(4);
    expect(view(Math.PI / 2)).toEqual({ file: 2, mirror: true });
    expect(view(-Math.PI / 2)).toEqual({ file: 2, mirror: false });
    expect(view((3 * Math.PI) / 4)).toEqual({ file: 1, mirror: true });
  });

  it('do not flip from side to side when they come straight at the viewer, or go straight away', () => {
    const view = (facing: number) => viewAngle(5, 0, facing, 0, 0);
    for (const facing of [Math.PI - 0.01, Math.PI + 0.01, 0.01, -0.01]) expect(view(facing).mirror).toBe(false);
  });
});

describe('exploration', () => {
  it('marks what the player can see, walls included, and nothing past closed doors', () => {
    const level = textLevel(['#######', '#..D..#', '#######']);
    const seen = new Exploration(level);
    const openDoors = new Set<number>();
    expect(seen.look(1.5, 1.5, openDoors)).toBeGreaterThan(0);
    const row = (y: number) => [...seen.seen.subarray(y * 7, y * 7 + 7)].join('');
    expect(row(1)).toBe('1111000');
    expect(row(0).slice(1, 3)).toBe('11');
    expect(seen.version).toBe(1);
    expect(seen.look(1.5, 1.5, openDoors)).toBe(0);
    expect(seen.version).toBe(1);
    openDoors.add(7 + 3);
    seen.look(1.5, 1.5, openDoors);
    expect(row(1)).toBe('1111111');
    expect(seen.version).toBe(2);
  });
});

const TABLES: ExeData = {
  creatures: [fakeCreature({ health: [3, 3] })],
  weapons: [
    { name: 'Staff', damage: [1, 2], twoHanded: true },
    { name: 'Dagger', damage: [1, 3], twoHanded: false },
    { name: 'Shortsword', damage: [4, 4], twoHanded: false },
    { name: 'Broadsword', damage: [5, 9], twoHanded: false },
    { name: 'Short Bow', damage: [9, 20], twoHanded: true },
  ],
};

function input(overrides: Partial<DungeonInput> = {}): DungeonInput {
  return { ...IDLE_INPUT, ...overrides };
}

const click = input({ attack: { held: false, pressed: true, released: true } });
const hold = input({ attack: { held: true, pressed: false, released: false } });
const press = input({ attack: { held: true, pressed: true, released: false } });

function tick(d: Dungeon, seconds: number, i: DungeonInput = IDLE_INPUT): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.05) d.update(0.05, t === 0 ? i : { ...i, attack: { ...i.attack, pressed: false, released: false } });
}

/** Returns the numbers given in turn, then the last one over and over. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

const notes = (events: DungeonEvent[]) => events.flatMap((e) => (e.type === 'notify' ? [e.text] : []));
const sounds = (events: DungeonEvent[]) => events.flatMap((e) => (e.type === 'sound' ? [e.name] : []));

describe('a run through a dungeon', () => {
  const corridor = () =>
    textLevel(['#########', '#@..L...X', '#########'], {
      items: [{ x: 2.5, y: 1.5, name: 'KEY.IMG', kind: 'key', key: 5 }],
    });

  it('starts facing the open way', () => {
    expect(new Dungeon(corridor(), TABLES, always(0)).player.yaw).toBe(0);
  });

  it('keeps a locked door shut until the player has its key', () => {
    const d = new Dungeon(corridor(), TABLES, always(0));
    d.player.x = 3.3;
    expect(d.target()).toMatchObject({ kind: 'door', name: 'Door', verb: 'Open', note: 'Locked' });
    d.activate();
    expect(notes(d.events)[0]).toMatch(/^The door is locked/);
    expect(d.doors.get(13)!.target).toBe(0);

    d.player.x = 1.5;
    expect(d.target()).toMatchObject({ kind: 'item', name: 'Key', verb: 'Take' });
    d.activate();
    expect(d.stats.keys.has(5)).toBe(true);
    expect(d.items[0].taken).toBe(true);

    d.player.x = 3.3;
    expect(d.target()).toMatchObject({ verb: 'Unlock' });
    d.activate();
    expect(notes(d.events)).toContain('Unlocked with the key');
    tick(d, 1);
    expect(d.openDoors.has(13)).toBe(true);
    expect(d.target()).toMatchObject({ verb: 'Close' });
  });

  it('ends the run at the way out', () => {
    const d = new Dungeon(corridor(), TABLES, always(0));
    d.player.x = 7.5;
    expect(d.target()).toMatchObject({ kind: 'exit', name: 'Way out', verb: 'Enter' });
    d.activate();
    expect(d.outcome).toBe('escaped');
    expect(d.events.some((e) => e.type === 'escaped')).toBe(true);
    expect(d.target()).toBeUndefined();
  });

  it('breaks a lock with blows', () => {
    const d = new Dungeon(corridor(), TABLES, always(0));
    d.player.x = 3.3;
    tick(d, 0.5, click);
    expect(sounds(d.events)).toContain('BASH.VOC');
    expect(notes(d.events)).toContain('You broke the lock');
    expect(d.doors.get(13)!.target).toBe(1);
  });

  it('shows a "~" message once and others each time, and plays the sound every time, as Arena does', () => {
    const level = corridor();
    level.triggers = [
      { x: 2, y: 1, text: 'Water drips.', sound: 'DRIP1.VOC' },
      { x: 3, y: 1, text: 'You awaken.', once: true },
    ];
    const d = new Dungeon(level, TABLES, always(0));
    for (const x of [2.5, 3.5, 2.5, 3.5]) {
      d.player.x = x;
      d.update(0.01, IDLE_INPUT);
    }
    const messages = d.events.flatMap((e) => (e.type === 'message' ? [e.text] : []));
    expect(messages).toEqual(['Water drips.', 'You awaken.', 'Water drips.']);
    expect(sounds(d.events).filter((s) => s === 'DRIP1.VOC')).toHaveLength(2);
  });

  it('makes each kind of door’s sounds from the level’s list: a portcullis grinds up and down', () => {
    const level = corridor();
    level.doorSounds = { raising: { open: 'PORTC.VOC', close: 'PORTC.VOC', closeWhenShut: false }, swinging: { open: 'OPENDOOR.VOC', close: 'CLOSDOOR.VOC', closeWhenShut: true } };
    const d = new Dungeon(level, TABLES, always(0));
    const door = [...d.doors.keys()][0];
    (d as unknown as { openDoor(c: number): void }).openDoor(door);
    expect(sounds(d.events)).toContain('PORTC.VOC');
  });

  const arena = () => textLevel(['#######', '#@....#', '#######'], { creatures: [{ x: 2.7, y: 1.5, type: 0 }] });

  it('swings at the creature in front and kills it', () => {
    const d = new Dungeon(arena(), TABLES, always(0));
    tick(d, 0.3, click);
    const hit = d.events.find((e) => e.type === 'hit');
    expect(hit).toMatchObject({ damage: 4, killed: true });
    expect(sounds(d.events)).toEqual(expect.arrayContaining(['SWISH.VOC', 'EHIT.VOC', 'BODYFALL.VOC']));
    expect(d.kills).toBe(1);
    expect(d.stats.experience).toBe(10 + 2 * 3);
    tick(d, 1);
    expect(d.target()).toMatchObject({ kind: 'body', name: 'Mudcrab', verb: 'Search' });
  });

  it('makes a power attack when attack is held, for stamina and double damage', () => {
    const d = new Dungeon(arena(), TABLES, always(0));
    d.creatures[0].health = d.creatures[0].maxHealth = 8;
    tick(d, 0.2, press);
    expect(d.swing).toBeUndefined();
    tick(d, 0.5, hold);
    expect(d.stats.stamina).toBeLessThan(d.stats.maxStamina);
    expect(d.events.find((e) => e.type === 'swing')).toMatchObject({ swing: { kind: 'chop', power: true } });
    expect(d.events.find((e) => e.type === 'hit')).toMatchObject({ damage: 8, killed: true });
  });

  it('wears the player down until they die', () => {
    const d = new Dungeon(arena(), TABLES, always(0));
    d.stats.health = 3;
    tick(d, 3);
    expect(d.outcome).toBe('dead');
    expect(d.stats.health).toBe(0);
    expect(d.events.filter((e) => e.type === 'hurt').length).toBeGreaterThan(0);
    expect(d.events.filter((e) => e.type === 'died')).toHaveLength(1);
    expect(sounds(d.events)).toContain('MDIE.VOC');
    d.activate();
    expect(d.target()).toBeUndefined();
  });

  it('puts the gear it finds in the pack, for the player to equip', () => {
    const level = textLevel(['#####', '#@..#', '#####'], { items: [{ x: 2.5, y: 1.5, name: 'EQUIPMEN.IMG', kind: 'equipment' }] });
    // Gear (0), a weapon (0), Steel (0.5, 0.5 of the three materials at level 1), the fourth usable weapon (0.8).
    const d = new Dungeon(level, TABLES, sequence(0, 0, 0.5, 0.5, 0.8));
    // The plain shortsword every character starts with.
    expect(d.stats.weapon.name).toBe('Shortsword');
    d.activate();
    expect(notes(d.events)).toContain('Steel Broadsword added');
    expect(d.stats.weapon.name).toBe('Shortsword');
    const found = d.entries().find((e) => e.name === 'Steel Broadsword')!;
    expect(found).toMatchObject({ category: 'weapons', equipped: false });
    expect(d.use(found.key)).toBe('Steel Broadsword equipped');
    expect(d.stats.weapon).toMatchObject({ name: 'Steel Broadsword', damage: [5, 9], cif: 'SWORD.CIF' });
  });

  it('tires the player when sprinting', () => {
    const d = new Dungeon(textLevel(['############', '#@.........#', '############']), TABLES, always(0));
    tick(d, 1, input({ forward: 1, sprint: true }));
    expect(d.stats.stamina).toBeCloseTo(88, 0);
    expect(d.player.x).toBeGreaterThan(5);
    tick(d, 2);
    expect(d.stats.stamina).toBe(100);
  });

  it('runs without the game’s tables, with no creatures', () => {
    const d = new Dungeon(arena(), undefined, always(0));
    expect(d.creatures).toHaveLength(0);
    expect(d.stats.weapon.name).toBe('Shortsword');
  });
});

describe('blocking, bashing and sneaking', () => {
  const arena = () => textLevel(['#######', '#@....#', '#######'], { creatures: [{ x: 2.7, y: 1.5, type: 0 }] });
  const blocked = (events: DungeonEvent[]) => events.filter((e) => e.type === 'blocked');

  it('takes most of a blow on the guard, for stamina', () => {
    const open = new Dungeon(arena(), TABLES, always(0));
    tick(open, 3);
    const guarded = new Dungeon(arena(), TABLES, always(0));
    tick(guarded, 3, input({ block: true }));
    expect(blocked(guarded.events).length).toBeGreaterThan(0);
    expect(sounds(guarded.events)).toContain('CLANK.VOC');
    expect(guarded.stats.health).toBeGreaterThan(open.stats.health);
    expect(guarded.stats.stamina).toBeLessThan(guarded.stats.maxStamina);
    expect(guarded.blocking).toBe(true);
  });

  it('lets blows through with no stamina left, or from behind', () => {
    const tired = new Dungeon(arena(), TABLES, always(0));
    tired.stats.stamina = 0;
    tick(tired, 3, input({ block: true }));
    expect(blocked(tired.events)).toHaveLength(0);

    const turned = new Dungeon(arena(), TABLES, always(0));
    turned.player.yaw = Math.PI;
    tick(turned, 3, input({ block: true }));
    expect(blocked(turned.events)).toHaveLength(0);
    expect(turned.stats.health).toBeLessThan(turned.stats.maxHealth);
  });

  it('bashes when attacking with the guard up', () => {
    const d = new Dungeon(arena(), TABLES, always(0));
    tick(d, 0.3, input({ block: true, attack: { held: true, pressed: true, released: false } }));
    expect(d.events.find((e) => e.type === 'swing')).toMatchObject({ swing: { bash: true } });
    expect(d.events.some((e) => e.type === 'bashed')).toBe(true);
    expect(d.events.some((e) => e.type === 'hit')).toBe(false);
    expect(d.creatures[0].health).toBe(d.creatures[0].maxHealth);
    expect(d.stats.stamina).toBeLessThan(d.stats.maxStamina);
  });

  it('triples the damage of a blow on a creature that has not noticed the sneaking player', () => {
    const d = new Dungeon(arena(), TABLES, always(0));
    d.creatures[0].health = d.creatures[0].maxHealth = 20;
    tick(d, 0.3, input({ sneaking: true, attack: { held: false, pressed: true, released: true } }));
    expect(d.events.find((e) => e.type === 'hit')).toMatchObject({ damage: 12 });
    expect(notes(d.events)).toContain('Sneak attack for 3x damage!');
    // Now it knows: no more sneak attacks.
    tick(d, 0.6, input({ sneaking: true, attack: { held: false, pressed: true, released: true } }));
    expect(d.events.filter((e) => e.type === 'hit').map((e) => (e.type === 'hit' ? e.damage : 0))).toEqual([12, 4]);
  });

  it('tells how aware the creatures are, for the sneak eye', () => {
    const d = new Dungeon(textLevel(['############', '#@.........#', '############'], { creatures: [{ x: 10.5, y: 1.5, type: 0 }] }), TABLES, always(0));
    expect(d.detection()).toBe(0);
    d.player.x = 7.5;
    tick(d, 0.1, input({ sneaking: true }));
    expect(d.detection()).toBeGreaterThan(0);
    expect(d.detection()).toBeLessThan(0.6);
    tick(d, 0.2);
    expect(d.detection()).toBe(1);
  });

  it('calls the dungeon cleared once every creature is dead', () => {
    const d = new Dungeon(arena(), TABLES, always(0));
    tick(d, 0.3, click);
    expect(d.events.some((e) => e.type === 'cleared')).toBe(true);
  });
});

describe('the quest', () => {
  // A barred, locked cell with its key inside, and the way out round a corner.
  const prison = (extra: Partial<Level> = {}) =>
    textLevel(['#########', '#@.C....#', '#######.#', '#######.#', '#######X#'], {
      items: [{ x: 2.5, y: 1.5, name: 'KEY.IMG', kind: 'key', key: 5 }],
      ...extra,
    });
  const objectives = (events: DungeonEvent[]) =>
    events.flatMap((e) => (e.type === 'objective' ? [`${e.done ? 'done' : 'new'}: ${e.text}`] : []));

  it('leads out of the cell, to the way out and through it, with a marker for each step', () => {
    const d = new Dungeon(prison(), TABLES, always(0));
    tick(d, 0.2);
    expect(d.events.find((e) => e.type === 'questStarted')).toMatchObject({ name: 'The Way Out' });
    expect(objectives(d.events)).toEqual(['new: Get out of your cell']);
    expect(d.objective?.marker).toEqual({ x: 2.5, y: 1.5 }); // the key first

    d.player.x = 1.6;
    d.activate();
    tick(d, 0.2);
    expect(d.objective?.marker).toEqual({ x: 3.5, y: 1.5 }); // then the cell door
    d.player.x = 2.4;
    d.activate();
    tick(d, 1);
    expect(objectives(d.events)).toEqual(['new: Get out of your cell', 'done: Get out of your cell', 'new: Find the way out']);
    expect(d.objective?.marker).toBeUndefined();

    Object.assign(d.player, { x: 7.5, y: 3.4, yaw: Math.PI / 2 });
    tick(d, 0.2);
    expect(objectives(d.events).slice(-2)).toEqual(['done: Find the way out', 'new: Leave the dungeon']);
    expect(d.objective?.marker).toEqual({ x: 7.5, y: 4.5 });
    d.activate();
    expect(d.outcome).toBe('escaped');
    expect(objectives(d.events).at(-1)).toBe('done: Leave the dungeon');
    expect(d.objective).toBeUndefined();
  });

  it('speaks of the Shift Gate where the dungeon does', () => {
    const d = new Dungeon(prison({ triggers: [{ x: 5, y: 1, text: 'Find the Shift Gate.' }] }), TABLES, always(0));
    tick(d, 0.2);
    expect(d.quest?.name).toBe('The Shift Gate');
    d.player.x = 1.6;
    d.activate();
    d.player.x = 2.4;
    d.activate();
    tick(d, 1);
    expect(objectives(d.events).at(-1)).toBe('new: Find the Shift Gate');
  });

  it('skips the cell when the start is not shut in, and has no quest without a way out', () => {
    const d = new Dungeon(textLevel(['#####', '#@..X', '#####']), TABLES, always(0));
    tick(d, 0.2);
    expect(objectives(d.events)).toEqual(['new: Find the way out', 'done: Find the way out', 'new: Leave the dungeon']);
    expect(new Dungeon(textLevel(['####', '#@.#', '####']), TABLES, always(0)).quest).toBeUndefined();
  });
});

describe('the weapon in hand', () => {
  const swing = (kind: 'chop' | 'thrust', time: number) => ({ kind, power: false, time, duration: 1, struck: false });

  it('rests on the last frame of the swing set and chops from the first', () => {
    expect(swingFrame(undefined)).toBe(32);
    expect(swingFrame(swing('chop', 0))).toBe(0);
    expect(swingFrame(swing('chop', 0.99))).toBe(4);
    expect(swingFrame(swing('thrust', 0.5))).toBe(27);
  });
});

describe('the character in the dungeon', () => {
  /** A made-up class; none of these values come from the game. */
  const TINKER: ClassInfo = { name: 'Tinker', healthDie: 9, experience: 800, spellcaster: false, critical: true, thief: true, armour: 2, shields: [0], weapons: [1, 3] };
  const hero = (overrides: Partial<Hero> = {}): Hero => ({ ...DEFAULT_HERO, ...overrides });
  const arena = () => textLevel(['#######', '#@....#', '#######'], { creatures: [{ x: 2.7, y: 1.5, type: 0 }] });
  const firstHurt = (d: Dungeon) => d.events.find((e) => e.type === 'hurt');

  it('starts as Arena does: a plain weapon by the class’s place in the list, gold and 700 experience, nothing more', () => {
    // A class sixth or later in the game's list gets a shortsword; one without a place, the first it may use.
    const d = new Dungeon(arena(), TABLES, always(0), hero({ cls: { ...TINKER, id: 7, weapons: [1, 2, 3] }, health: 33, gold: 120 }));
    expect(d.inventory.wornItems().map((i) => i.name)).toEqual(['Shortsword']);
    expect(d.stats).toMatchObject({ health: 33, potions: 0, gold: 120, experience: 700, weapon: { name: 'Shortsword' } });
    expect(new Dungeon(arena(), TABLES, always(0), hero({ cls: TINKER })).stats.weapon.name).toBe('Dagger');
  });

  it('takes blows down by the armour worn', () => {
    const bare = new Dungeon(arena(), TABLES, always(0));
    tick(bare, 2);
    expect(firstHurt(bare)).toMatchObject({ damage: 2 });
    const armoured = new Dungeon(arena(), TABLES, always(0));
    armoured.inventory.equip(armoured.inventory.add({ kind: 'armour', name: 'Test Plate', type: 0, armour: 0, rating: 100, weight: 1, value: 1 }));
    tick(armoured, 2);
    expect(firstHurt(armoured)).toMatchObject({ damage: 1 });
  });

  it('adds the character’s strength to blows, and lands critical strikes for double damage', () => {
    const d = new Dungeon(arena(), TABLES, always(0), hero({ critical: 0.5, damageBonus: 1 }));
    d.creatures[0].health = d.creatures[0].maxHealth = 20;
    tick(d, 0.3, click);
    expect(d.events.find((e) => e.type === 'hit')).toMatchObject({ damage: (4 + 1) * 2 });
    expect(notes(d.events)).toContain('Critical strike!');
  });

  it('lets a thief pick a lock, trying again after a moment', () => {
    const corridor = textLevel(['#########', '#@..L...X', '#########']);
    const d = new Dungeon(corridor, TABLES, always(0.99), hero({ lockpicking: 0.5 }));
    d.player.x = 3.3;
    expect(d.target()).toMatchObject({ kind: 'door', verb: 'Pick lock', note: 'Locked' });
    expect(d.pickChance(13)).toBeCloseTo(0.45);
    d.activate();
    d.activate();
    expect(notes(d.events)).toEqual(['You failed to pick the lock']);
    expect(d.locked(13)).toBe(true);
    const lucky = new Dungeon(corridor, TABLES, always(0), hero({ lockpicking: 0.5 }));
    lucky.player.x = 3.3;
    lucky.activate();
    expect(notes(lucky.events)).toEqual(['You picked the lock']);
    expect(lucky.doors.get(13)!.target).toBe(1);
  });

  it('cannot run carrying too much', () => {
    const d = new Dungeon(textLevel(['############', '#@.........#', '############']), TABLES, always(0), hero({ carry: 1 }));
    tick(d, 1, input({ forward: 1, sprint: true }));
    expect(notes(d.events)).toEqual(['You are carrying too much to run']);
    expect(d.stats.stamina).toBe(100);
    expect(d.player.x).toBeLessThan(4);
  });

  it('moves at the character’s own pace, and finds more gold with more luck', () => {
    const level = textLevel(['############', '#@.........#', '############'], { items: [{ x: 2.5, y: 1.5, name: 'CHEST.IMG', kind: 'chest' }] });
    const quick = new Dungeon(level, TABLES, always(0), hero({ pace: 1.5, fortune: 2 }));
    quick.activate();
    expect(notes(quick.events)[0]).toBe('40 gold added');
    tick(quick, 1, input({ forward: 1 }));
    expect(quick.player.x).toBeCloseTo(1.5 + 2.2 * 1.5, 1);
  });

  it('uses what is on the number keys: the healing potion on 1 to begin with', () => {
    const d = new Dungeon(arena(), TABLES, always(0));
    d.hotkey(0);
    d.stats.potions = 1;
    d.hotkey(0);
    d.stats.health = 10;
    d.hotkey(0);
    d.hotkey(3);
    expect(notes(d.events)).toEqual(['No healing potions', 'Your health is full', 'Healing potion drunk', expect.stringMatching(/^Nothing is on 4/)]);
    const dagger = d.inventory.add({ kind: 'weapon', name: 'Test Dagger', type: 1, damage: [1, 3], weight: 1, value: 1 });
    d.setHotkey(1, `item:${dagger.id}`);
    d.hotkey(1);
    expect(d.stats.weapon).toMatchObject({ name: 'Test Dagger', damage: [1, 3] });
    expect(d.entries().find((e) => e.name === 'Test Dagger')).toMatchObject({ favourite: true, hotkey: 1, equipped: true });
  });

  it('drops gear for good, off the favourites and number keys, but never the weapon in hand', () => {
    const d = new Dungeon(arena(), TABLES, always(0), hero({ cls: TINKER }));
    const key = (name: string) => d.entries().find((e) => e.name === name)!.key;
    d.inventory.equip(d.inventory.add(makeArmour(LEATHER, 0, 0)));
    expect(d.drop(key('Dagger'))).toBe('Equip another weapon before you drop this one');
    const cuirass = key('Leather Cuirass');
    d.setHotkey(2, cuirass);
    expect(d.drop(cuirass)).toBe('Leather Cuirass dropped');
    expect(d.entries().map((e) => e.name)).toEqual(['Dagger']);
    expect(d.inventory.wornItems().map((i) => i.name)).toEqual(['Dagger']);
    expect(d.inventory.favourites).not.toContain(cuirass);
    expect(d.inventory.hotkeys[2]).toBeUndefined();
    expect(d.drop('item:999')).toBeUndefined();
  });
});
