/**
 * Draws spells in flight and where they burst: a glowing ball coloured by
 * the spell's element, and a flash that swells and fades, as wide as the
 * area the spell catches. The remake draws these itself; Arena's own spell
 * animations aren't read yet.
 */
import * as THREE from 'three';
import type { SpellRecord } from '../formats/spells';
import { AREA_RADIUS, BOLT_RADIUS, type Bolt } from '../game/dungeon';

/** Fire, cold, poison, shock, magic; then spells of no element (healing and the like). */
export const ELEMENT_COLOURS = ['#ff7a2a', '#8fd8ff', '#86d65a', '#c4b8ff', '#d68cff', '#ffd98a'];

export function spellColour(spell: SpellRecord): string {
  return ELEMENT_COLOURS[Math.min(spell.element, ELEMENT_COLOURS.length - 1)];
}

const BURST_TIME = 0.45;

interface Flash {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  age: number;
  size: number;
}

export class SpellView {
  readonly group = new THREE.Group();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly boltSprites = new Map<number, THREE.Sprite>();
  private readonly flashes: Flash[] = [];

  /** Draws the bolts in flight at `height` and moves the bursts on; call once per frame. */
  update(bolts: readonly Bolt[], height: number, dt: number): void {
    const live = new Set<number>();
    for (const b of bolts) {
      live.add(b.id);
      let sprite = this.boltSprites.get(b.id);
      if (!sprite) {
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow(spellColour(b.spell)), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        sprite.scale.setScalar(BOLT_RADIUS * 4);
        this.boltSprites.set(b.id, sprite);
        this.group.add(sprite);
      }
      sprite.position.set(b.x, b.z??height, b.y);
    }
    for (const [id, sprite] of this.boltSprites) {
      if (live.has(id)) continue;
      this.group.remove(sprite);
      sprite.material.dispose();
      this.boltSprites.delete(id);
    }
    for (const f of [...this.flashes]) {
      f.age += dt;
      const t = f.age / BURST_TIME;
      if (t >= 1) {
        this.group.remove(f.sprite);
        f.material.dispose();
        this.flashes.splice(this.flashes.indexOf(f), 1);
        continue;
      }
      f.sprite.scale.setScalar(f.size * (0.4 + 0.6 * Math.sqrt(t)));
      f.material.opacity = 1 - t;
    }
  }

  /** A spell bursting at (x, y); `radius` is the area it catches, 0 for one creature. */
  burst(spell: SpellRecord, x: number, y: number, height: number, radius: number): void {
    const material = new THREE.SpriteMaterial({ map: this.glow(spellColour(spell)), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, height, y);
    this.group.add(sprite);
    this.flashes.push({ sprite, material, age: 0, size: radius ? radius * 2 : AREA_RADIUS * 0.5 });
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    for (const s of this.boltSprites.values()) s.material.dispose();
    for (const f of this.flashes) f.material.dispose();
  }

  /** A soft ball of light in `colour`, white at the heart. */
  private glow(colour: string): THREE.Texture {
    let texture = this.textures.get(colour);
    if (texture) return texture;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, colour);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(colour, texture);
    return texture;
  }
}
