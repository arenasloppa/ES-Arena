import type { CreatureInfo } from '../../src/formats/exe';
import type { Cell, Level } from '../../src/game/level';

/**
 * A level drawn as text, one character per cell:
 *   #  wall          .  floor        @  floor, where the player starts
 *   D  door          L  door with a level-5 lock     |  door of bars
 *   C  door of bars with a level-5 lock (a cell door)
 *   X  way out       ~  water        O  pit
 */
export function textLevel(rows: string[], extra: Partial<Level> = {}): Level {
  const width = rows[0].length;
  const cells: Cell[] = [];
  const locks = new Map<number, number>();
  let start = { x: 0.5, y: 0.5 };
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const cell: Cell = { kind: 'empty', wallTex: 0, floorTex: 0 };
      if (ch === '#' || ch === 'X') cell.kind = 'wall';
      if (ch === 'X') cell.exit = 'up';
      if (ch === 'D' || ch === 'L' || ch === '|' || ch === 'C') cell.kind = 'door';
      if (ch === 'L' || ch === 'C') locks.set(y * width + x, 5);
      if (ch === '|' || ch === 'C') cell.seeThrough = true;
      if (ch === '~') cell.chasm = 'wet';
      if (ch === 'O') cell.chasm = 'dry';
      if (ch === '@') start = { x: x + 0.5, y: y + 0.5 };
      cells.push(cell);
    }),
  );
  return {
    name: 'Test',
    width,
    depth: rows.length,
    height: 1,
    cells,
    wallTextures: [],
    floorTextures: [],
    chasmTextures: {},
    ceilingTex: 0,
    flats: [],
    items: [],
    creatures: [],
    locks,
    triggers: [],
    start,
    ...extra,
  };
}

/** A made-up creature; none of these numbers come from the game. */
export function fakeCreature(overrides: Partial<CreatureInfo> = {}): CreatureInfo {
  return {
    name: 'Mudcrab',
    level: 1,
    health: [3, 9],
    damage: [2, 4],
    experience: 10,
    experiencePerHealth: 2,
    sound: 'CLACK.VOC',
    animation: 'CRAB',
    lift: 0,
    noCorpse: false,
    flags: 0,
    scale: 0,
    special: 0,
    ...overrides,
  };
}

/** Always returns the same "random" number. */
export const always = (value: number) => () => value;
