import * as THREE from 'three';
import type { QuadBatch } from './levelGeometry';

/** Places the liquid backdrop behind recessed shore stones, meeting the unchanged water plane at its foot. */
export function liquidBackdrop(batch: QuadBatch, depth: number): QuadBatch {
  const result: QuadBatch = { positions: [], uvs: [], indices: [] };
  for (let base = 0; base < batch.positions.length / 3; base += 4) {
    const p = (i: number) => new THREE.Vector3().fromArray(batch.positions, (base + i) * 3);
    const a = p(0), b = p(1), c = p(2), d = p(3);
    const normal = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
    const bottom = Math.min(a.y, b.y, c.y, d.y), top = Math.max(a.y, b.y, c.y, d.y);
    const point = (left: THREE.Vector3, right: THREE.Vector3, t: number) => {
      const v = left.clone().lerp(right, t);
      return v.addScaledVector(normal, -depth * Math.min(1, Math.max(0, (v.y - bottom) / ((top - bottom) / 32))));
    };
    for (let row = 0; row < 32; row++) {
      const lo = row / 32, hi = (row + 1) / 32, start = result.positions.length / 3;
      for (const v of [point(a, d, lo), point(b, c, lo), point(b, c, hi), point(a, d, hi)]) result.positions.push(v.x, v.y, v.z);
      result.uvs.push(0, lo, 1, lo, 1, hi, 0, hi);
      result.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  return result;
}
