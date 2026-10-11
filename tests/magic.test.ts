import { describe, expect, it } from 'vitest';
import type { ExeData } from '../src/formats/exe';
import { parseSpells } from '../src/formats/spells';
import { DEFAULT_HERO, type Hero } from '../src/game/combat';
import { Dungeon, IDLE_INPUT, type DungeonEvent, type DungeonInput } from '../src/game/dungeon';
import { ROUND, spellKey } from '../src/game/magic';
import { always, fakeCreature, textLevel } from './helpers/level';
import { file, record } from './helpers/spells';

// Made-up spells; none of these numbers come from the game.
const SPELLS = parseSpells(
  file(
    record({ name: 'Dart', target: 2, element: 0, params: [[5, 5, 0, 0, 0, 0]], cost: 10 }),
    record({ name: 'Mend', target: 0, element: 5, effects: [12], subs: [1], params: [[10, 10, 0, 0, 0, 0]], cost: 8 }),
    record({ name: 'Blast', target: 4, element: 0, params: [[3, 3, 0, 0, 0, 0]], cost: 30 }),
    record({ name: 'Gaze', target: 2, element: 4, effects: [0], subs: [2], params: [[100, 0, 1, 0, 0, 2]], cost: 40 }),
    record({ name: 'Ward', target: 0, element: 5, effects: [2], params: [[6, 0, 0, 0, 0, 0]], cost: 50 }),
    record({ name: 'Unlock', target: 0, element: 5, effects: [19], params: [[100, 0, 0, 0, 0, 0]], cost: 60 }),
    record({ name: 'Zap', target: 1, element: 3, params: [[4, 4, 0, 0, 0, 0]], cost: 70 }),
  ),
);
const spell = (name: string) => SPELLS.find((s) => s.name === name)!;

const TABLES: ExeData = { creatures: [fakeCreature({ health: [20, 20], damage: [5, 5], level: 1 })], weapons: [] };
const caster = (overrides: Partial<Hero> = {}): Hero => ({ ...DEFAULT_HERO, magicka: 100, ...overrides });
const room = (creatures: Array<{ x: number; y: number }> = [{ x: 4.5, y: 1.5 }]) =>
  textLevel(['#######', '#@....#', '#######'], { creatures: creatures.map((c) => ({ ...c, type: 0 })) });

const cast = { ...IDLE_INPUT, block: true };
function tick(d: Dungeon, seconds: number, i: DungeonInput = IDLE_INPUT): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.05) d.update(0.05, i);
}
const hits = (events: DungeonEvent[]) => events.flatMap((e) => (e.type === 'hit' ? [e.damage] : []));
const notes = (events: DungeonEvent[]) => events.flatMap((e) => (e.type === 'notify' ? [e.text] : []));

describe('magic in the dungeon', () => {
  it('teaches a caster the cheapest healing and offensive spells, readies the offensive one, and makes both favourites', () => {
    const d = new Dungeon(room(), TABLES, always(0), caster(), SPELLS);
    expect(d.spellbook.map((s) => s.name)).toEqual(['Mend', 'Dart']);
    expect(d.readied?.name).toBe('Dart');
    expect(d.inventory.favourites).toEqual(expect.arrayContaining([spellKey(spell('Mend')), spellKey(spell('Dart'))]));
    expect(d.stats).toMatchObject({ magicka: 100, maxMagicka: 100 });
  });

  it('knows no spells without spell points', () => {
    const d = new Dungeon(room(), TABLES, always(0), DEFAULT_HERO, SPELLS);
    expect(d.spellbook).toEqual([]);
    expect(d.readied).toBeUndefined();
  });

  it('casts the readied spell with the block button: a bolt that flies to the creature and hurts it', () => {
    const d = new Dungeon(room(), TABLES, always(0), caster(), SPELLS);
    d.update(0.05, cast);
    expect(d.events.some((e) => e.type === 'cast')).toBe(true);
    expect(d.bolts).toHaveLength(1);
    expect(d.stats.magicka).toBe(90);
    expect(d.blocking).toBe(false);
    tick(d, 1, cast);
    expect(d.bolts).toHaveLength(0);
    expect(hits(d.events)).toEqual([5]);
    expect(d.creatures[0].health).toBe(15);
    // Holding the button casts once.
    expect(d.stats.magicka).toBe(90);
  });

  it('costs less at higher levels: the spell’s cost divided by the level', () => {
    const d = new Dungeon(room(), TABLES, always(0), caster(), SPELLS);
    d.stats.level = 4;
    expect(d.spellCost(spell('Blast'))).toBe(8);
  });

  it('won’t cast without spell points enough', () => {
    const d = new Dungeon(room(), TABLES, always(0), caster({ magicka: 5 }), SPELLS);
    d.update(0.05, cast);
    expect(d.bolts).toHaveLength(0);
    expect(d.events.some((e) => e.type === 'noMagicka')).toBe(true);
    expect(d.stats.magicka).toBe(5);
  });

  it('catches every creature near an area spell’s burst', () => {
    const d = new Dungeon(room([{ x: 4.5, y: 1.5 }, { x: 5.4, y: 1.5 }]), TABLES, always(0), caster(), SPELLS);
    d.spellbook.push(spell('Blast'));
    d.use(spellKey(spell('Blast')));
    d.update(0.05, cast);
    tick(d, 1);
    expect(hits(d.events)).toEqual([3, 3]);
    expect(d.events.find((e) => e.type === 'burst')).toMatchObject({ radius: expect.any(Number) });
  });

  it('heals the caster', () => {
    const d = new Dungeon(room([]), TABLES, always(0), caster({ health: 40 }), SPELLS);
    d.stats.health = 20;
    d.use(spellKey(spell('Mend')));
    d.update(0.05, cast);
    expect(d.stats.health).toBeCloseTo(30, 1);
    expect(d.stats.magicka).toBe(92);
  });

  it('paralyzes a creature for the rounds the spell gives', () => {
    const d = new Dungeon(room(), TABLES, always(0), caster(), SPELLS);
    d.spellbook.push(spell('Gaze'));
    d.use(spellKey(spell('Gaze')));
    d.update(0.05, cast);
    tick(d, 0.6);
    const c = d.creatures[0];
    // "%5 rnd(s) per %2 level(s)": 2 rounds at level 1.
    expect(c.paralysed).toBeGreaterThan(2 * ROUND - 1);
    expect(notes(d.events)).toContain('The Mudcrab is paralyzed');
    const at = { x: c.x, y: c.y };
    tick(d, 3);
    expect({ x: c.x, y: c.y }).toEqual(at);
  });

  it('takes blows on a shield spell first', () => {
    const d = new Dungeon(room([{ x: 2.3, y: 1.5 }]), TABLES, always(0), caster({ health: 40 }), SPELLS);
    d.spellbook.push(spell('Ward'));
    d.use(spellKey(spell('Ward')));
    d.update(0.05, cast);
    expect(d.shield).toBe(6);
    tick(d, 3);
    // Each 5-point blow eats the shield before it reaches the player.
    expect(d.shield).toBeLessThan(6);
    expect(d.stats.health).toBeGreaterThan(40 - 15);
  });

  it('opens the locked door in front, and refuses with none there', () => {
    const level = textLevel(['#####', '#@L.#', '#####']);
    const d = new Dungeon(level, TABLES, always(0), caster(), SPELLS);
    d.spellbook.push(spell('Unlock'));
    d.use(spellKey(spell('Unlock')));
    d.update(0.05, cast);
    expect(d.locked(7)).toBe(false);
    expect(d.doors.get(7)!.target).toBe(1);
    const elsewhere = new Dungeon(room([]), TABLES, always(0), caster(), SPELLS);
    elsewhere.spellbook.push(spell('Unlock'));
    elsewhere.use(spellKey(spell('Unlock')));
    elsewhere.update(0.05, cast);
    expect(notes(elsewhere.events)).toContain('There is no locked door in front of you');
    expect(elsewhere.stats.magicka).toBe(100);
  });

  it('needs a creature in reach for a touch spell', () => {
    const d = new Dungeon(room([{ x: 2.6, y: 1.5 }]), TABLES, always(0), caster(), SPELLS);
    d.spellbook.push(spell('Zap'));
    d.use(spellKey(spell('Zap')));
    d.update(0.05, cast);
    expect(hits(d.events)).toEqual([4]);
    const far = new Dungeon(room(), TABLES, always(0), caster(), SPELLS);
    far.spellbook.push(spell('Zap'));
    far.use(spellKey(spell('Zap')));
    far.update(0.05, cast);
    expect(notes(far.events)).toContain('There is nothing in reach to touch');
  });

  it('readies and puts away spells from the menu and the hotkeys, and blocks again with none in hand', () => {
    const d = new Dungeon(room([]), TABLES, always(0), caster(), SPELLS);
    expect(d.use(spellKey(spell('Dart')))).toBe('Dart put away');
    tick(d, 0.1, cast);
    expect(d.blocking).toBe(true);
    d.setHotkey(2, spellKey(spell('Mend')));
    d.hotkey(2);
    expect(d.readied?.name).toBe('Mend');
    d.hotkey(2);
    expect(d.readied?.name).toBe('Mend');
    expect(d.spellEntries().map((e) => [e.name, e.equipped, e.hotkey])).toEqual([
      ['Mend', true, 2],
      ['Dart', false, undefined],
    ]);
  });

  it('learns no spell by levelling: in Arena spells are bought from the Mages Guild', () => {
    const d = new Dungeon(room(), { ...TABLES, creatures: [fakeCreature({ health: [1, 1], experience: 5000 })] }, always(0), caster(), SPELLS);
    const known = d.spellbook.map((s) => s.name);
    d.update(0.05, cast);
    // Long enough for a game minute to pass, when Arena gives the level.
    tick(d, 6);
    expect(d.stats.level).toBeGreaterThan(1);
    expect(d.spellbook.map((s) => s.name)).toEqual(known);
  });
});
