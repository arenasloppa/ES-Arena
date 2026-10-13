import { describe, it, expect } from 'vitest';
import { steelWeaponDefinition, STEEL_WEAPON_DEFINITIONS } from '../src/render/steelWeaponDefinitions';
import { impactResponse } from '../src/render/weaponAnimation';
import { ChainPhysics } from '../src/game/chainPhysics';
import { projectile, stepProjectile, ARROW_GRAVITY, segmentBox, type SurfaceMaterial } from '../src/game/projectilePhysics';
import { sweepTerrain, textureMaterial, terrainSphere } from '../src/game/surfacePhysics';
import { Dungeon, IDLE_INPUT, type Swing } from '../src/game/dungeon';
import { Inventory, makeSteelArrows, itemKey } from '../src/game/items';
import { textLevel } from './helpers/level';
import {bowDrawDuration,bowReleaseTiming} from '../src/render/weaponMotion';

const click = {
  ...IDLE_INPUT,
  attack: { held: false, pressed: true, released: true },
};
function advance(d: Dungeon, seconds: number, input = IDLE_INPUT) {
  for (let t = 0; t < seconds - 1e-8; t += 1 / 120) d.update(Math.min(1 / 120, seconds - t), input);
}
const steelBow = () => {
  const d = new Dungeon(textLevel(['########', '#@.....#', '#......#', '########']), undefined);
  const bow = d.inventory.add({
    kind: 'weapon',
    name: 'Steel Short Bow',
    type: 16,
    material: 1,
    damage: [2, 4],
    twoHanded: true,
    weight: 1,
    value: 10,
  });
  d.use(itemKey(bow));
  d.player.yaw = 0;
  return d;
};

describe('Steel weapon integration', () => {
  it('selects every exact Steel family and keeps other materials on their original view', () => {
    expect(STEEL_WEAPON_DEFINITIONS).toHaveLength(19);
    for (let type = 0; type < 18; type++) {
      expect(steelWeaponDefinition({ type, material: 1 })?.type).toBe(type);
      for (const material of [undefined, 0, 2, 3, 4, 5, 6, 7]) expect(steelWeaponDefinition({ type, material })).toBeUndefined();
    }
    expect(steelWeaponDefinition({ type: 14, material: 1 })?.key).toBe('war-axe');
    expect(steelWeaponDefinition({ type: 15, material: 1 })?.key).toBe('battle-axe');
    expect(steelWeaponDefinition({ type: 18, material: 1 })).toBeUndefined();
  });
  it('bites wood with an edge, recoils blunt metal and brushes soft ground', () => {
    expect(impactResponse('wood', 'sword')).toBe('bite');
    expect(impactResponse('wood', 'heavy', false, true)).toBe('bite');
    expect(impactResponse('wood', 'heavy')).toBe('recoil');
    expect(impactResponse('wood', 'sword', true)).toBe('recoil');
    for (const material of ['metal', 'stone'] as const) expect(impactResponse(material, 'sword')).toBe('recoil');
    expect(impactResponse('soft', 'sword')).toBe('brush');
  });
  it('chains retain a moving anchor impulse without stretching or NaNs', () => {
    const lengths = [0.0427, 0.0628, 0.0628, 0.0628, 0.0628, 0.0628, 0.0427, 0.106],
      chain = new ChainPhysics(lengths);
    chain.reset([0, 0, 0]);
    for (let i = 0; i < 240; i++) chain.update(1 / 120, [Math.sin(i / 25) * 0.12, 0, 0]);
    expect(chain.points.flat().every(Number.isFinite)).toBe(true);
    expect(chain.points[0][0]).toBeCloseTo(Math.sin(239 / 25) * 0.12, 8);
    for (let i = 1; i < chain.points.length; i++)
      expect(Math.abs(Math.hypot(...chain.points[i].map((v, k) => v - chain.points[i - 1][k])) - lengths[i - 1])).toBeLessThan(0.006);
    expect(Math.abs(chain.points.at(-1)![0] - chain.points[0][0])).toBeGreaterThan(0.01);
  });
  it('chain fixed steps agree across render rates', () => {
    const chains = [new ChainPhysics([0.1, 0.1, 0.1]), new ChainPhysics([0.1, 0.1, 0.1])];
    chains.forEach((c) => c.reset([0, 0, 0], [1, 0, 0]));
    for (let i = 0; i < 120; i++) chains[0].update(1 / 120, [0, 0, 0]);
    for (let i = 0; i < 30; i++) chains[1].update(1 / 30, [0, 0, 0]);
    expect(chains[0].points).toEqual(chains[1].points);
  });
  it('uses ballistic gravity and agrees across frame rates', () => {
    const a = projectile([0, 2, 0], [8, 0, 0]),
      b = projectile([0, 2, 0], [8, 0, 0]);
    for (let i = 0; i < 120; i++) stepProjectile(a, 1 / 120, () => undefined);
    for (let i = 0; i < 30; i++) stepProjectile(b, 1 / 30, () => undefined);
    expect(a.position[0]).toBeCloseTo(8, 8);
    expect(a.position[1]).toBeCloseTo(2 - ARROW_GRAVITY / 2, 8);
    expect(a.position).toEqual(b.position);
  });
  for (const material of ['metal', 'stone', 'wood', 'soft'] as SurfaceMaterial[])
    it(`sweeps fast arrows into ${material} instead of tunnelling`, () => {
      const p = projectile([0, 0.5, 0], [120, 0, 0]);
      stepProjectile(p, 1 / 60, (from, to) => {
        const b = segmentBox(from, to, [0.6, 0, -1], [0.61, 1, 1]);
        return b
          ? {
              ...b,
              point: from.map((v, k) => v + (to[k] - v) * b.fraction) as [number, number, number],
              material,
            }
          : undefined;
      });
      if (material === 'wood' || material === 'soft') {
        expect(p.phase).toBe('embedded');
        expect(p.velocity).toEqual([0, 0, 0]);
      } else {
        expect(p.phase).toBe('flying');
        expect(p.velocity[0]).toBeLessThan(0);
        expect(Math.hypot(...p.velocity)).toBeLessThan(120);
        expect(p.bounces).toBe(1);
      }
    });
  it('hard-wall arrows fall and come to rest on the floor', () => {
    const level = textLevel(['#####', '#@..#', '#...#', '#####']);
    const p = projectile([2, 0.5, 1.5], [10, 0, 0]);
    for (let i = 0; i < 1200; i++) stepProjectile(p, 1 / 120, (a, b) => sweepTerrain(level, new Set(), a, b));
    expect(p.phase).toBe('resting');
    expect(p.position[1]).toBeLessThan(0.02);
    expect(p.bounces).toBeGreaterThan(1);
  });
  it('classifies Arena metal doors, wooden doors, grass and explicit overrides', () => {
    expect(textureMaterial('DOOR6.IMG', 'door')).toBe('metal');
    expect(textureMaterial('MDOOR5.IMG', 'door')).toBe('metal');
    expect(textureMaterial('DOOR2.IMG', 'door')).toBe('wood');
    expect(textureMaterial('T_NGRASS.IMG', 'floor')).toBe('soft');
    expect(textureMaterial('IFLOOR4.IMG', 'floor')).toBe('wood');
    expect(textureMaterial('CUSTOM.IMG', 'door', { 'CUSTOM.IMG': 'metal' })).toBe('metal');
  });
  it('resolves a flail particle which gets inside a wall', () => {
    const l = textLevel(['###', '#@#', '###']);
    const hit = terrainSphere(l, new Set(), [2.05, 0.5, 1.5], 0.04);
    expect(hit?.point[0]).toBeLessThan(2);
  });
  it('collides a flail head against raised shelves and diagonal walls', () => {
    const level = textLevel(['#####', '#@..#', '#...#', '#####']);
    level.cells[7] = { kind: 'raised', wallTex: 0, floorTex: 0, raisedBottom: 0.3, raisedTop: 0.7 };
    const shelf = terrainSphere(level, new Set(), [2.1, 0.5, 1.5], 0.04);
    expect(shelf?.point[0]).toBeLessThan(2);
    level.cells[7] = { kind: 'diagonal', wallTex: 0, floorTex: 0, diagonalFlip: false };
    const diagonal = terrainSphere(level, new Set(), [2.5, 0.5, 1.5], 0.04);
    expect(diagonal).toBeDefined();
    expect(Math.abs(diagonal!.point[0] - diagonal!.point[2] - 1)).toBeGreaterThan(0.04);
  });
  it('holds a fully drawn bow until release, spends one arrow, and rejects an empty quiver', () => {
    const d = steelBow();
    d.inventory.add(makeSteelArrows(2));
    const press = { ...IDLE_INPUT, attack: { held: true, pressed: true, released: false } },
      hold = { ...press, attack: { held: true, pressed: false, released: false } },
      release = { ...IDLE_INPUT, attack: { held: false, pressed: false, released: true } };
    d.update(0.01, press);
    advance(d, 1.5, hold);
    expect(d.arrows).toHaveLength(0);
    expect(d.inventory.steelArrowCount()).toBe(2);
    expect(d.swing?.struck).toBe(false);
    d.update(0.01, release);
    expect(d.arrows).toHaveLength(0);
    advance(d, d.swing!.duration * d.swing!.hitAt! + .001);
    expect(d.arrows).toHaveLength(1);
    expect(d.inventory.steelArrowCount()).toBe(1);
    advance(d, 2);
    d.update(0.01, click);
    advance(d, bowDrawDuration(16) + bowReleaseTiming(16,0).duration + .001);
    expect(d.inventory.steelArrowCount()).toBe(0);
    advance(d, 2);
    const count = d.arrows.length;
    d.update(0.01, click);
    expect(d.arrows.length).toBe(count);
  });
  it('cancels a draw without spending arrows and permits a bow bash', () => {
    const d = steelBow();
    d.inventory.add(makeSteelArrows(2));
    d.update(0.01, { ...IDLE_INPUT, attack: { held: true, pressed: true, released: false } });
    d.update(0.1, { ...IDLE_INPUT, block: true });
    expect(d.swing).toBeUndefined();
    expect(d.blocking).toBe(true);
    expect(d.inventory.steelArrowCount()).toBe(2);
    d.update(0.01, { ...click, block: true });
    expect(d.swing?.bash).toBe(true);
    expect(d.inventory.steelArrowCount()).toBe(2);
  });
  it('heavy Steel weapons swing slower than daggers while legacy timing stays unchanged', async () => {
    const { steelAttackDuration } = await import('../src/game/weaponHandling');
    const w = { name: 'test', damage: [1, 3] as [number, number], cif: 'SWORD.CIF', material: 1 };
    expect(steelAttackDuration({ ...w, type: 13 }, false)).toBeGreaterThan(steelAttackDuration({ ...w, type: 1 }, false));
    expect(steelAttackDuration({ ...w, material: 0, type: 13 }, false)).toBe(0.4);
  });
  it('an intercepted blade cannot also deal damage on its scheduled frame', () => {
    const d = steelBow();
    d.stats.weapon = { name: 'Steel Tanto', type: 7, material: 1, cif: 'SWORD.CIF', damage: [1, 3] };
    const swing: Swing = { kind: 'right', power: false, time: 0.1, duration: 0.34, struck: false };
    d.swing = swing;
    d.meleeTerrainContact({ fraction: 0.5, point: [2, 0.5, 1.5], normal: [-1, 0, 0], material: 'stone' }, swing);
    expect(swing.struck).toBe(true);
    expect(d.events.filter((e) => e.type === 'weaponImpact')).toHaveLength(1);
    d.meleeTerrainContact({ fraction: 0.5, point: [2, 0.5, 1.5], normal: [-1, 0, 0], material: 'stone' }, swing);
    expect(d.events.filter((e) => e.type === 'weaponImpact')).toHaveLength(1);
  });
  it('recovers an embedded arrow once and stacks ammunition', () => {
    const d = steelBow(),
      p = projectile([2.1, 0.5, 1.5], [1, 0, 0]);
    p.phase = 'embedded';
    d.arrows.push({
      id: 42,
      x: 2.1,
      y: 1.5,
      dx: 1,
      dy: 0,
      travelled: 1,
      weapon: d.stats.weapon,
      sneak: false,
      projectile: p,
    });
    expect(d.target()?.kind).toBe('arrow');
    d.activate();
    expect(d.inventory.steelArrowCount()).toBe(1);
    d.activate();
    expect(d.inventory.steelArrowCount()).toBe(1);
    expect(d.arrows).toHaveLength(0);
    const inv = new Inventory();
    inv.add(makeSteelArrows(5));
    inv.add(makeSteelArrows(3));
    expect(inv.items).toHaveLength(1);
    for (let i = 0; i < 8; i++) expect(inv.takeSteelArrow()).toBe(true);
    expect(inv.takeSteelArrow()).toBe(false);
  });
  it('bash against a metal door emits the same impact response as a swing', () => {
    const d = new Dungeon(
      textLevel(['####', '#@D#', '####'], {
        wallTextures: [{ file: 'DOOR6.IMG', frame: 0 }],
      }),
      undefined,
    );
    d.stats.weapon = {
      name: 'Steel Dagger',
      type: 1,
      material: 1,
      cif: 'DAGGER.CIF',
      damage: [2, 4],
    };
    d.player.yaw = 0;
    d.swing = {
      kind: 'thrust',
      bash: true,
      power: false,
      time: 0.149,
      duration: 0.3,
      struck: false,
    };
    d.update(0.01, IDLE_INPUT);
    expect(d.events).toContainEqual({
      type: 'weaponImpact',
      material: 'metal',
      bash: true,
    });
  });
});
