import { describe, expect, it } from 'vitest';
import { spawnCreature } from '../src/game/creatures';
import { Curve, Director, DISSOLVE, DIP, Film, FIRST_FADE, type Shot } from '../src/game/flythrough';
import { fakeCreature, textLevel } from './helpers/level';

/** A seeded random, so the plans come out the same each run. */
function seeded(seed = 7) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const ROWS = [
  '####################',
  '#........#.........#',
  '#........#.........#',
  '#........D.........#',
  '#........#.........#',
  '#####.####...~~~...#',
  '#####.####...~~~...#',
  '#####.####...~~~...#',
  '#####......@.......#',
  '####################',
];

function setting(random = seeded()) {
  const level = textLevel(ROWS);
  const creatures = [spawnCreature(1, fakeCreature(), 3.5, 2.5, random), spawnCreature(2, fakeCreature({ name: 'Bat' }), 15.5, 2.5, random)];
  return { level, creatures, random };
}

/** Whether the camera is somewhere it can be: open floor or over water, never in a wall or a door. */
function inTheOpen(level: ReturnType<typeof textLevel>, x: number, y: number): boolean {
  const cell = level.cells[Math.floor(y) * level.width + Math.floor(x)];
  return cell?.kind === 'empty';
}

describe('the film behind the main menu', () => {
  it('plans every kind of shot over and over, all inside the dungeon', () => {
    const { level, creatures, random } = setting();
    const director = new Director(level, creatures, random);
    const kinds = new Set<string>();
    for (let n = 0; n < 40; n++) {
      const shot = director.next();
      kinds.add(shot.kind);
      expect(shot.duration).toBeGreaterThan(3);
      for (let t = 0; t <= shot.duration; t += 0.25) {
        const p = shot.pose(t);
        expect(inTheOpen(level, p.x, p.y)).toBe(true);
        expect(p.z).toBeLessThan(level.height);
      }
    }
    expect([...kinds].sort()).toEqual(['approach', 'charge', 'glide', 'low', 'pan', 'water']);
  });

  it('keeps the creature in view in the shots about one', () => {
    const { level, creatures, random } = setting();
    const director = new Director(level, creatures, random);
    for (let n = 0; n < 30; n++) {
      const shot = director.next();
      if (!shot.subject) continue;
      for (const t of [0, shot.duration / 2, shot.duration]) {
        const p = shot.pose(t);
        expect(p.lookX).toBe(shot.subject.x);
        expect(p.lookY).toBe(shot.subject.y);
        // Not on top of it.
        expect(Math.hypot(p.x - shot.subject.x, p.y - shot.subject.y)).toBeGreaterThan(1);
      }
    }
  });

  it('flies over the water low, as a swimmer sees it', () => {
    const { level, creatures, random } = setting();
    const director = new Director(level, creatures, random);
    let water: Shot | undefined;
    for (let n = 0; n < 20 && !water; n++) {
      const shot = director.next();
      if (shot.kind === 'water') water = shot;
    }
    expect(water).toBeDefined();
    for (let t = 0; t <= water!.duration; t += 0.5) {
      const p = water!.pose(t);
      expect(level.cells[Math.floor(p.y) * level.width + Math.floor(p.x)].chasm).toBe('wet');
      expect(p.z).toBeLessThan(0);
    }
  });

  it('comes up out of black, dissolves from shot to shot and dips to black now and then', () => {
    const { level, creatures, random } = setting();
    const film = new Film(new Director(level, creatures, random), level, creatures, random);
    let frame = film.frame();
    expect(frame.black).toBe(1);
    let sawDissolve = false;
    let sawDip = false;
    let shots = 0;
    let last = frame.current.shot;
    for (let step = 0; step < 60 * 90; step++) {
      frame = film.advance(1 / 60);
      if (film.time > FIRST_FADE && frame.black > 0.99) sawDip = true;
      if (frame.fading) {
        sawDissolve = true;
        expect(frame.fading.weight).toBeGreaterThanOrEqual(0);
        expect(frame.fading.weight).toBeLessThanOrEqual(1);
        expect(frame.current.t).toBeLessThanOrEqual(DISSOLVE + 1e-6);
      }
      if (frame.current.shot !== last) {
        shots++;
        last = frame.current.shot;
        if (last.opening === 'black') expect(frame.black).toBeGreaterThan(0.95);
      }
    }
    expect(film.frame().black).toBeLessThan(1);
    expect(shots).toBeGreaterThan(8);
    expect(sawDissolve).toBe(true);
    expect(sawDip).toBe(true);
    expect(DIP).toBeLessThan(DISSOLVE);
  });

  it('lets the creatures go about their business, and sends the one in a charge at the camera', () => {
    const { level, creatures, random } = setting();
    const film = new Film(new Director(level, creatures, random), level, creatures, random);
    const states = new Set<string>();
    let charged = false;
    for (let step = 0; step < 60 * 120; step++) {
      const frame = film.advance(1 / 60);
      for (const c of creatures) states.add(c.state);
      const { shot } = frame.current;
      if (shot.kind === 'charge' && shot.subject && (shot.subject.state === 'chase' || shot.subject.state === 'attack')) charged = true;
      if (shot.kind !== 'charge') {
        for (const c of creatures) if (c !== frame.fading?.shot.subject) expect(c.state === 'chase' || c.state === 'attack').toBe(false);
      }
    }
    expect(charged).toBe(true);
    expect(states.has('wander')).toBe(true);
    expect(creatures.every((c) => c.health === c.maxHealth)).toBe(true);
  });

  it('walks a smooth path at an even pace and carries on straight past its ends', () => {
    const curve = new Curve([
      [0, 0],
      [2, 0],
      [2, 2],
    ]);
    // A little longer than the corner it rounds.
    expect(curve.length).toBeGreaterThan(4);
    expect(curve.length).toBeLessThan(4.3);
    expect(curve.at(0)).toEqual([0, 0]);
    const end = curve.at(curve.length);
    expect(end[0]).toBeCloseTo(2);
    expect(end[1]).toBeCloseTo(2);
    const past = curve.at(curve.length + 1);
    expect(past[0]).toBeCloseTo(2, 1);
    expect(past[1]).toBeCloseTo(3, 1);
    const before = curve.at(-1);
    expect(before[0]).toBeCloseTo(-1, 1);
    // Even steps along it are even steps in space.
    const a = curve.at(1);
    const b = curve.at(1.5);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(0.5, 1);
  });
});
