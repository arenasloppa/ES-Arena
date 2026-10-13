/** One surface classification is shared by projectiles, melee reactions and chain contacts. */
import { floorHeight, isWaterTunnel, type Cell, type Level, type LevelFlat } from './level';
import { segmentBox, type ProjectileHit, type SurfaceMaterial } from './projectilePhysics';
import type { Vec3, ChainContact } from './chainPhysics';
import type { Creature } from './creatures';

export type MaterialOverrides = Readonly<Record<string, SurfaceMaterial>>;
/** Explicit texture overrides win; names describe known materials, unknown dungeon masonry is stone. */
export function textureMaterial(file: string, role: 'wall' | 'door' | 'floor', overrides: MaterialOverrides = {}): SurfaceMaterial {
  const key = file.toUpperCase();
  const custom = overrides[key] ?? overrides[file];
  if (custom) return custom;
  // Arena's numbered doors hide their material in the filename. Verified against their atlas art.
  if (/^(CELDOOR2|CELLDOOR|DOOR[456](D2)?|DOOR_[456]|MDOOR[456]|WDUNGDR2)\.IMG$/.test(key)) return 'metal';
  if (/^IDOOR[1-6]\.IMG$/.test(key)) return 'stone';
  if (/^IFLOOR4\.IMG$/.test(key)) return 'wood';
  if (/METAL|IRON|STEEL|GRATE|BARS|CHAIN|COPPER|BRONZE/.test(key)) return 'metal';
  if (/WOOD|TIMBER|PLANK|BARK|TREE|OAK|PINE|LOG|BARN|BARREL|CASK/.test(key)) return 'wood';
  if (/GRASS|TURF|EARTH|DIRT|SOIL|SAND|MUD|SNOW/.test(key)) return 'soft';
  return role === 'door' ? 'wood' : 'stone';
}
export function cellMaterial(level: Level, cell: Cell, kind: 'wall' | 'floor', overrides: MaterialOverrides = {}): SurfaceMaterial {
  if (kind === 'wall' && ((cell.seeThrough && cell.kind === 'door') || (cell.kind === 'transparent' && !cell.passable))) return 'metal';
  const texture = (kind === 'floor' ? level.floorTextures : level.wallTextures)[kind === 'floor' ? cell.floorTex : cell.wallTex];
  return textureMaterial(texture?.file ?? '', cell.kind === 'door' && kind === 'wall' ? 'door' : kind, overrides);
}
/** Wooden barrels are physical props even when their INF omits the solid flag. */
export function woodPropBounds(flat:LevelFlat):{min:Vec3;max:Vec3}|undefined {
  if(!/BARREL|CASK/i.test(flat.name))return;
  const width=flat.collisionWidth??.45*(flat.scale??1),height=flat.collisionHeight??.60*(flat.scale??1);
  const bottom=(flat.base??0)-(flat.yOffset??0)*1.2/128;
  return{min:[flat.x-width/2,bottom,flat.y-width/2],max:[flat.x+width/2,bottom+height,flat.y+width/2]};
}
export function sweepWoodProps(level:Level,from:Vec3,to:Vec3):ProjectileHit|undefined {
 let best:ProjectileHit|undefined;
 for(const flat of level.flats){
  const box=woodPropBounds(flat);if(!box)continue;
  const b=segmentBox(from,to,box.min,box.max);if(!b||(best&&b.fraction>=best.fraction))continue;
  best={...b,material:'wood',point:from.map((v,k)=>v+(to[k]-v)*b.fraction) as Vec3};
 }
 return best;
}
export function sweepTerrain(
  level: Level,
  openDoors: ReadonlySet<number>,
  from: Vec3,
  to: Vec3,
  overrides: MaterialOverrides = {},
): ProjectileHit | undefined {
  let best: ProjectileHit | undefined;
  const hit = (fraction: number, normal: Vec3, material: SurfaceMaterial) => {
    if (fraction < 0 || fraction > 1 || (best && fraction >= best.fraction)) return;
    best = {
      fraction,
      normal,
      material,
      point: from.map((v, k) => v + (to[k] - v) * fraction) as Vec3,
    };
  };
  const x0 = Math.max(0, Math.floor(Math.min(from[0], to[0])) - 1),
    x1 = Math.min(level.width - 1, Math.floor(Math.max(from[0], to[0])) + 1),
    z0 = Math.max(0, Math.floor(Math.min(from[2], to[2])) - 1),
    z1 = Math.min(level.depth - 1, Math.floor(Math.max(from[2], to[2])) + 1);
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const index = z * level.width + x,
        cell = level.cells[index],
        solid = cell.kind === 'wall' || (cell.kind === 'door' && !openDoors.has(index)) || (cell.kind === 'transparent' && !cell.passable);
      const acceptBox = (min: Vec3, max: Vec3, material: SurfaceMaterial) => {
        const b = segmentBox(from, to, min, max);
        if (b) hit(b.fraction, b.normal, material);
      };
      if (solid) acceptBox([x, isWaterTunnel(cell) ? 0 : -level.height, z], [x + 1, level.height, z + 1], cellMaterial(level, cell, 'wall', overrides));
      if (cell.kind === 'raised') {
        const b = segmentBox(from, to, [x, cell.raisedBottom ?? 0, z], [x + 1, cell.raisedTop ?? 0, z + 1]);
        if (b) {
          const cap = b.normal[1] > 0,
            tex = cap ? (cell.capIsWall ? level.wallTextures : level.floorTextures)[cell.capTex ?? 0] : level.wallTextures[cell.wallTex];
          hit(b.fraction, b.normal, textureMaterial(tex?.file ?? '', cap ? 'floor' : 'wall', overrides));
        }
      }
      if (cell.kind === 'diagonal') {
        const normal: Vec3 = cell.diagonalFlip ? [Math.SQRT1_2, 0, Math.SQRT1_2] : [Math.SQRT1_2, 0, -Math.SQRT1_2],
          point: Vec3 = [x + 0.5, 0, z + 0.5],
          den = to.reduce((s, v, k) => s + (v - from[k]) * normal[k], 0);
        if (Math.abs(den) > 1e-10) {
          const fraction = point.reduce((s, v, k) => s + (v - from[k]) * normal[k], 0) / den,
            p = from.map((v, k) => v + (to[k] - v) * fraction);
          if (p[0] >= x && p[0] <= x + 1 && p[2] >= z && p[2] <= z + 1 && p[1] >= 0 && p[1] <= level.height)
            hit(fraction, den > 0 ? (normal.map((v) => -v) as Vec3) : normal, cellMaterial(level, cell, 'wall', overrides));
        }
      }
      if (cell.kind === 'edge' && cell.edge?.solid) {
        const e = cell.edge,
          eps = 0.008;
        const min: Vec3 = [x, e.lift, z],
          max: Vec3 = [x + 1, level.height, z + 1];
        if (e.side === 'north') max[2] = z + eps;
        if (e.side === 'south') min[2] = z + 1 - eps;
        if (e.side === 'west') max[0] = x + eps;
        if (e.side === 'east') min[0] = x + 1 - eps;
        acceptBox(min, max, cellMaterial(level, cell, 'wall', overrides));
      }
      const floor = floorHeight(cell, level),
        dy = to[1] - from[1];
      if (dy < 0) {
        const fraction = (floor - from[1]) / dy,
          p = from.map((v, k) => v + (to[k] - v) * fraction);
        if (p[0] >= x && p[0] <= x + 1 && p[2] >= z && p[2] <= z + 1)
          hit(fraction, [0, 1, 0], cellMaterial(level, cell, 'floor', overrides));
      }
    }
  const prop=sweepWoodProps(level,from,to);if(prop)hit(prop.fraction,prop.normal,prop.material);
  if (to[1] > level.height && from[1] <= level.height)
    hit(
      (level.height - from[1]) / (to[1] - from[1]),
      [0, -1, 0],
      textureMaterial(level.floorTextures[level.ceilingTex]?.file ?? '', 'wall', overrides),
    );
  return best;
}
export function sweepCreatures(level: Level, creatures: readonly Creature[], from: Vec3, to: Vec3): ProjectileHit | undefined {
  let best: ProjectileHit | undefined;
  for (const c of creatures) {
    if (c.health <= 0) continue;
    const cell = level.cells[Math.floor(c.y) * level.width + Math.floor(c.x)],
      bottom = floorHeight(cell, level) + (c.info.lift * 1.2) / 128,
      height = c.collisionHeight ?? 0.6;
    const b = segmentBox(from, to, [c.x - 0.16, bottom, c.y - 0.16], [c.x + 0.16, bottom + height, c.y + 0.16]);
    if (!b || (best && b.fraction >= best.fraction)) continue;
    best = {
      fraction: b.fraction,
      point: from.map((v, k) => v + (to[k] - v) * b.fraction) as Vec3,
      normal: b.normal,
      material: 'soft',
      creature: c.id,
    };
  }
  return best;
}
/** Resolve the head/link radius against the same walls, platforms and fences arrows hit. */
export function terrainSphere(level: Level, openDoors: ReadonlySet<number>, point: Vec3, radius: number): ChainContact | undefined {
  const p: Vec3 = [...point];
  let normal: Vec3 = [0, 0, 0],
    changed = false;
  const cx = Math.floor(p[0]),
    cz = Math.floor(p[2]),
    current = level.cells[cz * level.width + cx],
    floor = floorHeight(current, level);
  if (p[1] - radius < floor) {
    p[1] = floor + radius;
    normal = [0, 1, 0];
    changed = true;
  }
  if (p[1] + radius > level.height) {
    p[1] = level.height - radius;
    normal = [0, -1, 0];
    changed = true;
  }
  const box = (min: Vec3, max: Vec3) => {
    const closest = p.map((v, k) => Math.max(min[k], Math.min(max[k], v))) as Vec3,
      away = p.map((v, k) => v - closest[k]),
      distance = Math.hypot(...away);
    if (distance >= radius) return;
    if (distance > 1e-8) {
      normal = away.map((v) => v / distance) as Vec3;
      for (let k = 0; k < 3; k++) p[k] = closest[k] + normal[k] * radius;
    } else {
      const faces = Array.from({ length: 3 }, (_, k) => [
          { distance: p[k] - min[k], axis: k, sign: -1 },
          { distance: max[k] - p[k], axis: k, sign: 1 },
        ])
          .flat()
          .sort((a, b) => a.distance - b.distance),
        face = faces[0];
      normal = [0, 0, 0];
      normal[face.axis] = face.sign;
      p[face.axis] += face.sign * (face.distance + radius);
    }
    changed = true;
  };
  for (let z = cz - 1; z <= cz + 1; z++)
    for (let x = cx - 1; x <= cx + 1; x++) {
      const index = z * level.width + x,
        c = level.cells[index];
      if (x < 0 || z < 0 || x >= level.width || z >= level.depth || !c) continue;
      if (c.kind === 'wall' || (c.kind === 'door' && !openDoors.has(index)) || (c.kind === 'transparent' && !c.passable))
        box([x, isWaterTunnel(c) ? 0 : -level.height, z], [x + 1, level.height, z + 1]);
      if (c.kind === 'raised') box([x, c.raisedBottom ?? 0, z], [x + 1, c.raisedTop ?? 0, z + 1]);
      if (c.kind === 'edge' && c.edge?.solid) {
        const e = c.edge,
          min: Vec3 = [x, e.lift, z],
          max: Vec3 = [x + 1, level.height, z + 1],
          eps = 0.008;
        if (e.side === 'north') max[2] = z + eps;
        if (e.side === 'south') min[2] = z + 1 - eps;
        if (e.side === 'west') max[0] = x + eps;
        if (e.side === 'east') min[0] = x + 1 - eps;
        box(min, max);
      }
      if (c.kind === 'diagonal') {
        const az = c.diagonalFlip ? z + 1 : z,
          dz = c.diagonalFlip ? -1 : 1,
          t = Math.max(0, Math.min(1, (p[0] - x + (p[2] - az) * dz) / 2)),
          closest: Vec3 = [x + t, Math.max(0, Math.min(level.height, p[1])), az + dz * t],
          away = p.map((v, k) => v - closest[k]),
          distance = Math.hypot(...away);
        if (distance < radius) {
          normal = distance > 1e-8 ? (away.map((v) => v / distance) as Vec3) : [Math.SQRT1_2, 0, -dz * Math.SQRT1_2];
          for (let k = 0; k < 3; k++) p[k] = closest[k] + normal[k] * radius;
          changed = true;
        }
      }
    }
  for(const flat of level.flats){const bounds=woodPropBounds(flat);if(bounds)box(bounds.min,bounds.max);}
  return changed ? { point: p, normal } : undefined;
}
