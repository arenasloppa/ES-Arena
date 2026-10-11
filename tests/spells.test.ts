import { describe, expect, it } from 'vitest';
import { parseSpells, SPELL_SIZE, SpellFormatError, type SpellRecord } from '../src/formats/spells';
import { DEFAULT_HERO, gainExperience, newPlayerStats } from '../src/game/combat';
import { castable, describe as describeSpell, knownSpells, magickaCost, magnitude, magnitudeRange, startingMagicka } from '../src/game/magic';
import { always } from './helpers/level';

/** One made-up 85-byte spell record; none of these numbers come from the game. */
function record(o: { name: string; target?: number; element?: number; effects?: number[]; subs?: number[]; params?: number[][]; cost?: number }): Uint8Array {
  const b = new Uint8Array(SPELL_SIZE);
  const v = new DataView(b.buffer);
  const effects = o.effects ?? [4];
  // params[row][effect]
  (o.params ?? [[1, 10, 1, 2, 1, 0]]).forEach((p, e) => p.forEach((n, row) => v.setUint16((row * 3 + e) * 2, n, true)));
  b[36] = o.target ?? 2;
  b[38] = o.element ?? 0;
  for (let e = 0; e < 3; e++) {
    b[41 + e] = effects[e] ?? 0xff;
    b[44 + e] = o.subs?.[e] ?? 0;
  }
  v.setUint16(50, o.cost ?? 100, true);
  [...o.name].forEach((c, i) => (b[52 + i] = c.charCodeAt(0)));
  return b;
}

function file(...records: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(records.length * SPELL_SIZE);
  records.forEach((r, i) => out.set(r, i * SPELL_SIZE));
  return out;
}

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
  const [bolt, mend, lift] = parseSpells(
    file(
      record({ name: 'Bolt', params: [[1, 10, 1, 2, 1, 0]], cost: 100 }),
      record({ name: 'Mend', target: 0, effects: [12], subs: [1], cost: 50 }),
      record({ name: 'Lift', target: 0, effects: [16], cost: 20 }),
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
    expect(describeSpell(bolt, 1)).toEqual(['Damage health 2–12']);
  });

  it('gives magicka to spellcasters only, and teaches the spells they can afford twice', () => {
    expect(startingMagicka(false, 80)).toBe(0);
    expect(startingMagicka(true, 50)).toBe(100);
    expect(magickaCost(bolt)).toBe(20);
    expect(knownSpells([bolt, mend, lift], 0)).toEqual([]);
    expect(knownSpells([bolt, mend, lift], 30).map((s: SpellRecord) => s.name)).toEqual(['Mend']);
    expect(knownSpells([bolt, mend, lift], 40).map((s: SpellRecord) => s.name)).toEqual(['Mend', 'Bolt']);
  });

  it('adds magicka each level for those who have some', () => {
    const caster = newPlayerStats({ name: 'Staff', damage: [1, 2], cif: 'STAFF.CIF' }, { ...DEFAULT_HERO, magicka: 100 });
    gainExperience(caster, DEFAULT_HERO.experience, always(0));
    expect([caster.maxMagicka, caster.magicka]).toEqual([110, 110]);
    const fighter = newPlayerStats({ name: 'Staff', damage: [1, 2], cif: 'STAFF.CIF' });
    gainExperience(fighter, DEFAULT_HERO.experience, always(0));
    expect(fighter.maxMagicka).toBe(0);
  });
});
