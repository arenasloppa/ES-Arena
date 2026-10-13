import * as THREE from 'three';

const cropped = new WeakMap<THREE.Group, Map<string, THREE.Group>>();

/** Rebuilds a closed height-field panel for a partial tile without stretching its UVs. */
export function cropEnvironmentPanel(model: THREE.Group, v0: number, v1: number): THREE.Group | undefined {
  const key = `${v0}:${v1}`;
  let cache = cropped.get(model);
  if (!cache) { cache = new Map(); cropped.set(model, cache); }
  const previous = cache.get(key);
  if (previous) return previous;
  const surface = model.getObjectByName('Masonry_Relief');
  if (!(surface instanceof THREE.Mesh)) return undefined;
  const source = surface.geometry.getAttribute('position');
  const columns = Math.sqrt(source.count), n = columns - 1;
  if (!Number.isInteger(columns) || n < 1 || v0 < 0 || v1 > 1 || v1 <= v0) return undefined;
  const height = source.getY(0) - source.getY(n * columns);
  const bounds = new THREE.Box3().setFromObject(model);
  const bottom = bounds.min.z;
  const sample = (u: number, v: number): [number, number, number] => {
    const x = u * n, y = (1 - v) * n, x0 = Math.min(n - 1, Math.floor(x)), y0 = Math.min(n - 1, Math.floor(y));
    const dx = x - x0, dy = y - y0;
    const z = (row: number, col: number) => source.getZ(row * columns + col);
    const depth = THREE.MathUtils.lerp(THREE.MathUtils.lerp(z(y0, x0), z(y0, x0 + 1), dx),
      THREE.MathUtils.lerp(z(y0 + 1, x0), z(y0 + 1, x0 + 1), dx), dy);
    return [u - 0.5, (v - 0.5) * height, depth];
  };
  const rows = Math.max(1, Math.ceil(n * (v1 - v0)));
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= n; x++) {
    const u = x / n, v = v1 - y / rows * (v1 - v0);
    positions.push(...sample(u, v)); uv.push(u, v);
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < n; x++) {
    const a = y * columns + x, b = a + 1, c = a + columns, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const makeGeometry = (pos: number[], tex: number[], index?: number[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(tex, 2));
    if (index) geometry.setIndex(index);
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute('normal'), colors: number[] = [];
    for (let i = 0; i < normals.count; i++) {
      const shade = 0.78 + 0.22 * Math.max(0, normals.getZ(i)); colors.push(shade, shade, shade);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  };
  const group = new THREE.Group();
  const front = new THREE.Mesh(makeGeometry(positions, uv, indices), surface.material);
  front.name = 'Masonry_Relief'; group.add(front);
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) ring.push([i / n, v1]);
  for (let i = 0; i < rows; i++) ring.push([1, v1 - i / rows * (v1 - v0)]);
  for (let i = 0; i < n; i++) ring.push([1 - i / n, v0]);
  for (let i = 0; i < rows; i++) ring.push([0, v0 + i / rows * (v1 - v0)]);
  const sidePositions: number[] = [], sideUv: number[] = [];
  const triangle = (a: number[], b: number[], c: number[], ta: number[], tb: number[], tc: number[]) => {
    sidePositions.push(...a, ...b, ...c); sideUv.push(...ta, ...tb, ...tc);
  };
  for (let i = 0; i < ring.length; i++) {
    const t = ring[i], next = ring[(i + 1) % ring.length], a = sample(...t), b = sample(...next);
    const A = [a[0], a[1], bottom], B = [b[0], b[1], bottom];
    const du = next[0] - t[0], dv = next[1] - t[1], length = Math.hypot(du, dv), depth = a[2] - bottom;
    const rear = [t[0] + dv / length * depth, t[1] - du / length * depth / height];
    const rearNext = [next[0] + dv / length * depth, next[1] - du / length * depth / height];
    triangle(a, b, A, t, next, rear); triangle(b, B, A, next, rearNext, rear);
  }
  const a = [-0.5, (v1 - 0.5) * height, bottom], b = [0.5, a[1], bottom];
  const c = [0.5, (v0 - 0.5) * height, bottom], d = [-0.5, c[1], bottom];
  triangle(a, b, c, [0, v1], [1, v1], [1, v0]); triangle(a, c, d, [0, v1], [1, v0], [0, v0]);
  group.add(new THREE.Mesh(makeGeometry(sidePositions, sideUv), surface.material));
  cache.set(key, group);
  return group;
}
