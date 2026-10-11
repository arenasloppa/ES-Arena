import { describe, expect, it } from 'vitest';
import { parseInf } from '../src/formats/inf';
import { parseMif } from '../src/formats/mif';
import { ARENA_HEIGHT, buildLevel, isBlocking } from '../src/game/level';
import { airborne, blockedAt, doorInFront, groundUnder, jump, JUMP_HEIGHT, JUMP_TIME, settle, step, type PlayerState } from '../src/game/player';
import { textLevel } from './helpers/level';
import * as THREE from 'three';
import { buildLevelGeometry, chasmDepth } from '../src/render/levelGeometry';
import { doorObject, poseDoor } from '../src/render/levelScene';
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
// Wall numbers count the 2 floor textures first: 4 is wall texture 1 (WALLA.SET frame 0), 3 is DOOR_1.IMG.
const W = 0x0404;
const map1 = [
  W, W, W, W, W,
  W, 0, 0xb003, 0, W,
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
    expect(at(2, 1)).toMatchObject({ kind: 'door', wallTex: 0 });
    expect(at(3, 2).kind).toBe('empty');
    expect(l.flats).toEqual([{ x: 3.5, y: 2.5, name: 'BARREL.IMG', yOffset: undefined }]);
    expect(at(2, 2).chasm).toBe('wet');
    expect(l.chasmTextures.wet).toBe(4);
    expect(at(1, 2)).toMatchObject({ kind: 'raised', wallTex: 1, capTex: 1, capIsWall: true });
    expect(at(1, 1).floorTex).toBe(1);
    expect(l.start).toEqual({ x: 3.5, y: 3.5 });
    expect(l.triggers).toEqual([{ x: 2, y: 3, text: 'Hello there.', once: true }]);
  });

  it('turns the east-to-west MIF rows around so that +x runs east', () => {
    const row = [W, 0, 0, 0xd004, 0xd104];
    const mif = parseMif(makeMif({ width: 5, depth: 1, start: { x: 1.5, y: 0.5 }, map1: row, flor: new Array(5).fill(0x0100) }));
    const l = buildLevel(mif, 0, parseInf(INF));
    expect(l.cells.map((c) => c.kind)).toEqual(['diagonal', 'diagonal', 'empty', 'empty', 'wall']);
    expect(l.cells.slice(0, 2).map((c) => c.diagonalFlip)).toEqual([false, true]);
    expect(l.start).toEqual({ x: 3.5, y: 0.5 });
  });

  it('places items, creatures, locks and trigger sounds', () => {
    const inf = parseInf(
      encryptInf(
        [
          '@FLOORS',
          'floora.set #2',
          '@WALLS',
          'door_1.img',
          'walla.set #3',
          'swater.img',
          '*LEVELUP',
          'gate.img',
          '*TRANS',
          '*DOOR 0',
          'scell.img',
          '@FLATS',
          'barrel.img',
          '*ITEM 1',
          'key.img',
          '*ITEM 5',
          'treasre2.img',
          '*ITEM 33',
          'goblin.dfa',
          '@SOUND',
          'drip1.voc 16',
          '@TEXT',
          '*TEXT 0',
          '+10',
          '*TEXT 2',
          'Rats!',
        ].join('\n'),
      ),
    );
    // MIF columns run east to west, so MIF column x is level column 5 - x.
    const G = 0x0808; // GATE.IMG, wall texture 5
    const map1 = [
      W, W, G, W, W, W,
      W, 0, 0x8002, 0x8003, 0x8000, W,
      W, 0, 0xb009, 0x1800, 0, W,
      W, W, W, W, W, W,
    ];
    const flor = new Array(24).fill(0x0100);
    flor[7] = 0x0102; // KEY.IMG (flat 1, counted from 1 here)
    flor[15] = 0x0101; // a barrel on the raised step
    const mif = parseMif(
      makeMif({ width: 6, depth: 4, map1, flor, triggers: [[1, 1, 0, 255], [4, 2, 2, 16], [4, 1, 255, 16]], locks: [[2, 2, 10]] }),
    );
    const l = buildLevel(mif, 0, inf);
    expect(l.items).toEqual([
      { x: 4.5, y: 1.5, name: 'KEY.IMG', kind: 'key', key: 10 },
      { x: 3.5, y: 1.5, name: 'TREASRE2.IMG', kind: 'treasure' },
    ]);
    expect(l.creatures).toEqual([{ x: 2.5, y: 1.5, type: 1 }]);
    expect(l.flats).toEqual([
      { x: 1.5, y: 1.5, name: 'BARREL.IMG' },
      // Without the game's tables, thickness step 3 of 16 even steps: 25 Arena units.
      { x: 2.5, y: 2.5, name: 'BARREL.IMG', base: 25 * ARENA_HEIGHT },
    ]);
    expect(l.cells[2 * 6 + 3]).toMatchObject({ kind: 'door', wallTex: 6, seeThrough: true });
    expect(l.locks).toEqual(new Map([[2 * 6 + 3, 10]]));
    expect(l.cells[3]).toMatchObject({ kind: 'wall', wallTex: 5, exit: 'up' });
    expect(l.cells[0].exit).toBeUndefined();
    expect(l.triggers).toEqual([
      { x: 1, y: 2, text: 'Rats!', sound: 'DRIP1.VOC' },
      { x: 1, y: 1, sound: 'DRIP1.VOC' },
    ]);
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

  it("draws water's sides against walls too, with the walls standing at the floor's level", () => {
    // Water with walls on three sides and the floor on the fourth.
    const l = textLevel(['####', '#~.#', '####'], { chasmTextures: { wet: 7 } });
    const g = buildLevelGeometry(l);
    const heights = (key: string) => g.batches.get(key)!.positions.filter((_, i) => i % 3 === 1);
    expect(g.batches.get('wall:7')!.indices.length / 6).toBe(4);
    expect(Math.min(...heights('wall:7'))).toBeCloseTo(chasmDepth(l.cells[5], l.height));
    expect(Math.max(...heights('wall:7'))).toBe(0);
    expect(Math.min(...heights('wall:0'))).toBe(0);
  });
});

describe('swinging doors', () => {
  // A cell door in a wall running north to south: the cell is east of it, the corridor west.
  const cellDoor = () => {
    const l = textLevel(['#####', '#.|.#', '#####']);
    l.cells[1 * 5 + 2].door = 'swinging';
    return buildLevelGeometry(l).doors[0];
  };
  const corners = (object: THREE.Object3D) => {
    object.updateMatrixWorld(true);
    const points: Array<{ x: number; z: number }> = [];
    for (const face of object.children as THREE.Mesh[]) {
      const at = face.geometry.getAttribute('position');
      for (let k = 0; k < at.count; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(at, k).applyMatrix4(face.matrixWorld);
        points.push({ x: v.x, z: v.z });
      }
    }
    return points;
  };

  it('has a face for each way through, not for the walls beside it', () => {
    const door = cellDoor();
    expect(door.panels).toHaveLength(2);
    // Arena hinges each face at its left end seen from outside: the cell side at its south end, the corridor side at its north.
    expect(door.panels.map((p) => [p.hinge.x, Math.round(p.hinge.z)])).toEqual(
      expect.arrayContaining([
        [3, 2],
        [2, 1],
      ]),
    );
  });

  it('swings each face in, away from whoever opens it, to lie along the doorway', () => {
    const door = cellDoor();
    const object = doorObject(door, new THREE.MeshBasicMaterial());
    const shut = { kind: door.kind, alongX: door.alongX, mesh: object, openAmount: 0, target: 0 };
    poseDoor(shut, 0, 1);
    // Shut, the faces are the doorway's east and west sides.
    for (const p of corners(object)) expect(Math.abs(p.x - 2.5)).toBeCloseTo(0.5, 5);
    poseDoor(shut, 1, 1);
    // Open, they lie inside the doorway along its north and south walls, just off them, and leave the way clear.
    const open = corners(object);
    for (const p of open) {
      expect(p.x).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(3 + 1e-6);
      expect(Math.min(Math.abs(p.z - 1), Math.abs(p.z - 2))).toBeCloseTo(0.01, 5);
    }
    const south = open.filter((p) => p.z > 1.5).length;
    expect(south).toBe(open.length / 2);
  });

  it('shows only the face on the viewer’s side, as Arena draws it', () => {
    const door = cellDoor();
    const object = doorObject(door, new THREE.MeshBasicMaterial());
    const mesh = { kind: door.kind, alongX: door.alongX, mesh: object, openAmount: 0, target: 0, centre: { x: 2.5, z: 1.5 } };
    const shown = () => object.children.filter((f) => f.visible).map((f) => (f.userData.normal as { x: number }).x);
    poseDoor(mesh, 1, 1, { x: 3.6, z: 1.3 });
    expect(shown()).toEqual([1]);
    poseDoor(mesh, 1, 1, { x: 1.4, z: 1.5 });
    expect(shown()).toEqual([-1]);
  });
});

describe('heights', () => {
  it('jumps 30 Arena units high and lands after the jump’s time', () => {
    const level = textLevel(['#####', '#@..#', '#####']);
    const p: PlayerState = { x: 1.5, y: 1.5, yaw: 0, pitch: 0 };
    expect(jump(level, p)).toBe(true);
    expect(jump(level, p)).toBe(false);
    let peak = 0;
    let t = 0;
    while (t < 1 && (t === 0 || airborne(level, p))) {
      settle(level, p, 1 / 240);
      peak = Math.max(peak, p.z ?? 0);
      t += 1 / 240;
    }
    expect(peak).toBeCloseTo(JUMP_HEIGHT, 2);
    expect(t).toBeCloseTo(JUMP_TIME, 1);
    expect(p.z).toBe(0);
  });

  it('steps up onto a low platform and stands on it, but not onto a tall one', () => {
    const level = textLevel(['######', '#@..R#', '######']);
    const low = level.cells[1 * 6 + 4];
    Object.assign(low, { kind: 'raised', raisedBottom: 0, raisedTop: 25 * ARENA_HEIGHT });
    const p: PlayerState = { x: 1.5, y: 1.5, yaw: 0, pitch: 0, z: 0 };
    for (let i = 0; i < 60; i++) {
      step(level, p, { forward: 1, strafe: 0, run: false }, 1 / 30, new Set());
      settle(level, p, 1 / 30);
    }
    expect(p.x).toBeGreaterThan(4.2);
    expect(p.z).toBeCloseTo(25 * ARENA_HEIGHT);
    Object.assign(low, { raisedTop: 70 * ARENA_HEIGHT });
    const q: PlayerState = { x: 1.5, y: 1.5, yaw: 0, pitch: 0, z: 0 };
    for (let i = 0; i < 60; i++) step(level, q, { forward: 1, strafe: 0, run: false }, 1 / 30, new Set());
    expect(q.x).toBeLessThan(3.81);
  });

  it('drops into water and can’t walk out of it', () => {
    const level = textLevel(['######', '#@~~.#', '######']);
    const p: PlayerState = { x: 1.5, y: 1.5, yaw: 0, pitch: 0, z: 0 };
    for (let i = 0; i < 40; i++) {
      step(level, p, { forward: 1, strafe: 0, run: false }, 1 / 30, new Set());
      settle(level, p, 1 / 30);
    }
    expect(p.z).toBeCloseTo(-25 * ARENA_HEIGHT);
    expect(groundUnder(level, p)).toBeCloseTo(-25 * ARENA_HEIGHT);
    expect(p.x).toBeLessThan(3.81);
  });
});
