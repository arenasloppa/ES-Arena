import { describe, expect, it } from 'vitest';
import { parseSpells, SPELL_SIZE, SpellFormatError, type SpellRecord } from '../src/formats/spells';
import { DEFAULT_HERO, gainExperience, newPlayerStats } from '../src/game/combat';
import {
  castable,
  chance,
  describe as describeSpell,
  duration,
  durationRounds,
  magickaCost,
  magnitude,
  magnitudeRange,
  nextSpell,
  ROUND,
  startingMagicka,
  startingSpells,
} from '../src/game/magic';
import { always } from './helpers/level';
import { file, record } from './helpers/spells';

describe('the spell list', () => {
  it('reads names, targets, elements, effects, their numbers and costs, and skips blank records', () => {
    const spells = parseSpells(
      file(
        record({ name: 'Ember', target: 4, element: 0, params: [[1, 1, 4, 12, 1, 0]], cost: 325 }),
        new Uint8Array(SPELL_SIZE),
        record({ name: 'Mend', target: 0, element: 5, effects: [12], subs: [1] }),
      ),
    );
    expect(spells.map((s) => [s.index, s.name, s.target, s.cost])).toEqual([
      [0, 'Ember', 'areaTarget', 325],
      [2, 'Mend', 'caster', 100],
    ]);
    expect(spells[0].effects).toEqual([{ effect: 4, sub: 0, attribute: 0, params: [1, 1, 4, 12, 1, 0] }]);
    expect(spells[1].effects[0].sub).toBe(1);
  });

  it('reads each effect’s own numbers', () => {
    const [s] = parseSpells(file(record({ name: 'Two', effects: [4, 0], subs: [0, 2], params: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]] })));
    expect(s.effects.map((e) => e.params)).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
    ]);
  });

  it('rejects a file that is not whole records', () => {
    expect(() => parseSpells(new Uint8Array(100))).toThrow(SpellFormatError);
  });
});

describe('spell rules', () => {
  const [bolt, mend, lift, spark] = parseSpells(
    file(
      record({ name: 'Bolt', params: [[1, 10, 1, 2, 1, 0]], cost: 100 }),
      record({ name: 'Mend', target: 0, effects: [12], subs: [1], cost: 50 }),
      record({ name: 'Lift', target: 0, effects: [16], cost: 20 }),
      record({ name: 'Spark', params: [[1, 2, 1, 1, 1, 0]], cost: 80 }),
    ),
  );

  it('casts only spells whose effects the remake can do', () => {
    expect(castable(bolt)).toBe(true);
    expect(castable(mend)).toBe(true);
    expect(castable(lift)).toBe(false);
  });

  it('rolls damage plus more for every so many levels', () => {
    expect(magnitude(bolt.effects[0], 3, always(0))).toBe(1 + 3);
    expect(magnitude(bolt.effects[0], 3, always(0.999))).toBe(10 + 6);
    expect(magnitudeRange(bolt.effects[0], 3)).toEqual([4, 16]);
    expect(describeSpell(bolt, 1)).toEqual(['2–12 damage to health']);
  });

  it('reads durations as the spellmaker describes them', () => {
    // "%0%% chance to paralyze. +%1%% every %4 level(s). Duration is %5 rnd(s) per %2 level(s)."
    const [gaze] = parseSpells(file(record({ name: 'Gaze', effects: [0], subs: [2], params: [[50, 2, 1, 0, 1, 1]] })));
    expect(chance(gaze.effects[0], 3)).toBe(56);
    expect(durationRounds(gaze.effects[0], 3)).toBe(3);
    expect(duration(gaze.effects[0], 3)).toBe(3 * ROUND);
  });

  it('costs the spell’s cost divided by the caster’s level', () => {
    expect(magickaCost(bolt, 1)).toBe(100);
    expect(magickaCost(bolt, 10)).toBe(10);
    expect(magickaCost(bolt, 3)).toBe(34);
  });

  it('gives spell points by class, none to classes that can’t cast', () => {
    expect(startingMagicka({ name: 'Warrior', spellcaster: false }, 80)).toBe(0);
    expect(startingMagicka({ name: 'Mage', spellcaster: true }, 50)).toBe(100);
    expect(startingMagicka({ name: 'Sorcerer', spellcaster: true }, 50)).toBe(150);
    expect(startingMagicka({ name: 'Battlemage', spellcaster: true }, 50)).toBe(87);
  });

  it('starts a caster with the cheapest healing and offensive spells, and teaches the next cheapest', () => {
    const all = [bolt, mend, lift, spark];
    expect(startingSpells(all).map((s: SpellRecord) => s.name)).toEqual(['Mend', 'Spark']);
    expect(nextSpell(all, startingSpells(all))?.name).toBe('Bolt');
  });

  it('keeps spell points the same from level to level, refilling them', () => {
    const caster = newPlayerStats({ name: 'Staff', damage: [1, 2], cif: 'STAFF.CIF' }, { ...DEFAULT_HERO, magicka: 100 });
    caster.magicka = 10;
    gainExperience(caster, DEFAULT_HERO.experience, always(0));
    expect([caster.maxMagicka, caster.magicka]).toEqual([100, 100]);
  });
});
