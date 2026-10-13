import * as THREE from 'three';
import { fitWeaponModel } from './weaponModelSizing';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {weaponModelDefinition,weaponModelKey,weaponModelPath} from './weaponModelDefinitions';
import { STEEL_ARROW, type SteelWeaponDefinition } from './steelWeaponDefinitions';
export { STEEL_ARROW, STEEL_WEAPON_DEFINITIONS, steelWeaponDefinition } from './steelWeaponDefinitions';
export type { SteelWeaponDefinition } from './steelWeaponDefinitions';

export class SteelWeaponAssets {
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<string, Promise<THREE.Group>>();
  constructor() {
    // Embedded atlases are images. ImageBitmapLoader fetches their blob URLs, which
    // the desktop app's strict connect policy correctly blocks. TextureLoader uses
    // the existing img-src allowance, keeping the app's network policy intact.
    this.loader.register((parser) => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
      parser.textureLoader.setCrossOrigin(parser.options.crossOrigin);
      return { name: 'LOCAL_EMBEDDED_ATLAS' };
    });
  }
  async load(definition: SteelWeaponDefinition): Promise<THREE.Group> {
    let pending = this.templates.get(weaponModelKey(definition));
    if (!pending) {
      pending = this.loader
        .loadAsync(`${import.meta.env.BASE_URL}${weaponModelPath(definition)}`)
        .then((gltf) => {
          const template = gltf.scene;
          let textured = false;
          template.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              const materials = Array.isArray(o.material) ? o.material : [o.material];
              for (const m of materials) {
                const map = (m as THREE.MeshStandardMaterial).map;
                if (map) {
                  textured = true;
                  map.magFilter = THREE.NearestFilter;
                  map.minFilter = THREE.LinearMipmapLinearFilter;
                  map.needsUpdate = true;
                }
              }
            }
          });
          if (!textured) throw new Error(`${definition.name} has no loaded atlas`);
          return fitWeaponModel(template, definition);
        })
        .catch((error) => {
          this.templates.delete(weaponModelKey(definition));
          throw error;
        });
      this.templates.set(weaponModelKey(definition), pending);
    }
    return (await pending).clone(true);
  }
  loadWeapon(weapon: { type?: number; material?: number }): Promise<THREE.Group> | undefined {
    const def = weaponModelDefinition(weapon);
    return def ? this.load(def) : undefined;
  }
  arrow(): Promise<THREE.Group> {
    return this.load(STEEL_ARROW);
  }
}
export const steelWeapons = new SteelWeaponAssets();
