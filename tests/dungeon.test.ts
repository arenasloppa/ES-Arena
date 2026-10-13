import { itemKey, LEATHER, makeArmour, makeWeapon } from '../src/game/items';
import { describe, expect, it } from 'vitest';
import type { ExeData } from '../src/formats/exe';
import {
  bodyPart,
  BODY_PARTS,
  COLD,
  DEFAULT_HERO,
  elementalDamage,
  FIRE,
  hitChance,
  experienceFor,
  gainExperience,
  knackDamage,
  levelDamage,
  maxHealthFor,
  mayCrit,
  newPlayerStats,
  POISON,
  recover,
  reloadTime,
  roll,
  spendStamina,
  weaponCif,
} from '../src/game/combat';
import {
  ATTACK_TIME,
  creatureFrame,
  hurtCreature,
  paralysisFrom,
  spawnCreature,
  staggerCreature,
  updateCreature,
  viewAngle,
  type Creature,
  type CreatureWorld,
} from '../src/game/creatures';
import { Dungeon, IDLE_INPUT, SNEAK_SHOT, type DungeonEvent, type DungeonInput } from '../src/game/dungeon';
import type { Hero } from '../src/game/combat';
import type { ClassInfo } from '../src/formats/classes';
import { frameSet, swingFrame } from '../src/render/weaponView';
import { Exploration } from '../src/game/explore';
import type { Level } from '../src/game/level';
import { always, fakeCreature, textLevel } from './helpers/level';

const SWORD = { name: 'Shortsword', damage: [2, 6] as [number, number], cif: 'SWORD.CIF' };

describe('combat rules', () => {
  it('rolls whole numbers from min to max', () => {
    expect(roll(always(0), 2, 5)).toBe(2);
    expect(roll(always(0.999), 2, 5)).toBe(5);
  });

  const bare = { level: 1, agility: 128, protection: [0, 0, 0, 0, 0, 0, 0], evasive: false };
  const plated = (part: number, percent: number) => bare.protection.map((p, i) => (i === part ? percent : p));

  it('lands creatures’ blows as Arena does: by level, the armour where they strike and Agility', () => {
    const rat = { level: 1, agility: 128 };
    expect(hitChance(rat, bare, 0)).toBe(128);
    // 5% (13 of 256) more for each level the creature has over the player.
    expect(hitChance({ level: 3, agility: 128 }, bare, 0)).toBe(128 + 26);
    // Protection comes off in percent, and only on the part it is worn on: 20% is 51 of 256.
    expect(hitChance(rat, { ...bare, protection: plated(0, 20) }, 0)).toBe(128 - 51);
    expect(hitChance(rat, { ...bare, protection: plated(0, 20) }, 1)).toBe(128);
    // Agility on both sides.
    expect(hitChance({ level: 1, agility: 150 }, { ...bare, agility: 100 }, 0)).toBe(128 + 50);
    // However well armoured, a fifth of blows land, and a percent more for each of the player's levels.
    expect(hitChance(rat, { ...bare, protection: plated(0, 90) }, 0)).toBe(2 + 51);
    expect(hitChance(rat, { ...bare, level: 10, protection: plated(0, 90) }, 0)).toBe(25 + 51);
  });

  it('makes Monks and Acrobats hard to hit, and harder as they rise in level', () => {
    const monk = { ...bare, evasive: true };
    // A 32nd of the chance, times one more than their level: 128 makes 8, under the least there is.
    expect(hitChance({ level: 1, agility: 128 }, monk, 0)).toBe(53);
    expect(hitChance({ level: 20, agility: 230 }, { ...monk, level: 15 }, 0)).toBe(9 * 16);
    // A chance below nothing is nothing, not a blow that always lands.
    expect(hitChance({ level: 1, agility: 50 }, { ...monk, agility: 200, protection: plated(0, 90) }, 0)).toBe(53);
  });

  it('picks the body part a blow lands on from a roll of 0 to 19', () => {
    const parts = [1, 2, 5, 9, 14, 17, 19];
    expect([0, 0.1, 0.15, 0.3, 0.7, 0.86, 0.999].map((r) => bodyPart(always(r), parts))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('adds a race’s knack with weapons as the character rises in level', () => {
    const melee = { levels: 3, weapons: 'melee' as const };
    expect([1, 2, 3, 8, 9].map((level) => knackDamage(melee, level, false))).toEqual([0, 0, 1, 2, 3]);
    expect(knackDamage(melee, 9, true)).toBe(0);
    expect(knackDamage({ levels: 3, weapons: 'bows' }, 9, false)).toBe(0);
    expect(knackDamage({ levels: 4, weapons: 'any' }, 9, true)).toBe(2);
    expect(knackDamage(undefined, 9, false)).toBe(0);
  });

  it('saves against spells of an element as Arena does, with Nords shrugging off cold and Bretons magic', () => {
    const saver = { willpower: 52, saves: [0, 0, 40, 0, 60] };
    // Willpower takes a 26th of itself off (2 here); a roll below the save's chance fails it and takes the lot, else half.
    expect(elementalDamage(12, FIRE, saver, always(0))).toBe(5);
    expect(elementalDamage(12, POISON, saver, always(0.39))).toBe(10);
    expect(elementalDamage(12, POISON, saver, always(0.4))).toBe(5);
    // The element the race resists does half on a failed save, and nothing on a successful one.
    const nord = { ...saver, resists: COLD, saves: [0, 70, 0, 0, 0] };
    expect(elementalDamage(12, COLD, nord, always(0.5))).toBe(5);
    expect(elementalDamage(12, COLD, nord, always(0.8))).toBe(0);
    // A Monk takes nothing from a spell saved against.
    expect(elementalDamage(12, POISON, { ...saver, shrugsOff: true }, always(0.4))).toBe(0);
    expect(elementalDamage(12, POISON, { ...saver, shrugsOff: true }, always(0.39))).toBe(10);
    // Spells of no element are only lessened by Willpower, which never heals.
    expect(elementalDamage(12, 5, saver, always(0))).toBe(10);
    expect(elementalDamage(1, FIRE, saver, always(0))).toBe(0);
  });

  it('lets Archers land critical hits only with bows, and everyone else only with other weapons', () => {
    const lucky = { ...DEFAULT_HERO, critical: 0.1 };
    expect([mayCrit(lucky, false), mayCrit(lucky, true)]).toEqual([true, false]);
    const archer = { ...lucky, criticalWith: 'bows' as const };
    expect([mayCrit(archer, false), mayCrit(archer, true)]).toEqual([false, true]);
    expect(mayCrit(DEFAULT_HERO, false)).toBe(false);
  });

  it('adds a Ranger’s level to blows, except on the undead', () => {
    const ranger = { ...DEFAULT_HERO, levelDamage: true };
    expect(levelDamage(ranger, 6, 2, [5, 8])).toBe(6);
    expect(levelDamage(ranger, 6, 5, [5, 8])).toBe(0);
    expect(levelDamage(DEFAULT_HERO, 6, 2, [5, 8])).toBe(0);
  });

  it('picks a swing for each kind of weapon in the game’s list, and the arrow for the bows', () => {
    expect([0, 1, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(weaponCif)).toEqual([
      'STAFF.CIF',
      'SWORD.CIF',
      'SWORD.CIF',
      'MACE.CIF',
      'STAR.CIF',
      'HAMMER.CIF',
      'AXE.CIF',
      'AXE.CIF',
      'ARROWHLF.CFA',
      'ARROWHLF.CFA',
      undefined,
    ]);
  });

  it('nocks the next arrow sooner the more Speed there is, as Arena does', () => {
    expect([0, 128, 255, 256].map((speed) => Math.round(reloadTime(speed) * 18.2))).toEqual([20, 12, 4, 4]);
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

  it('raises the player’s level with experience, in Arena’s steps', () => {
    // The class's figure for level 2, then 30/16 of the last up to level 10 and 24/16 after, rounded down.
    expect([1, 2, 3, 4].map((level) => experienceFor(level))).toEqual([0, 1000, 1875, 3515]);
    expect(experienceFor(3, 900)).toBe(1687);
    expect(experienceFor(10, 900)).toBe(Math.floor((experienceFor(9, 900) * 30) / 16));
    expect(experienceFor(11, 900)).toBe(Math.floor((experienceFor(10, 900) * 24) / 16));
    const p = newPlayerStats(SWORD);
    p.health = 5;
    expect(gainExperience(p, 999, always(0))).toBe(0);
    expect(gainExperience(p, 1, always(0))).toBe(1);
    // The hit die's lowest, 1, plus the bonus of 3 raise the most health can be, not the health; the fewest bonus points, 3.
    expect(p).toMatchObject({ level: 2, maxHealth: 34, health: 5, maxStamina: 100, bonusPoints: 3 });
    expect(gainExperience(p, 3000, always(0.999))).toBe(2);
    // Two levels at the die's highest, 5, and the most points, 6.
    expect(p).toMatchObject({ level: 4, maxHealth: 34 + 2 * (5 + 3), bonusPoints: 3 + 2 * 6 });
  });

  it('levels a character by their class: its experience, and its health die plus their endurance for every level', () => {
    const hero = { ...DEFAULT_HERO, health: 40, stamina: 90, experience: 500, healthDie: 12, healthBonus: -2 };
    const p = newPlayerStats(SWORD, hero);
    expect(p).toMatchObject({ health: 40, maxHealth: 40, stamina: 90 });
    expect(gainExperience(p, 500, always(0.999), hero)).toBe(1);
    expect(p.maxHealth).toBe(40 + 12 - 2);
    // Endurance counts back: with a bonus of 0 rather than -2, both levels have 2 more.
    expect(maxHealthFor(p, 0)).toBe(40 + 12 + 2);
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

  it('miss more against armour on the body part they strike, and less against quicker players', () => {
    // A roll of 0.3 strikes the gauntlets (by the remake's own table) and needs a chance over 76 of 256.
    const strikes = (player: Partial<CreatureWorld['player']>, info = fakeCreature()) => {
      const c = spawnCreature(0, info, 6.5, 1.5, always(0.1));
      const w = world(hall, { x: 7.5, y: 1.5 }, [c], always(0.3));
      Object.assign(w.player, player);
      return run(c, w, 3);
    };
    expect(strikes({}).some((d) => d > 0)).toBe(true);
    expect(strikes({ protection: [0, 25, 0, 0, 0, 0, 0] }).every((d) => d === 0)).toBe(true);
    expect(strikes({ protection: [25, 0, 0, 0, 0, 0, 0] }).some((d) => d > 0)).toBe(true);
    expect(strikes({ agility: 190 }).every((d) => d === 0)).toBe(true);
    expect(strikes({ agility: 190 }, fakeCreature({ agility: 160 })).some((d) => d > 0)).toBe(true);
  });

  it('paralyse now and then when they are Lizard Men or Spiders', () => {
    const lizard = fakeCreature({ id: 3, special: 9 });
    // A roll out of 100 of no more than the creature's chance, then one below the player's, for 1 to 6 rounds.
    expect(paralysisFrom(lizard, 30, sequence(0.09, 0.29, 0.99))).toBe(6);
    expect(paralysisFrom(lizard, 30, sequence(0.1, 0, 0))).toBe(0);
    expect(paralysisFrom(lizard, 30, sequence(0, 0.3, 0))).toBe(0);
    expect(paralysisFrom(fakeCreature({ id: 9, special: 14 }), 30, always(0))).toBe(1);
    // A rat's harm is disease, not paralysis; and a creature with no chance does none.
    expect(paralysisFrom(fakeCreature({ id: 1, special: 4 }), 100, always(0))).toBe(0);
    expect(paralysisFrom(fakeCreature({ id: 3, special: 0 }), 100, always(0))).toBe(0);
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
    { name: 'Saber', damage: [9, 20], twoHanded: false },
  ],
};

/** A made-up weapon list as long as the game's, with its bows in their places; none of these numbers come from the game. */
const BOW_TABLES: ExeData = {
  ...TABLES,
  weapons: [
    ...TABLES.weapons!,
    ...Array.from({ length: 11 }, (_, i) => ({ name: `Blade ${i}`, damage: [2, 2] as [number, number], twoHanded: false })),
    { name: 'Short Bow', damage: [3, 3], twoHanded: true },
    { name: 'Long Bow', damage: [5, 7], twoHanded: true },
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
    expect(sounds(d.events)).toEqual(expect.arrayContaining(['SWISH.VOC', 'EHIT.VOC']));
    expect(sounds(d.events)).not.toContain('BODYFALL.VOC');
    expect(d.kills).toBe(1);
    expect(d.stats.experience).toBe(10 + 2 * 3);
    tick(d, 1);
    expect(sounds(d.events)).toContain('BODYFALL.VOC');
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
    // Gear (0), a weapon (0), Steel (0.5, 0.5 of the three materials at level 1), the fourth of five weapons (0.7).
    const d = new Dungeon(level, TABLES, sequence(0, 0, 0.5, 0.5, 0.7));
    // The plain shortsword every character starts with.
    expect(d.stats.weapon.name).toBe('Shortsword');
    d.activate();
    d.takeLoot();
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

describe('water', () => {
  // A pool two cells square, with floor all round it.
  const pool = () => textLevel(['######', '#.~~.#', '#.~~.#', '#....#', '######']);

  it('lets the player swim about after dropping in at its edge', () => {
    const d = new Dungeon(pool(), TABLES, always(0));
    // Over the water, but still hanging over the floor to the west.
    Object.assign(d.player, { x: 2.15, y: 1.5, z: 0, yaw: Math.PI / 2 });
    tick(d, 0.5);
    expect(d.swimming).toBe(true);
    const y = d.player.y;
    tick(d, 0.5, input({ forward: 1 }));
    expect(d.player.y).toBeGreaterThan(y + 0.2);
  });

  it('climbs out at once when swum into the edge, even at a slant, as Arena does', () => {
    const d = new Dungeon(pool(), TABLES, always(0));
    Object.assign(d.player, { x: 3.4, y: 1.5, z: 0, yaw: 0.5 });
    tick(d, 0.3);
    expect(d.swimming).toBe(true);
    tick(d, 1, input({ forward: 1 }));
    expect(d.swimming).toBe(false);
    expect(d.climb).toBeUndefined();
    expect(d.player.x).toBeGreaterThan(4);
    expect(d.player.z).toBe(0);
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
  const swing = (kind: 'chop' | 'thrust' | 'shoot', time: number) => ({ kind, power: false, time, duration: 1, struck: false });

  it('rests on the last frame of the swing set and chops from the first', () => {
    expect(swingFrame(undefined)).toBe(32);
    expect(swingFrame(swing('chop', 0))).toBe(0);
    expect(swingFrame(swing('chop', 0.99))).toBe(4);
    expect(swingFrame(swing('thrust', 0.5))).toBe(27);
  });

  it('shows a bow’s arrow on the string, and none from the shot until the next is nocked', () => {
    const bow = frameSet('ARROWHLF.CFA');
    expect(swingFrame(undefined, bow)).toBe(0);
    expect(swingFrame(swing('shoot', 0.5), bow)).toBe(1);
    expect(bow.guard).toBeUndefined();
    // A shot with a swing set in hand (the weapon changed under it) shows the weapon at rest.
    expect(swingFrame(swing('shoot', 0.5), frameSet('AXE.CIF'))).toBe(32);
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
    expect(d.inventory.items.filter((i) => i.kind === 'potion')).toEqual([]);
    expect(d.stats).toMatchObject({ health: 33, gold: 120, experience: 700, weapon: { name: 'Shortsword' } });
    expect(new Dungeon(arena(), TABLES, always(0), hero({ cls: TINKER })).stats.weapon.name).toBe('Dagger');
  });

  it('keeps blows off with the armour worn where they strike, rather than softening them', () => {
    // A roll of 0.3 strikes the gauntlets and needs a chance over 76 of 256.
    const bare = new Dungeon(arena(), TABLES, always(0.3));
    tick(bare, 2);
    expect(firstHurt(bare)).toMatchObject({ damage: 2 });
    const armoured = new Dungeon(arena(), TABLES, always(0.3));
    armoured.inventory.equip(armoured.inventory.add({ kind: 'armour', name: 'Test Gauntlets', type: 1, armour: 0, protection: 25, weight: 1, value: 1 }));
    tick(armoured, 2);
    expect(firstHurt(armoured)).toBeUndefined();
    // Where blows land comes from the game when it can be read: here every blow strikes the helm.
    const helmed = new Dungeon(arena(), { ...TABLES, hits: { bodyParts: [-1, -1, -1, -1, -1, 19, 19], undead: [] } }, always(0.3));
    helmed.inventory.equip(helmed.inventory.add({ kind: 'armour', name: 'Test Helm', type: 5, armour: 0, protection: 25, weight: 1, value: 1 }));
    tick(helmed, 2);
    expect(firstHurt(helmed)).toBeUndefined();
  });

  it('adds the character’s strength to blows, and lands critical strikes for double damage', () => {
    const d = new Dungeon(arena(), TABLES, always(0), hero({ critical: 0.5, damageBonus: 1 }));
    d.creatures[0].health = d.creatures[0].maxHealth = 20;
    tick(d, 0.3, click);
    expect(d.events.find((e) => e.type === 'hit')).toMatchObject({ damage: (4 + 1) * 2 });
    expect(notes(d.events)).toContain('Critical strike!');
  });

  it('adds the race’s knack to blows with the weapons it is for', () => {
    const blow = (knack: Hero['knack']) => {
      const d = new Dungeon(arena(), TABLES, always(0), hero({ knack }));
      d.stats.level = 8;
      d.creatures[0].health = d.creatures[0].maxHealth = 20;
      tick(d, 0.3, click);
      return d.events.find((e) => e.type === 'hit');
    };
    expect(blow({ levels: 4, weapons: 'any' })).toMatchObject({ damage: 4 + 2 });
    expect(blow({ levels: 3, weapons: 'bows' })).toMatchObject({ damage: 4 });
  });

  it('adds a Ranger’s level to blows on all but the undead, and lands an Archer’s critical hits only with bows', () => {
    const blow = (h: Partial<Hero>, tables = TABLES) => {
      const d = new Dungeon(arena(), tables, always(0), hero(h));
      d.stats.level = 5;
      d.creatures[0].health = d.creatures[0].maxHealth = 30;
      tick(d, 0.3, click);
      return { hit: d.events.find((e) => e.type === 'hit'), notes: notes(d.events) };
    };
    expect(blow({ levelDamage: true }).hit).toMatchObject({ damage: 4 + 5 });
    const undead = { ...TABLES, creatures: [fakeCreature({ id: 7, health: [3, 3] })], hits: { bodyParts: BODY_PARTS, undead: [7] } };
    // Skeletons receive no Ranger bonus, then halve the edged weapon's damage.
    expect(blow({ levelDamage: true }, undead).hit).toMatchObject({ damage: 2 });
    // A critical hit doubles the blow before the Ranger's level is added.
    expect(blow({ levelDamage: true, critical: 1 }).hit).toMatchObject({ damage: 4 * 2 + 5 });
    const archer = blow({ critical: 1, criticalWith: 'bows' });
    expect(archer.hit).toMatchObject({ damage: 4 });
    expect(archer.notes).not.toContain('Critical strike!');
  });

  it('jumps twice as high as an Acrobat', () => {
    const peak = (leap: number) => {
      const d = new Dungeon(arena(), TABLES, always(0.99), hero({ leap }));
      expect(d.jump()).toBe(true);
      let top = 0;
      for (let t = 0; t < 1.5; t += 1 / 200) {
        d.update(1 / 200, IDLE_INPUT);
        top = Math.max(top, d.player.z ?? 0);
      }
      return top;
    };
    expect(peak(2) / peak(1)).toBeCloseTo(2, 1);
  });

  it('is paralysed now and then by a Lizard Man’s blow, unless immune, and can do nothing until it wears off', () => {
    const tables = { ...TABLES, creatures: [fakeCreature({ id: 3, special: 9, health: [3, 3], damage: [1, 1] })] };
    let roll = 0;
    const d = new Dungeon(arena(), tables, () => roll, hero({ paralysis: 20 }));
    tick(d, 2);
    expect(d.paralysed).toBe(true);
    expect(notes(d.events)).toContain('You have contracted Paralysis (Prevents movement, attacks and casting)');
    expect(d.activeEffects()).toContain('Paralyzed');
    // From now on the blows miss; meanwhile the player can't walk, swing or jump.
    roll = 0.99;
    const x = d.player.x;
    tick(d, 0.5, input({ forward: -1, attack: { held: false, pressed: true, released: true } }));
    expect(d.player.x).toBe(x);
    expect(d.swing).toBeUndefined();
    expect(d.jump()).toBe(false);
    // A roll of 0 holds them for one round.
    tick(d, 5);
    expect(d.paralysed).toBe(false);
    expect(notes(d.events)).toContain('You can move again');
    tick(d, 0.5, input({ forward: -1 }));
    expect(d.player.x).toBeLessThan(x);

    const immune = new Dungeon(arena(), tables, always(0), hero({ paralysis: 0 }));
    tick(immune, 2);
    expect(immune.events.some((e) => e.type === 'hurt')).toBe(true);
    expect(immune.paralysed).toBe(false);
  });

  it('climbs out of a pit four times as fast as a Khajiit or Acrobat', () => {
    const pit = textLevel(['######', '#.OO.#', '#.OO.#', '#....#', '######']);
    const climb = (h: Hero) => {
      const d = new Dungeon(pit, TABLES, always(0), h);
      Object.assign(d.player, { x: 3.4, y: 1.5, z: 0, yaw: 0 });
      tick(d, 1);
      tick(d, 0.5, input({ forward: 1 }));
      return d.climb?.seconds;
    };
    const plain = climb(hero());
    expect(plain).toBeGreaterThan(0);
    expect(climb(hero({ climbPace: 4 }))).toBe(plain! / 4);
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

  it('moves at the character’s own pace', () => {
    const quick = new Dungeon(textLevel(['############', '#@.........#', '############']), TABLES, always(0), hero({ pace: 1.5 }));
    tick(quick, 1, input({ forward: 1 }));
    expect(quick.player.x).toBeCloseTo(1.5 + 2.2 * 1.5, 1);
  });

  it('uses what is on the number keys', () => {
    const d = new Dungeon(arena(), TABLES, always(0));
    const draught = d.inventory.add({ kind: 'potion', name: 'Test Draught', type: -1, heals: 7, weight: 0.5, value: 1 });
    d.setHotkey(0, itemKey(draught));
    d.stats.health = 10;
    d.hotkey(0);
    d.hotkey(0);
    d.hotkey(3);
    expect(d.stats.health).toBe(17);
    expect(notes(d.events)).toEqual(['Test Draught drunk', expect.stringMatching(/^Nothing is on 1/), expect.stringMatching(/^Nothing is on 4/)]);
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

describe('bows', () => {
  const hero = (overrides: Partial<Hero> = {}): Hero => ({ ...DEFAULT_HERO, ...overrides });
  /** A corridor with a creature `at` voxels along it, or none. */
  const range = (at?: number, length = 20) =>
    textLevel(['#'.repeat(length), `#@${'.'.repeat(length - 3)}#`, '#'.repeat(length)], { creatures: at === undefined ? [] : [{ x: at, y: 1.5, type: 0 }] });
  /** A player with the made-up short bow in hand. */
  const archer = (level: ReturnType<typeof textLevel>, h: Partial<Hero> = {}) => {
    const d = new Dungeon(level, BOW_TABLES, always(0), hero(h));
    expect(d.use(itemKey(d.inventory.add(makeWeapon(BOW_TABLES.weapons!, 16))))).toBe('Short Bow equipped');
    return d;
  };
  const hits = (d: Dungeon) => d.events.flatMap((e) => (e.type === 'hit' ? [e] : []));
  const shots = (d: Dungeon) => sounds(d.events).filter((s) => s === 'ARROWFR.VOC').length;
  const sneakClick = input({ sneaking: true, attack: { held: false, pressed: true, released: true } });

  it('looses an arrow that flies as Arena’s do and strikes the first creature in its way', () => {
    const d = archer(range(8.5));
    d.creatures[0].health = d.creatures[0].maxHealth = 20;
    d.update(0.05, click);
    expect(shots(d)).toBe(1);
    expect(d.swing).toMatchObject({ kind: 'shoot' });
    // It sets off 100 of Arena's units (128 to a voxel) in front of the player and flies 50 a tick.
    expect(d.arrows).toHaveLength(1);
    expect(d.arrows[0].x).toBeCloseTo(1.5 + 100 / 128 + (50 / 128) * 18.2 * 0.05, 1);
    tick(d, 1.5);
    expect(hits(d)).toEqual([expect.objectContaining({ damage: 3, killed: false, far: true })]);
    expect(sounds(d.events)).toContain('ARROWHT.VOC');
    expect(d.arrows).toHaveLength(0);
    expect(d.creatures[0].health).toBe(17);
  });

  it('nocks the next arrow once the reload time is up, shooting on while the button is held', () => {
    const d = archer(range(), { reload: 0.5 });
    d.update(0.05, press);
    tick(d, 0.4, hold);
    expect(shots(d)).toBe(1);
    tick(d, 0.2, hold);
    expect(shots(d)).toBe(2);
    // A click while the next arrow is still being nocked is lost, as in Arena.
    d.update(0.05, click);
    expect(shots(d)).toBe(2);
    // There is no guard with a bow.
    tick(d, 0.2, input({ block: true }));
    expect(d.blocking).toBe(false);
  });

  it('stops arrows at walls and shut doors, and lets them fall after about 12 voxels', () => {
    const walled = archer(textLevel(['########', '#@..D..#', '########'], { creatures: [{ x: 5.5, y: 1.5, type: 0 }] }));
    walled.update(0.05, click);
    tick(walled, 0.5);
    expect(walled.arrows).toHaveLength(0);
    expect(hits(walled)).toHaveLength(0);
    const d = archer(range());
    d.update(0.05, click);
    tick(d, 1.5);
    expect(d.arrows).toHaveLength(1);
    // It falls 30 of Arena's ticks after setting off, 100 + 30 * 50 units from where it was loosed.
    tick(d, 0.3);
    expect(d.arrows).toHaveLength(0);
  });

  it('strikes with the bow’s damage, the Wood Elf’s knack and an Archer’s critical hits, and double from hiding', () => {
    const first = (h: Partial<Hero>, i = click) => {
      // Point blank: the arrow strikes on its way out.
      const d = archer(range(2.7), h);
      d.stats.level = 6;
      d.creatures[0].health = d.creatures[0].maxHealth = 30;
      d.update(0.05, i);
      return { hit: hits(d)[0], notes: notes(d.events) };
    };
    expect(first({}).hit).toMatchObject({ damage: 3, far: true });
    expect(first({ knack: { levels: 3, weapons: 'bows' } }).hit).toMatchObject({ damage: 3 + 2 });
    expect(first({ knack: { levels: 3, weapons: 'melee' } }).hit).toMatchObject({ damage: 3 });
    const crit = first({ critical: 1, criticalWith: 'bows' });
    expect(crit.hit).toMatchObject({ damage: 3 * 2 });
    expect(crit.notes).toContain('Critical strike!');
    expect(first({ critical: 1 }).hit).toMatchObject({ damage: 3 });
    const sneaky = first({}, sneakClick);
    expect(sneaky.hit).toMatchObject({ damage: 3 * SNEAK_SHOT });
    expect(sneaky.notes).toContain(`Sneak attack for ${SNEAK_SHOT}x damage!`);
  });

  it('cuts a shot short when the weapon changes, and swings again with a blade', () => {
    const d = archer(range(2.7));
    d.creatures[0].health = d.creatures[0].maxHealth = 30;
    d.update(0.05, click);
    const sword = d.inventory.items.find((i) => i.name === 'Shortsword')!;
    expect(d.use(itemKey(sword))).toBe('Shortsword equipped');
    expect(d.swing).toBeUndefined();
    tick(d, 0.3, click);
    expect(hits(d).map((e) => e.far)).toEqual([true, undefined]);
  });
});
