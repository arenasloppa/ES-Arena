/**
 * Arrows in flight, drawn with Arena's own picture for them: ARROW02.CFA, a
 * little arrow turning over as it flies (the last of its program's effect
 * animations, the one its arrows use), as big as Arena's sprites are.
 */
import * as THREE from 'three';
import { ARENA_TICK } from '../game/combat';
import type { Arrow } from '../game/dungeon';
import { PIXEL_HEIGHT, PIXEL_WIDTH } from './levelScene';

export class ArrowView {
  readonly group = new THREE.Group();
  private frames: THREE.Texture[] = [];
  private readonly sprites = new Map<number, THREE.Sprite>();
  private time = 0;

  /** `frames` are ARROW02.CFA's; with none, arrows fly unseen. */
  constructor(frames: Promise<THREE.Texture[]>) {
    void frames.then((f) => (this.frames = f));
  }

  /** Draws the arrows in flight at `height`, turning over a frame each of Arena's ticks; call once per frame. */
  update(arrows: readonly Arrow[], height: number, dt: number): void {
    this.time += dt;
    const live = new Set<number>();
    const frame = this.frames[Math.floor(this.time / ARENA_TICK) % Math.max(1, this.frames.length)];
    for (const a of frame ? arrows : []) {
      live.add(a.id);
      let sprite = this.sprites.get(a.id);
      if (!sprite) {
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: frame, alphaTest: 0.5 }));
        const image = frame.image as { width: number; height: number };
        sprite.scale.set(image.width * PIXEL_WIDTH, image.height * PIXEL_HEIGHT, 1);
        this.sprites.set(a.id, sprite);
        this.group.add(sprite);
      }
      sprite.material.map = frame;
      sprite.position.set(a.x, height, a.y);
    }
    for (const [id, sprite] of this.sprites) {
      if (live.has(id)) continue;
      this.group.remove(sprite);
      sprite.material.dispose();
      this.sprites.delete(id);
    }
  }

  dispose(): void {
    for (const s of this.sprites.values()) s.material.dispose();
    this.sprites.clear();
  }
}
