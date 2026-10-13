/**
 * Draws the creatures as upright sprites, as Arena does: each frame shows
 * the view of the creature from where the camera stands (front, side, back
 * and between, mirrored for the other side), the step of its walk or swing,
 * and its death and body once killed.
 */
import * as THREE from 'three';
import { creatureFrame, viewAngle, type Creature } from '../game/creatures';
import type { CreatureSprite } from './textures';
import { floorHeight, type Level } from '../game/level';
import { cellIndex } from '../game/grid';
import { liftFor, placeSprite } from './levelScene';

/** Frames before the attack in each view file: six of walking, two of looking about. */
const ATTACK_START = 8;

interface Actor {
  creature: Creature;
  sprite: CreatureSprite;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

export class CreatureView {
  readonly group = new THREE.Group();
  private readonly actors: Actor[] = [];
  private readonly retired=new WeakSet<Creature>();
  private disposed=false;

  private readonly plane = new THREE.PlaneGeometry(1, 1);
  private load: (stem: string) => Promise<CreatureSprite | undefined> = async () => undefined;

  private constructor(private readonly level?: Level) {}

  /** Creatures whose animations are missing are left out. */
  static async create(creatures: Creature[], load: (stem: string) => Promise<CreatureSprite | undefined>, level?: Level): Promise<CreatureView> {
    const view = new CreatureView(level);
    view.load = load;
    for (const creature of creatures) await view.add(creature);
    return view;
  }

  /** Draws a creature from now on, such as one that came upon the player resting. */
  async add(creature: Creature): Promise<void> {
    const sprite = await this.load(creature.info.animation);
    if (!sprite||this.disposed||this.retired.has(creature)) return;
    creature.collisionHeight=sprite.views[0].height*1.2/128;
    const material = new THREE.MeshBasicMaterial({ map: sprite.views[0].frames[0], alphaTest: sprite.spectral ? 1 / 255 : 0.5, transparent: !!sprite.spectral, depthWrite: !sprite.spectral, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.plane, material);
    this.group.add(mesh);
    this.actors.push({ creature, sprite, mesh, material });
  }

  /** Retire one practice corpse without freeing shared animation textures. */
  remove(creature:Creature):void {
    this.retired.add(creature);
    const index=this.actors.findIndex(a=>a.creature===creature);if(index<0)return;
    const [actor]=this.actors.splice(index,1);actor.mesh.removeFromParent();actor.material.dispose();
  }
  /** Remove actors without destroying the cache's shared sprite textures. */
  clear(): void {
    for (const actor of this.actors) { this.group.remove(actor.mesh); actor.material.dispose(); }
    this.actors.length = 0;
  }

  /** Frees every animation frame, including those not on screen. */
  dispose(): void {
    this.disposed=true;
    for (const { sprite, material } of this.actors) {
      for (const file of [...sprite.views, sprite.death]) for (const t of file.frames) t.dispose();
      material.dispose();
    }
  }

  /**
   * Poses every creature for a camera at `eye`; call once per frame before
   * rendering. Creatures nearer the camera than `nearest` aren't drawn: the
   * menu's film can pass where one stands.
   */
  update(eye: THREE.Vector3, nearest = 0): void {
    for (const { creature: c, sprite, mesh, material } of this.actors) {
      mesh.visible = !(c.state === 'dead' && c.info.noCorpse) && Math.hypot(c.x - eye.x, c.y - eye.z) >= nearest;
      if (!mesh.visible) continue;
      const angle = viewAngle(c.x, c.y, c.facing, eye.x, eye.z);
      const view = sprite.views[angle.file];
      const pose = creatureFrame(c, view.frames.length - ATTACK_START);
      const file = pose.death ? sprite.death : view;
      const map = file.frames[Math.min(pose.frame, file.frames.length - 1)];
      if (material.map !== map) material.map = map;
      // Up on a platform it has stepped onto.
      const floor = this.level ? Math.max(0, floorHeight(this.level.cells[cellIndex(this.level, c.x, c.y)], this.level)) : 0;
      placeSprite(mesh, c.x, c.y, file.width, file.height, floor + liftFor(-c.info.lift), angle.mirror && !pose.death);
      mesh.rotation.y = Math.atan2(eye.x - c.x, eye.z - c.y);
    }
  }
}
