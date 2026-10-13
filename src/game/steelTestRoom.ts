import type { Level } from './level';
import { isAlive, spawnCreature, type Creature } from './creatures';
import type { CreatureInfo } from '../formats/exe';
/** A review room with the same voxel geometry, collision and art as the game. */
export function steelTestRoom(): Level {
  const width = 14, depth = 14;
  const level: Level = {
    name: 'Imperial Armoury — Steel proving ground', width, depth, height: 1.5,
    cells: [], wallTextures: [
      { file: 'WALLA.SET', frame: 0 }, { file: 'DOOR_2.IMG', frame: 0 },
      { file: 'DOOR_6.IMG', frame: 0 }, { file: 'WALLB.SET', frame: 2 },
    ], floorTextures: [{ file: 'FLOORA.SET', frame: 0 }, { file: 'IFLOOR4.IMG', frame: 0 }, { file: 'T_NGRASS.IMG', frame: 0 }],
    chasmTextures: {}, ceilingTex: 0, flats: [], items: [], creatures: [], locks: new Map(), triggers: [],
    start: { x: 6.5, y: 9.5 },
  };
  for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    level.cells.push({ kind: x === 0 || y === 0 || x === width - 1 || y === depth - 1 ? 'wall' : 'empty', wallTex: 0, floorTex: 0 });
  }
  // Three separate impact lanes. The side doors are usable with E / A.
  level.cells[5 * width + 6] = { kind: 'wall', wallTex: 0, floorTex: 0 };
  for (const [x, texture] of [[3, 1], [9, 2]]) {
    for (const y of [4, 6]) level.cells[y * width + x] = { kind: 'wall', wallTex: 3, floorTex: 0 };
    level.cells[5 * width + x] = { kind: 'door', door: 'swinging', wallTex: texture, floorTex: 0 };
  }
  for (const [x, y] of [[2, 2], [11, 2], [2, 11], [11, 11]]) level.cells[y * width + x] = { kind: 'wall', wallTex: 3, floorTex: 0 };
  level.flats.push({ x: 1.5, y: 3.5, name: 'BARREL.IMG', solid: true }, { x: 12.5, y: 3.5, name: 'BARREL.IMG', solid: true });
  return level;
}
/** Find a walkable, unoccupied spot near the aim line; never put an enemy inside a wall or player. */
export function rangeSpawn(level: Level, player: { x: number; y: number; yaw: number }, creatures: Creature[], info: CreatureInfo): Creature | undefined {
  if (creatures.filter(isAlive).length >= 16) return undefined;
  for (const distance of [3, 4, 2, 5]) for (const angle of [0, .45, -.45, .9, -.9]) {
    const x = player.x + Math.cos(player.yaw + angle) * distance,
      y = player.y + Math.sin(player.yaw + angle) * distance,
      cell = level.cells[Math.floor(y) * level.width + Math.floor(x)];
    if (x < 1 || y < 1 || x > level.width - 1 || y > level.depth - 1 || cell?.kind !== 'empty') continue;
    if (creatures.some(c => Math.hypot(c.x - x, c.y - y) < .8)) continue;
    const id = creatures.reduce((max, c) => Math.max(max, c.id), -1) + 1;
    const c = spawnCreature(id, info, x, y, Math.random);
    c.facing = Math.atan2(player.y - y, player.x - x);
    c.awareness = 1;
    return c;
  }
  return undefined;
}
