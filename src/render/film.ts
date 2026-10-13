/**
 * Draws the film behind the main menu (game/flythrough.ts): the shot on
 * screen, the one dissolving away under it, and the dips to black. A
 * dissolve draws both shots each frame, the old one into a picture laid
 * over the new, so both keep moving as they cross.
 */
import * as THREE from 'three';
import type { Film, FilmFrame, Pose } from '../game/flythrough';

/** A little narrower than the game's view, as a film's would be. */
const FOV = 60;

export class FilmView {
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.02, 100);
  private readonly before = new THREE.PerspectiveCamera(FOV, 1, 0.02, 100);
  private target: THREE.WebGLRenderTarget | undefined;
  private readonly overlay = new THREE.Scene();
  private readonly flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly still = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  private readonly dark = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false });
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private readonly stillMesh = new THREE.Mesh(this.plane, this.still);
  private readonly darkMesh = new THREE.Mesh(this.plane, this.dark);
  private shown: FilmFrame | undefined;

  constructor(readonly film: Film) {
    this.darkMesh.renderOrder = 1;
    this.overlay.add(this.stillMesh, this.darkMesh);
  }

  /** Moves the film on by `dt` seconds. */
  update(dt: number): void {
    this.shown = this.film.advance(dt);
  }

  /** Draws the film; `face` turns the sprites and creatures towards the camera it is given. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, face: (camera: THREE.Camera) => void): void {
    const frame = this.shown ?? this.film.frame();
    const destination = renderer.getRenderTarget();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const aspect = size.x / Math.max(1, size.y);
    const fading = frame.fading && frame.fading.weight > 0.002 ? frame.fading : undefined;
    if (fading) {
      if (!this.target || this.target.width !== size.x || this.target.height !== size.y) {
        this.target?.dispose();
        // Half floats, so the dark dungeon doesn't band as it fades.
        this.target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
        this.still.map = this.target.texture;
        this.still.needsUpdate = true;
      }
      place(this.before, fading.shot.pose(fading.t), aspect);
      face(this.before);
      renderer.setRenderTarget(this.target);
      renderer.render(scene, this.before);
      renderer.setRenderTarget(destination);
    }
    place(this.camera, frame.current.shot.pose(frame.current.t), aspect);
    face(this.camera);
    renderer.render(scene, this.camera);
    this.stillMesh.visible = !!fading;
    this.still.opacity = fading?.weight ?? 0;
    this.darkMesh.visible = frame.black > 0.002;
    this.dark.opacity = frame.black;
    if (this.stillMesh.visible || this.darkMesh.visible) {
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(this.overlay, this.flat);
      renderer.autoClear = autoClear;
    }
  }

  dispose(): void {
    this.target?.dispose();
    this.still.dispose();
    this.dark.dispose();
    this.plane.dispose();
  }
}

function place(camera: THREE.PerspectiveCamera, p: Pose, aspect: number): void {
  if (camera.aspect !== aspect) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  // Map x and y lie along the world's x and z; z is up.
  camera.position.set(p.x, p.z, p.y);
  camera.lookAt(p.lookX, p.lookZ, p.lookY);
}
