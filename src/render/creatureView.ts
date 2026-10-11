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

  private constructor(private readonly level?: Level) {}

  /** Creatures whose animations are missing are left out. */
  static async create(creatures: Creature[], load: (stem: string) => Promise<CreatureSprite | undefined>, level?: Level): Promise<CreatureView> {
    const view = new CreatureView(level);
    const plane = new THREE.PlaneGeometry(1, 1);
    for (const creature of creatures) {
      const sprite = await load(creature.info.animation);
      if (!sprite) continue;
      const material = new THREE.MeshBasicMaterial({ map: sprite.views[0].frames[0], alphaTest: 0.5, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(plane, material);
      view.group.add(mesh);
      view.actors.push({ creature, sprite, mesh, material });
    }
    return view;
  }

  /** Frees every animation frame, including those not on screen. */
  dispose(): void {
    for (const { sprite, material } of this.actors) {
      for (const file of [...sprite.views, sprite.death]) for (const t of file.frames) t.dispose();
      material.dispose();
    }
  }

  /** Poses every creature for a camera at `eye`; call once per frame before rendering. */
  update(eye: THREE.Vector3): void {
    for (const { creature: c, sprite, mesh, material } of this.actors) {
      if (c.state === 'dead' && c.info.noCorpse) {
        mesh.visible = false;
        continue;
      }
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
