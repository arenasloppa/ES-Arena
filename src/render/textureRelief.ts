// The bump maps' working out (arena_bump.js), off the game's thread: a texture's pixels in, its normal map's out. The same steps as there:
// its brightness softened a touch, its broad shading taken away, its contrast evened, its slopes (Sobel, wrapping; image rows run down, v up)
function blur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) { let s = 0; for (let k = -r; k <= r; k++) s += src[y * w + ((k % w) + w) % w];
    for (let x = 0; x < w; x++) { tmp[y * w + x] = s / n; s += src[y * w + (x + r + 1) % w] - src[y * w + ((x - r) % w + w) % w]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let k = -r; k <= r; k++) s += tmp[(((k % h) + h) % h) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / n; s += tmp[((y + r + 1) % h) * w + x] - tmp[(((y - r) % h + h) % h) * w + x]; } }
  return out;
}
export function relief(px: Uint8Array | Uint8ClampedArray, w: number, h: number, D: Uint8ClampedArray) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  const near = blur(L, w, h, 1), broad = blur(L, w, h, Math.max(3, Math.round(Math.min(w, h) / 12))), H = new Float32Array(w * h);
  let sd = 0; for (let i = 0; i < w * h; i++) { H[i] = near[i] - broad[i]; sd += H[i] * H[i]; } sd = Math.sqrt(sd / (w * h)) || 1;
  const k = 1 / (8 * sd);
  for (let y = 0; y < h; y++) { const r0 = ((y + h - 1) % h) * w, r1 = y * w, r2 = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) { const x0 = (x + w - 1) % w, x2 = (x + 1) % w;
      const dx = (H[r0 + x2] + 2 * H[r1 + x2] + H[r2 + x2] - H[r0 + x0] - 2 * H[r1 + x0] - H[r2 + x0]) * k,
        dy = (H[r2 + x0] + 2 * H[r2 + x] + H[r2 + x2] - H[r0 + x0] - 2 * H[r0 + x] - H[r0 + x2]) * k;
      const nx = -dx, ny = dy, l = Math.sqrt(nx * nx + ny * ny + 1), o = (r1 + x) * 4;
      D[o] = (nx / l * 0.5 + 0.5) * 255 + 0.5; D[o + 1] = (ny / l * 0.5 + 0.5) * 255 + 0.5; D[o + 2] = (1 / l * 0.5 + 0.5) * 255 + 0.5; D[o + 3] = 255; } }
  return D;
}
