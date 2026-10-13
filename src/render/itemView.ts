/**
 * The picked item in the item menu, drawn as a model to turn and look at as
 * Skyrim's are. It starts from the front, as Arena draws it; dragging it
 * with the mouse or pushing the right stick turns it, and the mouse wheel
 * or pressing the right stick brings it closer. The light stays where the
 * viewer is, so it catches the item's sides as it turns.
 */
import * as THREE from 'three';
import { buildItemModel } from './itemModel';

/** Up and down the view, in degrees: narrow, so the front looks as flat as Arena's picture. */
const FOV = 20;
/** At most this many screen pixels to a picture's pixel, as the flat picture was. */
const MAX_SCALE = 4;
/** How much of the view the item may fill, unturned and not brought closer. */
const FILL = 0.9;
/** Radians of turn per pixel dragged, and per second with the stick pushed all the way. */
const DRAG_TURN = 0.01;
export const STICK_TURN = 3;
/** How far it can be tipped towards or away from the viewer. */
const MAX_TIP = 1.35;
const MAX_ZOOM = 2.5;
/** How close pressing the right stick (or clicking Zoom) brings it. */
const CLOSE_ZOOM = 2;
/** How quickly turning and zooming catch up with where they are going, per second. */
const EASE = 10;

/** sRGB to linear light, for the model's colours. */
const LINEAR = Array.from({ length: 256 }, (_, i) => new THREE.Color().setRGB(i / 255, 0, 0, THREE.SRGBColorSpace).r);

export class ItemView {
  /** Made when first needed; null when the browser could not make another WebGL view. */
  private renderer: THREE.WebGLRenderer | null | undefined;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 1000);
  private readonly pivot = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly models = new WeakMap<HTMLCanvasElement, { geometry: THREE.BufferGeometry; halfWidth: number; halfHeight: number; radius: number }>();
  private mesh: THREE.Object3D | undefined;
  private shown: { halfWidth: number; halfHeight: number; radius: number } | undefined;
  private yaw = 0;
  private tip = 0;
  private turnTo = 0;
  private zoom = 1;
  private zoomTo = 1;
  private drag: { id: number; x: number; y: number } | undefined;
  private frame = 0;
  private last = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    // A soft light all round, and one from above and to the left of the viewer; together they show the front as Arena drew it.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45 * Math.PI));
    const key = new THREE.DirectionalLight(0xffffff, 0.633 * Math.PI);
    key.position.set(-0.35, 0.45, 1);
    this.scene.add(key, this.pivot);

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.mesh) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag?.id !== e.pointerId) return;
      this.turn((e.clientX - this.drag.x) * DRAG_TURN, (e.clientY - this.drag.y) * DRAG_TURN);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    const letGo = (e: PointerEvent) => {
      if (this.drag?.id !== e.pointerId) return;
      this.drag = undefined;
      canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', letGo);
    canvas.addEventListener('pointercancel', letGo);
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.mesh) return;
        e.preventDefault();
        this.zoomTo = clamp(this.zoomTo * Math.exp(-e.deltaY * 0.0015), 1, MAX_ZOOM);
        this.request();
      },
      { passive: false },
    );
    new ResizeObserver(() => this.request()).observe(canvas);
  }

  /** Shows the item in `image` from the front, unturned. Resolves false when it can't be drawn. */
  show(image: HTMLCanvasElement): boolean {
    const renderer = this.ready();
    if (!renderer) return false;
    const model = this.model(image);
    if (!model) return false;
    if (this.mesh) this.pivot.remove(this.mesh);
    this.mesh = new THREE.Mesh(model.geometry, this.material);
    this.pivot.add(this.mesh);
    this.shown = model;
    this.yaw = this.turnTo = this.tip = 0;
    this.zoom = this.zoomTo = 1;
    this.draw();
    return true;
  }

  /** Displays the authored mesh and atlas, with shared assets left intact. */
  showObject(model: THREE.Object3D): boolean {
    if (!this.ready()) return false;
    if (this.mesh) this.pivot.remove(this.mesh);
    const group = new THREE.Group();
    const bounds = new THREE.Box3().setFromObject(model),
      center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3());
    model.position.sub(center);
    group.add(model);
    group.scale.setScalar(100);
    this.mesh = group;
    this.pivot.add(group);
    this.shown = {
      halfWidth: Math.max(0.01, size.x) * 50,
      halfHeight: Math.max(0.01, size.y) * 50,
      radius: size.length() * 50,
    };
    this.yaw = this.turnTo = this.tip = 0;
    this.zoom = this.zoomTo = 1;
    this.draw();
    return true;
  }

  /** Turns the item about its upright (dx) and tips it towards the viewer (dy), in radians. */
  turn(dx: number, dy: number): void {
    if (!this.mesh) return;
    this.yaw += dx;
    this.turnTo += dx;
    this.tip = clamp(this.tip + dy, -MAX_TIP, MAX_TIP);
    this.request();
  }

  /** A half turn, to show the other side; for clicking the Turn prompt. */
  spin(): void {
    if (!this.mesh) return;
    this.turnTo += Math.PI;
    this.request();
  }

  /** Brings the item close, or back again. */
  toggleZoom(): void {
    if (!this.mesh) return;
    this.zoomTo = this.zoomTo > (1 + CLOSE_ZOOM) / 2 ? 1 : CLOSE_ZOOM;
    this.request();
  }

  private ready(): THREE.WebGLRenderer | null {
    if (this.renderer === undefined) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
        this.renderer.setClearColor(0x000000, 0);
      } catch (err) {
        console.warn('Could not draw the item pictures in 3D:', err);
        this.renderer = null;
      }
    }
    return this.renderer;
  }

  private model(image: HTMLCanvasElement) {
    let model = this.models.get(image);
    if (!model) {
      const pixels = image.getContext('2d')?.getImageData(0, 0, image.width, image.height);
      if (!pixels) return undefined;
      const built = buildItemModel({ width: image.width, height: image.height, rgba: pixels.data });
      if (!built.indices.length) return undefined;
      for (let i = 0; i < built.colors.length; i++) built.colors[i] = LINEAR[Math.round(built.colors[i] * 255)];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(built.normals, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(built.colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(built.indices, 1));
      model = { geometry, halfWidth: built.halfWidth, halfHeight: built.halfHeight, radius: built.radius };
      this.models.set(image, model);
    }
    return model;
  }

  /** Draws on the next frame, once however often it is asked. */
  private request(): void {
    if (this.frame || !this.mesh) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
      this.last = now;
      const k = 1 - Math.exp(-EASE * dt);
      this.yaw += (this.turnTo - this.yaw) * k;
      this.zoom += (this.zoomTo - this.zoom) * k;
      const settling = Math.abs(this.turnTo - this.yaw) > 1e-3 || Math.abs(this.zoomTo - this.zoom) > 1e-3;
      if (!settling) {
        this.yaw = this.turnTo;
        this.zoom = this.zoomTo;
      }
      this.draw();
      if (settling) this.request();
      else this.last = 0;
    });
  }

  private draw(): void {
    const renderer = this.renderer;
    const model = this.shown;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!renderer || !model || !w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
    // Unturned, as large as fits but no larger than the flat picture was; then as close as zoomed.
    const scale = Math.min(MAX_SCALE, (FILL * w) / (2 * model.halfWidth), (FILL * h) / (2 * model.halfHeight)) * this.zoom;
    const distance = h / (2 * scale * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    this.camera.aspect = w / h;
    this.camera.near = Math.max(0.1, distance - model.radius - 1);
    this.camera.far = distance + model.radius + 1;
    this.camera.position.set(0, 0, distance);
    this.camera.updateProjectionMatrix();
    this.pivot.rotation.set(this.tip, this.yaw, 0);
    renderer.render(this.scene, this.camera);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
