/** Original arrows retain their sprites; Steel arrows use the recoverable ballistic model. */
import * as THREE from 'three';
import { ARENA_TICK } from '../game/combat';
import type { Arrow } from '../game/dungeon';
import { METRES_TO_WORLD } from '../game/projectilePhysics';
import { PIXEL_HEIGHT, PIXEL_WIDTH } from './levelScene';
import { steelWeapons } from './steelWeaponAssets';
const UP = new THREE.Vector3(0, 1, 0);

export class ArrowView {
  readonly group = new THREE.Group();
  private frames: THREE.Texture[] = [];
  private readonly objects = new Map<number, THREE.Object3D>();
  private template: THREE.Group | undefined;
  private tipY = .39;
  private owned: THREE.Material[] = [];
  private time = 0;
  private disposed = false;
  constructor(frames: Promise<THREE.Texture[]>) {
    void frames.then((f) => {
      this.frames = f;
    });
    void steelWeapons
      .arrow()
      .then((model) => {
        if (this.disposed) return;
        // The original world has no lights. Keep the authored atlas visible there.
        model.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const convert = (m: THREE.Material) => {
              const source = m as THREE.MeshStandardMaterial;
              const basic = new THREE.MeshBasicMaterial({
                map: source.map,
                color: source.color,
                side: source.side,
                transparent: source.transparent,
                opacity: source.opacity,
                alphaTest: source.alphaTest,
              });
              this.owned.push(basic);
              return basic;
            };
            o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
          }
        });
        this.tipY = new THREE.Box3().setFromObject(model).max.y;
        this.template = model;
      })
      .catch((error) => console.warn('Could not load Steel arrow model:', error));
  }
  update(arrows: readonly Arrow[], height: number, dt: number): void {
    this.time += dt;
    const live = new Set<number>(),
      frame = this.frames[Math.floor(this.time / ARENA_TICK) % Math.max(1, this.frames.length)];
    for (const a of arrows) {
      if (a.projectile?.phase === 'recovered') continue;
      let object = this.objects.get(a.id);
      if (a.projectile) {
        if (!this.template) continue;
        if (!object) {
          object = this.template.clone(true);
          object.scale.setScalar(METRES_TO_WORLD);
          this.objects.set(a.id, object);
          this.group.add(object);
        }
        const p = a.projectile,
          direction = new THREE.Vector3(...p.direction).normalize();
        object.quaternion.setFromUnitVectors(UP, direction);
        if (p.spin) object.rotateZ(p.spin);
        // Measure the resized model: physics follows its point, not its centre.
        const tip = new THREE.Vector3(0, this.tipY * METRES_TO_WORLD, 0).applyQuaternion(object.quaternion);
        object.position.set(...p.position).sub(tip);
      } else {
        if (!frame) continue;
        if (!object) {
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: frame, alphaTest: 0.5 }));
        const image = frame.image as { width: number; height: number };
        sprite.scale.set(image.width * PIXEL_WIDTH, image.height * PIXEL_HEIGHT, 1);
          object = sprite;
          this.objects.set(a.id, object);
        this.group.add(object);
        }
        (object as THREE.Sprite).material.map = frame;
        object.position.set(a.x, height, a.y);
    }
      live.add(a.id);
    }
    for (const [id, object] of this.objects) {
      if (live.has(id)) continue;
      this.group.remove(object);
      if (object instanceof THREE.Sprite) object.material.dispose();
      this.objects.delete(id);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const o of this.objects.values()) if (o instanceof THREE.Sprite) o.material.dispose();
    for (const m of this.owned) m.dispose();
    this.objects.clear();
    this.group.clear();
  }
}
