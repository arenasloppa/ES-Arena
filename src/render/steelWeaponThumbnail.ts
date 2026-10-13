import * as THREE from 'three';
import { steelWeapons } from './steelWeaponAssets';
import {weaponModelDefinition,weaponModelKey} from './weaponModelDefinitions';
const thumbnails = new Map<string, Promise<HTMLCanvasElement | undefined>>();
/** Paper-doll equipment uses a snapshot of the authored model, in its existing equipment slot. */
export function steelWeaponThumbnail(weapon: { type?: number; material?: number }): Promise<HTMLCanvasElement | undefined> {
  const def = weaponModelDefinition(weapon);
  if (!def) return Promise.resolve(undefined);
  let pending = thumbnails.get(weaponModelKey(def));
  if (!pending) {
    pending = steelWeapons
      .load(def)
      .then((model) => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
        });
        try {
          const scene = new THREE.Scene(),
            bounds = new THREE.Box3().setFromObject(model),
            center = bounds.getCenter(new THREE.Vector3()),
            size = bounds.getSize(new THREE.Vector3());
          model.position.sub(center);
          scene.add(model, new THREE.HemisphereLight(0xffffff, 0x5d5966, 2));
          const key = new THREE.DirectionalLight(0xffffff, 2);
          key.position.set(-1, 2, 3);
          scene.add(key);
          const half = Math.max(size.x, size.y) * 0.55,
            camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 10);
          camera.position.z = 3;
          renderer.render(scene, camera);
          const image = document.createElement('canvas');
          image.width = 256;
          image.height = 256;
          image.getContext('2d')!.drawImage(canvas, 0, 0);
          return image;
        } finally {
          renderer.dispose();
        }
      })
      .catch((error) => {
        console.warn('Steel paper doll preview unavailable:', error);
        return undefined;
      });
    thumbnails.set(weaponModelKey(def), pending);
  }
  return pending;
}
