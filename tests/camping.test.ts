import { describe, expect, it } from 'vitest';
import type { EncounterTables, ExeData } from '../src/formats/exe';
import { CAMPING_TIME_SCALE, chooseEncounter, GAME_SECONDS_PER_SECOND, needsRest, restHealing, spawnSpot, type Resting } from '../src/game/camping';
import { Dungeon, IDLE_INPUT, type DungeonEvent } from '../src/game/dungeon';
import { DEFAULT_HERO } from '../src/game/combat';
import { always, fakeCreature, textLevel } from './helpers/level';

/** A random number that Arena's dice turn into the given whole number. */
const raw = (n: number) => (n + 0.5) / 0x10000;
/** Returns the numbers given in turn, then the last one over and over. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};
/** Real seconds an hour of camping takes. */
const HOUR = 3600 / (GAME_SECONDS_PER_SECOND * CAMPING_TIME_SCALE);

const worn = (): Resting => ({ health: 10, maxHealth: 40, stamina: 20, maxStamina: 100, magicka: 0, maxMagicka: 40 });

describe('camping rules', () => {
  it('heals as Arena does each sixth of a second: health by the heal mod and class, fatigue, and an eighth of the spell points', () => {
    const p = worn();
    restHealing(p, { healMod: 0, regainsMagicka: true });
    // 40 * 60 / 1000; fatigue 100 is 256 on Arena's scale, 16 a tick, times 70, back to 7; 40 / 8.
    expect(p).toMatchObject({ health: 12, stamina: 27, magicka: 5 });
    const healer = worn();
    restHealing(healer, { className: 'Healer', healMod: 0, regainsMagicka: false });
    expect(healer).toMatchObject({ health: 13, magicka: 0 });
    // Always at least one point of health.
    const small = { ...worn(), health: 1, maxHealth: 10 };
    restHealing(small, { healMod: -2, regainsMagicka: true });
    expect(small.health).toBe(2);
  });

  it('needs rest while anything is short, fatigue by more than a point', () => {
    const full = { health: 40, maxHealth: 40, stamina: 99.5, maxStamina: 100, magicka: 40, maxMagicka: 40 };
    expect(needsRest(full, { healMod: 0, regainsMagicka: true })).toBe(false);
    expect(needsRest({ ...full, magicka: 0 }, { healMod: 0, regainsMagicka: true })).toBe(true);
    expect(needsRest({ ...full, magicka: 0 }, { healMod: 0, regainsMagicka: false })).toBe(false);
    expect(needsRest({ ...full, stamina: 98 }, { healMod: 0, regainsMagicka: false })).toBe(true);
  });

  it('picks an encounter of a level near the player’s from the dungeon list', () => {
    // Made up: the dungeon list (7) has level 1 at entries 0 and 2, level 2 at 1 and 3.
    const tables: EncounterTables = {
      chances: new Array(13).fill(0),
      table: [
        { count: 2, id: 1, level: 0 },
        { count: 1, id: 2, level: 0 },
        { count: 1, id: 3, level: 0 },
        { count: 3, id: 4, level: 0 },
      ],
      levels: Array.from({ length: 14 }, (_, i) => (i === 7 ? [1, 2, 1, 2] : [0, 0, 0, 0])),
    };
    // Level 1 + 1 + 0; a roll of 3 on 1d4 is folded back to 1; the second of the two level 1 entries.
    expect(chooseEncounter(tables, 1, sequence(raw(0), raw(3), raw(1)))).toEqual({ count: 1, id: 3, level: 0 });
    // A roll of 2 keeps level 2; the first of its entries.
    expect(chooseEncounter(tables, 1, sequence(raw(0), raw(2), raw(0)))).toEqual({ count: 1, id: 2, level: 0 });
  });

  it('finds open floor near the player for what comes, never their own cell, water or a wall', () => {
    const level = textLevel(['#####', '#~~.#', '#~@~#', '#~~~#', '#####']);
    // Arena's numbers shifted down six places: 8192 is a cell east, -8192 a cell north; then water, over and over.
    const east = raw(8192);
    const north = raw(0x10000 - 8192);
    expect(spawnSpot(level, 2.5, 2.5, sequence(east, north))).toEqual({ x: 3.5, y: 1.5 });
    expect(spawnSpot(level, 2.5, 2.5, sequence(east, north), [{ x: 3.5, y: 1.5 }])).toBeUndefined();
    expect(spawnSpot(level, 2.5, 2.5, always(raw(0)))).toBeUndefined();
  });
});

const TABLES: ExeData = {
  creatures: [fakeCreature({ health: [3, 3] })],
  weapons: [{ name: 'Shortsword', damage: [4, 4], twoHanded: false }],
  messages: { enemiesNearby: 'NEAR', doneWakeUp: 'WAKE', doneHealed: 'HEALED', fullyRested: 'RESTED', enemiesWhileResting: 'AMBUSH', hoursRemaining: '%u hours remaining...', hourRemaining: '%u hour remaining...' },
};

const ROOM = ['##########', '#@.......#', '#........#', '##########'];

function rest(d: Dungeon, seconds: number): DungeonEvent[] {
  for (let t = 0; t < seconds; t += 0.05) d.update(0.05, IDLE_INPUT);
  return d.events.splice(0);
}

const said = (events: DungeonEvent[]) => events.flatMap((e) => (e.type === 'camped' ? [e.text] : []));

describe('camping in the dungeon', () => {
  it('rests the hours asked, healing, counting down in the game’s words, and wakes', () => {
    const d = new Dungeon(textLevel(ROOM), TABLES, always(0.99), { ...DEFAULT_HERO, health: 40 });
    d.stats.health = 5;
    expect(d.camp(3)).toBeUndefined();
    expect(d.campingText).toBe('3 hours remaining...');
    rest(d, HOUR * 1.2);
    expect(d.campingText).toBe('2 hours remaining...');
    const events = rest(d, HOUR * 2);
    expect(said(events)).toEqual(['WAKE']);
    expect(d.camping).toBeUndefined();
    expect(d.stats.health).toBeGreaterThan(5);
  });

  it('won’t rest with a monster near, nor until healed with nothing to heal', () => {
    const level = textLevel(ROOM, { creatures: [{ x: 4.5, y: 1.5, type: 0 }] });
    expect(new Dungeon(level, TABLES, always(0.5)).camp(8)).toBe('NEAR');
    const d = new Dungeon(textLevel(ROOM), TABLES, always(0.5));
    d.stats.stamina = d.stats.maxStamina;
    expect(d.camp('healed')).toBe('RESTED');
    d.stats.health = 1;
    expect(d.camp('healed')).toBeUndefined();
    expect(said(rest(d, HOUR * 30))).toEqual(['HEALED']);
    expect(d.stats.health).toBe(d.stats.maxHealth);
  });

  it('brings Ria at the first rest from level 2: the Staff, then Fang Lair; only Fang Lair from level 3', () => {
    const dreams = (level: number) => {
      const d = new Dungeon(textLevel(ROOM), TABLES, always(0.5));
      d.stats.level = level;
      d.camp(1);
      const first = d.events.splice(0).flatMap((e) => (e.type === 'dream' ? [e.visions] : []));
      d.stopCamping();
      d.camp(1);
      return [first, d.events.flatMap((e) => (e.type === 'dream' ? [e.visions] : []))];
    };
    expect(dreams(1)).toEqual([[], []]);
    expect(dreams(2)).toEqual([[['staffIntro', 'fangLair']], []]);
    expect(dreams(3)).toEqual([[['fangLair']], []]);
  });

  it('is ended by monsters that come upon the player, at the game’s chance an hour', () => {
    const encounters: EncounterTables = {
      chances: [0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0],
      table: [{ count: 1, id: 1, level: 0 }],
      levels: Array.from({ length: 14 }, () => [1]),
    };
    // The encounter's roll, the level (2, then a roll of 1d4 folding to 1), which entry, then the spot: one cell east.
    const d = new Dungeon(textLevel(ROOM), { ...TABLES, encounters }, sequence(0.5, raw(0), raw(3), raw(0), raw(64 * 128), raw(0)));
    expect(d.camp(8)).toBeUndefined();
    const events = rest(d, HOUR * 1.5);
    expect(events.some((e) => e.type === 'spawned')).toBe(true);
    expect(said(events)).toEqual(['AMBUSH']);
    expect(d.creatures).toHaveLength(1);
  });
});
