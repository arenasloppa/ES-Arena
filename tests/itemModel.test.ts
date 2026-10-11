import { describe, expect, it } from 'vitest';
import { buildItemModel, RIM, type ItemPicture } from '../src/render/itemModel';

/** A made-up picture from rows of text: '#' is an opaque pixel of the given colour, '.' see-through. */
function picture(rows: string[], rgb: [number, number, number] = [200, 100, 50]): ItemPicture {
  const width = rows[0].length;
  const rgba = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '#') rgba.set([...rgb, 255], (y * width + x) * 4);
    }),
  );
  return { width, height: rows.length, rgba };
}

/** The front surface's z at model point (x, y): the highest corner there. */
function frontZ(model: ReturnType<typeof buildItemModel>, x: number, y: number): number {
  let z = -Infinity;
  for (let i = 0; i < model.positions.length; i += 3) {
    if (Math.abs(model.positions[i] - x) < 1e-6 && Math.abs(model.positions[i + 1] - y) < 1e-6) z = Math.max(z, model.positions[i + 2]);
  }
  return z;
}

describe('turning item pictures', () => {
  it('makes a single pixel a block one pixel deep, closed on every side', () => {
    const model = buildItemModel(picture(['#']), 1.5);
    // Front, back and four sides, of four corners and two triangles each.
    expect(model.positions.length / 3).toBe(24);
    expect(model.indices.length).toBe(36);
    expect(model.halfWidth).toBe(0.5);
    expect(model.halfHeight).toBe(0.75);
    const zs = new Set<number>();
    for (let i = 2; i < model.positions.length; i += 3) zs.add(model.positions[i]);
    expect([...zs].sort()).toEqual([-RIM, RIM]);
  });

  it('builds nothing from a see-through picture', () => {
    const model = buildItemModel(picture(['...', '...']));
    expect(model.indices.length).toBe(0);
    expect(model.radius).toBe(0);
  });

  it('centres the model on what the picture shows, in tall pixels', () => {
    const model = buildItemModel(picture(['.....', '..##.', '..##.', '.....']), 2);
    expect(model.halfWidth).toBe(1);
    expect(model.halfHeight).toBe(2);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < model.positions.length; i += 3) {
      minX = Math.min(minX, model.positions[i]);
      maxX = Math.max(maxX, model.positions[i]);
      minY = Math.min(minY, model.positions[i + 1]);
      maxY = Math.max(maxY, model.positions[i + 1]);
    }
    expect([minX, maxX, minY, maxY]).toEqual([-1, 1, -2, 2]);
  });

  it('swells in the middle of a broad piece but keeps a thin one thin', () => {
    const broad = buildItemModel(picture(Array.from({ length: 12 }, () => '############')), 1);
    expect(frontZ(broad, 0, 0)).toBeGreaterThan(RIM + 1);
    expect(frontZ(broad, -6, 0)).toBeCloseTo(RIM);
    // Rising all the way in from the edge.
    expect(frontZ(broad, -4, 0)).toBeGreaterThan(frontZ(broad, -5, 0));
    expect(frontZ(broad, -2, 0)).toBeGreaterThan(frontZ(broad, -4, 0));
    const thin = buildItemModel(picture(['#############', '#############']), 1);
    expect(frontZ(thin, 0, 0)).toBeLessThan(RIM + 0.5);
  });

  it('is the same front and back, with each side lit from its own way', () => {
    const model = buildItemModel(picture(['.###.', '#####', '#####', '.###.']), 1.2);
    let front = 0;
    let back = 0;
    for (let i = 0; i < model.positions.length; i += 3) {
      const z = model.positions[i + 2];
      const nz = model.normals[i + 2];
      if (nz > 0.5) {
        front++;
        expect(z).toBeGreaterThan(0);
      } else if (nz < -0.5) {
        back++;
        expect(z).toBeLessThan(0);
      }
      expect(Math.hypot(model.normals[i], model.normals[i + 1], model.normals[i + 2])).toBeCloseTo(1);
    }
    expect(front).toBe(back);
    expect(front).toBe(16 * 4);
  });

  it('leans the normals outward where the surface falls to the edge', () => {
    const model = buildItemModel(picture(Array.from({ length: 9 }, () => '#########')), 1);
    // The front corner on the left edge, halfway up, faces out to the left.
    for (let i = 0; i < model.positions.length; i += 3) {
      if (model.positions[i] === -4.5 && model.positions[i + 1] === 0 && model.normals[i + 2] > 0) {
        expect(model.normals[i]).toBeLessThan(0);
        expect(model.normals[i + 1]).toBeCloseTo(0);
      }
    }
  });

  it('colours every corner with its pixel', () => {
    const model = buildItemModel(picture(['#'], [255, 51, 0]));
    for (let i = 0; i < model.colors.length; i += 3) {
      expect(model.colors[i]).toBeCloseTo(1);
      expect(model.colors[i + 1]).toBeCloseTo(0.2);
      expect(model.colors[i + 2]).toBeCloseTo(0);
    }
  });

  it('winds every triangle so it faces outward', () => {
    const model = buildItemModel(picture(['##.', '###', '.#.']), 1.2);
    const p = model.positions;
    for (let t = 0; t < model.indices.length; t += 3) {
      const [a, b, c] = [model.indices[t], model.indices[t + 1], model.indices[t + 2]].map((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const face = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const i = model.indices[t] * 3;
      const lit = face[0] * model.normals[i] + face[1] * model.normals[i + 1] + face[2] * model.normals[i + 2];
      expect(lit).toBeGreaterThan(0);
    }
  });
});
