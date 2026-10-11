/**
 * The map screen: the part of the dungeon the player has seen, in 3D with
 * its own textures, looked down on from above. The player can turn, tilt,
 * zoom and move it; an arrow marks where they stand and which way they face.
 */
import * as THREE from 'three';
import type { Dungeon } from '../game/dungeon';
import { buildMapGeometry, CAP_KEY, type ShadedBatch } from './mapGeometry';

/** Walls on the map, as a fraction of the room height. */
const WALL_HEIGHT = 0.4;
const MIN_TILT = 0.35;
const MAX_TILT = 1.5;
const MIN_DISTANCE = 3;
const MAX_DISTANCE = 70;

export class MapView {
  readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  private readonly terrain = new THREE.Group();
  private readonly marker = new THREE.Group();
  private readonly glow: THREE.Mesh;
  private readonly materials = new Map<string, Promise<THREE.Material>>();
  private builtKey = '';
  private readonly target = new THREE.Vector3();
  /** Compass bearing of the view's up direction: 0 shows north at the top. */
  private heading = 0;
  /** Angle above the ground the view looks down from. */
  private tilt = 1.05;
  private distance = 16;
  private time = 0;

  constructor(
    private readonly dungeon: Dungeon,
    private readonly levelMaterial: (key: string) => Promise<THREE.Material>,
    private readonly north?: HTMLElement,
  ) {
    this.scene.background = new THREE.Color(0x050505);
    this.scene.add(this.terrain, this.marker);
    // An arrow for the player, drawn over everything so walls never hide it.
    const arrow = new THREE.Shape([
      new THREE.Vector2(0.42, 0),
      new THREE.Vector2(-0.28, 0.28),
      new THREE.Vector2(-0.12, 0),
      new THREE.Vector2(-0.28, -0.28),
    ]);
    const onTop = (color: number, opacity = 1) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const outline = new THREE.Mesh(new THREE.ShapeGeometry(arrow).scale(1.35, 1.35, 1), onTop(0x000000, 0.85));
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(arrow), onTop(0xf6eed8));
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), onTop(0xf6eed8, 0.25));
    for (const [i, m] of [this.glow, outline, fill].entries()) {
      m.geometry.rotateX(-Math.PI / 2);
      m.renderOrder = 10 + i;
      this.marker.add(m);
    }
  }

  /** Brings the map up to date and centres it on the player, north at the top. */
  async open(): Promise<void> {
    const d = this.dungeon;
    const key = `${d.explored.version}:${[...d.openDoors].join(',')}`;
    if (key !== this.builtKey) {
      this.builtKey = key;
      await this.rebuild();
    }
    this.target.set(d.player.x, 0, d.player.y);
    this.heading = 0;
    this.tilt = 1.05;
    this.distance = 16;
  }

  /** Turns (`dx`) and tilts (`dy`) the view, in radians. */
  turn(dx: number, dy: number): void {
    this.heading += dx;
    this.tilt = Math.min(MAX_TILT, Math.max(MIN_TILT, this.tilt + dy));
  }

  /** Moves the view across the map: `right` and `up` are in screen directions, scaled to the zoom. */
  move(right: number, up: number): void {
    const scale = this.distance * 0.06;
    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    this.target.x += (Math.cos(this.heading) * right + fx * up) * scale;
    this.target.z += (Math.sin(this.heading) * right + fz * up) * scale;
    const level = this.dungeon.level;
    this.target.x = Math.min(level.width, Math.max(0, this.target.x));
    this.target.z = Math.min(level.depth, Math.max(0, this.target.z));
  }

  /** Zooms by a factor: below 1 comes closer. */
  zoom(factor: number): void {
    this.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, this.distance * factor));
  }

  render(renderer: THREE.WebGLRenderer, dt: number): void {
    this.time += dt;
    const p = this.dungeon.player;
    this.marker.position.set(p.x, 0.02, p.y);
    this.marker.rotation.y = -p.yaw;
    this.glow.scale.setScalar(1 + 0.25 * Math.sin(this.time * 4));
    const size = renderer.getSize(new THREE.Vector2());
    this.camera.aspect = size.x / Math.max(1, size.y);
    this.camera.updateProjectionMatrix();
    const flat = Math.cos(this.tilt) * this.distance;
    this.camera.position.set(
      this.target.x - Math.sin(this.heading) * flat,
      Math.sin(this.tilt) * this.distance,
      this.target.z + Math.cos(this.heading) * flat,
    );
    this.camera.lookAt(this.target);
    if (this.north) this.north.style.transform = `rotate(${-this.heading}rad)`;
    renderer.render(this.scene, this.camera);
  }

  private async rebuild(): Promise<void> {
    const d = this.dungeon;
    const batches = buildMapGeometry(d.level, (i) => d.explored.has(i), d.openDoors, WALL_HEIGHT * d.level.height);
    const meshes = await Promise.all([...batches].map(async ([key, b]) => new THREE.Mesh(toGeometry(b), await this.material(key))));
    for (const old of this.terrain.children) (old as THREE.Mesh).geometry.dispose();
    this.terrain.clear();
    if (meshes.length) this.terrain.add(...meshes);
  }

  /** The level's own material for a texture, shaded for the map. */
  private material(key: string): Promise<THREE.Material> {
    let m = this.materials.get(key);
    if (!m) {
      m = (async () => {
        if (key === CAP_KEY) return new THREE.MeshBasicMaterial({ color: 0x3b3631, vertexColors: true });
        const base = (await this.levelMaterial(key)) as THREE.MeshBasicMaterial;
        const mat = base.clone();
        mat.vertexColors = true;
        mat.fog = false;
        return mat;
      })();
      this.materials.set(key, m);
    }
    return m;
  }

  dispose(): void {
    for (const old of this.terrain.children) (old as THREE.Mesh).geometry.dispose();
    for (const m of this.materials.values()) void m.then((mat) => mat.dispose());
    for (const child of this.marker.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

function toGeometry(b: ShadedBatch): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
  // The shades are meant as seen on screen; the renderer works in linear light.
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.colors.map((c) => c ** 2.2), 3));
  g.setIndex(b.indices);
  return g;
}
