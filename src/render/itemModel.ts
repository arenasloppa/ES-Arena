/**
 * Gives an item's picture from the game depth, so the item menu can turn it
 * as Skyrim turns its models. Every opaque pixel becomes a patch of a front
 * and a back surface, which swell away from the picture's outline the
 * further in they are, and a thin band closes the two round the outline. So
 * a blade stays thin, while a cuirass or a shield bulges in the middle.
 * Kept free of WebGL so it can be unit tested; itemView.ts draws it.
 *
 * Model axes: X right, Y up and Z towards the viewer, in the picture's
 * pixels with Arena's tall pixels on Y, centred on what the picture shows.
 */
import { PIXEL_ASPECT } from './portrait';

/** A picture's RGBA pixels, row by row from the top. */
export interface ItemPicture {
  width: number;
  height: number;
  rgba: ArrayLike<number>;
}

export interface ItemModel {
  positions: Float32Array;
  normals: Float32Array;
  /** Each corner's colour from the picture, sRGB from 0 to 1. */
  colors: Float32Array;
  indices: Uint32Array;
  /** Half of what the picture shows, across and up, for framing the model. */
  halfWidth: number;
  halfHeight: number;
  /** How far the model reaches from its centre, whichever way it is turned. */
  radius: number;
}

/** Half the thickness at the outline, in pixels: one pixel through. */
export const RIM = 0.5;
/** How steeply the surfaces rise from the outline, as height per pixel inward. */
const SLOPE = 0.55;
/** The most the middle swells, as a share of how far in it lies, and at most. */
const SWELL_SHARE = 0.35;
const MAX_SWELL = 6;

export function buildItemModel(picture: ItemPicture, aspect = PIXEL_ASPECT): ItemModel {
  const { width: w, height: h, rgba } = picture;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] > 0;

  // What the picture shows: its opaque pixels' bounds.
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) {
    return { positions: new Float32Array(), normals: new Float32Array(), colors: new Float32Array(), indices: new Uint32Array(), halfWidth: 0, halfHeight: 0, radius: 0 };
  }

  // The pixels' corners, and how far each lies inside the outline.
  const cw = w + 1;
  const ch = h + 1;
  const corner = (cx: number, cy: number) => cy * cw + cx;
  const inside = (cx: number, cy: number) => opaque(cx - 1, cy - 1) && opaque(cx, cy - 1) && opaque(cx - 1, cy) && opaque(cx, cy);
  const depth = distanceInside(cw, ch, inside, aspect);
  let deepest = 0;
  for (const d of depth) deepest = Math.max(deepest, d);
  const swell = Math.min(MAX_SWELL, SWELL_SHARE * deepest);
  const height = new Float32Array(cw * ch);
  for (let i = 0; i < height.length; i++) height[i] = RIM + (swell > 0 ? swell * (1 - Math.exp((-SLOPE * depth[i]) / swell)) : 0);

  // Each corner's slope across (sx) and down the picture (sy), for its normals.
  const slope = (cx: number, cy: number): [number, number] => {
    const x0 = Math.max(0, cx - 1);
    const x1 = Math.min(cw - 1, cx + 1);
    const y0 = Math.max(0, cy - 1);
    const y1 = Math.min(ch - 1, cy + 1);
    return [(height[corner(x1, cy)] - height[corner(x0, cy)]) / (x1 - x0), (height[corner(cx, y1)] - height[corner(cx, y0)]) / (y1 - y0)];
  };

  const centreX = (minX + maxX + 1) / 2;
  const centreY = (minY + maxY + 1) / 2;
  const X = (cx: number) => cx - centreX;
  const Y = (cy: number) => (centreY - cy) * aspect;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let colour: [number, number, number] = [0, 0, 0];
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    const len = Math.hypot(nx, ny, nz);
    positions.push(x, y, z);
    normals.push(nx / len, ny / len, nz / len);
    colors.push(...colour);
  };
  /** Ends a quad of the last four corners, given anticlockwise as seen from outside. */
  const quad = () => {
    const base = positions.length / 3 - 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  /** A corner of the front (side 1) or back (side -1) surface. */
  const surface = (cx: number, cy: number, side: 1 | -1) => {
    const [sx, sy] = slope(cx, cy);
    vertex(X(cx), Y(cy), side * height[corner(cx, cy)], -sx, sy / aspect, side);
  };
  /** The band round the outline along the edge from corner a to corner b, with the outside on its right. */
  const band = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
    const ha = height[corner(ax, ay)];
    const hb = height[corner(bx, by)];
    vertex(X(ax), Y(ay), ha, nx, ny, 0);
    vertex(X(ax), Y(ay), -ha, nx, ny, 0);
    vertex(X(bx), Y(by), -hb, nx, ny, 0);
    vertex(X(bx), Y(by), hb, nx, ny, 0);
    quad();
  };

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!opaque(x, y)) continue;
      const p = (y * w + x) * 4;
      colour = [rgba[p] / 255, rgba[p + 1] / 255, rgba[p + 2] / 255];
      // Front: bottom left, bottom right, top right, top left; the back the other way round.
      surface(x, y + 1, 1);
      surface(x + 1, y + 1, 1);
      surface(x + 1, y, 1);
      surface(x, y, 1);
      quad();
      surface(x, y, -1);
      surface(x + 1, y, -1);
      surface(x + 1, y + 1, -1);
      surface(x, y + 1, -1);
      quad();
      if (!opaque(x - 1, y)) band(x, y, x, y + 1, -1, 0);
      if (!opaque(x, y + 1)) band(x, y + 1, x + 1, y + 1, 0, -1);
      if (!opaque(x + 1, y)) band(x + 1, y + 1, x + 1, y, 1, 0);
      if (!opaque(x, y - 1)) band(x + 1, y, x, y, 0, 1);
    }
  }

  const halfWidth = (maxX + 1 - minX) / 2;
  const halfHeight = ((maxY + 1 - minY) * aspect) / 2;
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
    halfWidth,
    halfHeight,
    radius: Math.hypot(halfWidth, halfHeight, RIM + swell),
  };
}

/**
 * How far each corner of a cw x ch grid lies from the nearest corner that
 * isn't inside, as the crow flies, with rows `aspect` apart: a two-pass
 * chamfer distance, near enough to the true one for a gentle swell.
 */
function distanceInside(cw: number, ch: number, inside: (cx: number, cy: number) => boolean, aspect: number): Float32Array {
  const d = new Float32Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) d[cy * cw + cx] = inside(cx, cy) ? Infinity : 0;
  const diagonal = Math.hypot(1, aspect);
  const at = (cx: number, cy: number) => (cx < 0 || cy < 0 || cx >= cw || cy >= ch ? 0 : d[cy * cw + cx]);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const i = cy * cw + cx;
      d[i] = Math.min(d[i], at(cx - 1, cy) + 1, at(cx, cy - 1) + aspect, at(cx - 1, cy - 1) + diagonal, at(cx + 1, cy - 1) + diagonal);
    }
  }
  for (let cy = ch - 1; cy >= 0; cy--) {
    for (let cx = cw - 1; cx >= 0; cx--) {
      const i = cy * cw + cx;
      d[i] = Math.min(d[i], at(cx + 1, cy) + 1, at(cx, cy + 1) + aspect, at(cx + 1, cy + 1) + diagonal, at(cx - 1, cy + 1) + diagonal);
    }
  }
  return d;
}
