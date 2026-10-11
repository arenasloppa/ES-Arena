import { describe, expect, it } from 'vitest';
import { parseInf } from '../src/formats/inf';
import { parseMif } from '../src/formats/mif';
import { buildLevel, isBlocking } from '../src/game/level';
import { blockedAt, doorInFront, startJump, step, stepJump, type PlayerState } from '../src/game/player';
import { buildLevelGeometry } from '../src/render/levelGeometry';
import { encryptInf, makeMif } from './helpers/encode';

const INF = encryptInf(
  [
    '@FLOORS',
    'floora.set #2',
    '@WALLS',
    'door_1.img',
    '*BOXCAP 0',
    '*BOXSIDE 0',
    'walla.set #3',
    '*WETCHASM',
    'swater.img',
    '@FLATS',
    'barrel.img',
    '@TEXT',
    '*TEXT 1',
    '~Hello there.',
  ].join('\n'),
);

// 5x5 room: walls around the edge, a door, a barrel, water and a raised box.
//   #####
//   #.D.#
//   #b~r#
//   #...#
//   #####
const W = 0x0202; // wall texture 1 (WALLA.SET frame 0)
const map1 = [
  W, W, W, W, W,
  W, 0, 0xb002, 0, W,
  W, 0x8000, 0, 0x1800, W,
  W, 0, 0, 0, W,
  W, W, W, W, W,
];
const flor = new Array(25).fill(0x0100);
flor[12] = 0x0d00;

function level() {
  const mif = parseMif(makeMif({ width: 5, depth: 5, start: { x: 1.5, y: 3.5 }, map1, flor, triggers: [[2, 3, 1, 255]] }));
  return buildLevel(mif, 0, parseInf(INF));
}

describe('buildLevel', () => {
  // The level is the MIF grid mirrored east-west, so MIF column x lands in column 4 - x here.
  it('decodes walls, doors, flats, chasms and raised platforms', () => {
    const l = level();
    const at = (x: number, y: number) => l.cells[y * 5 + x];
    expect(at(0, 0)).toMatchObject({ kind: 'wall', wallTex: 1 });
    expect(l.wallTextures[1]).toEqual({ file: 'WALLA.SET', frame: 0 });
    expect(at(2, 1)).toMatchObject({ kind: 'door', wallTex: 1 });
    expect(at(3, 2).kind).toBe('empty');
    expect(l.flats).toEqual([{ x: 3.5, y: 2.5, name: 'BARREL.IMG', yOffset: undefined }]);
    expect(at(2, 2).chasm).toBe('wet');
    expect(l.chasmTextures.wet).toBe(4);
    expect(at(1, 2)).toMatchObject({ kind: 'raised', wallTex: 1, capTex: 1, capIsWall: true });
    expect(at(1, 1).floorTex).toBe(1);
    expect(l.start).toEqual({ x: 3.5, y: 3.5 });
    expect(l.triggers).toEqual([{ x: 2, y: 3, text: 'Hello there.' }]);
  });

  it('turns the east-to-west MIF rows around so that +x runs east', () => {
    const row = [0x0202, 0, 0, 0xd002, 0xd102];
    const mif = parseMif(makeMif({ width: 5, depth: 1, start: { x: 1.5, y: 0.5 }, map1: row, flor: new Array(5).fill(0x0100) }));
    const l = buildLevel(mif, 0, parseInf(INF));
    expect(l.cells.map((c) => c.kind)).toEqual(['diagonal', 'diagonal', 'empty', 'empty', 'wall']);
    expect(l.cells.slice(0, 2).map((c) => c.diagonalFlip)).toEqual([false, true]);
    expect(l.start).toEqual({ x: 3.5, y: 0.5 });
  });

  it('blocks walls and closed doors only', () => {
    const l = level();
    expect(isBlocking(l.cells[0])).toBe(true);
    expect(isBlocking(l.cells[7])).toBe(true);
    expect(isBlocking(l.cells[7], new Set([7]), 7)).toBe(false);
    expect(isBlocking(l.cells[6])).toBe(false);
  });
});

describe('player movement', () => {
  it('walks in open space and stops at walls', () => {
    const l = level();
    const p: PlayerState = { x: 1.5, y: 3.5, yaw: Math.PI, pitch: 0 };
    for (let i = 0; i < 60; i++) step(l, p, { forward: 1, strafe: 0, run: false }, 1 / 30, new Set());
    expect(p.x).toBeGreaterThanOrEqual(1.2 - 1e-9);
    expect(p.x).toBeLessThan(1.3);
    expect(blockedAt(l, p.x, p.y, new Set())).toBe(false);
  });

  it('slides along a wall when moving diagonally into it', () => {
    const l = level();
    const p: PlayerState = { x: 1.5, y: 3.5, yaw: Math.PI / 4, pitch: 0 };
    step(l, p, { forward: 1, strafe: 0, run: false }, 0.5, new Set());
    expect(p.x).toBeGreaterThan(1.5);
    expect(p.y).toBeLessThanOrEqual(3.8 + 1e-9);
  });

  it('finds the door in front of the player', () => {
    const l = level();
    expect(doorInFront(l, { x: 2.5, y: 2.5, yaw: -Math.PI / 2, pitch: 0 })).toBe(7);
    expect(doorInFront(l, { x: 2.5, y: 2.5, yaw: Math.PI / 2, pitch: 0 })).toBeUndefined();
  });
});

describe('level geometry', () => {
  it('emits only wall faces that border open cells', () => {
    const g = buildLevelGeometry(level());
    const walls = g.batches.get('wall:1')!;
    // Inner faces of the 3x3 room (12) + raised platform sides (3 open neighbours) + its cap.
    expect(walls.indices.length / 6).toBe(12 + 3 + 1);
    expect(g.doors).toHaveLength(1);
    expect(g.batches.has('liquid:wet')).toBe(true);
    for (const b of g.batches.values()) expect(b.positions.length / 3).toBe((b.indices.length / 6) * 4);
  });
});

describe('jumping', () => {
  it('peaks at the apex halfway through and lands after the full time', () => {
    const j = { height: 0, speed: 0 };
    expect(startJump(j, 0.2, 0.5)).toBe(true);
    expect(startJump(j, 0.2, 0.5)).toBe(false);
    let peak = 0;
    let t = 0;
    while (t < 1 && (t === 0 || j.height > 0)) {
      stepJump(j, 0.2, 0.5, 1 / 240);
      peak = Math.max(peak, j.height);
      t += 1 / 240;
    }
    expect(peak).toBeCloseTo(0.2, 2);
    expect(t).toBeCloseTo(0.5, 1);
    expect(j).toEqual({ height: 0, speed: 0 });
  });
});
