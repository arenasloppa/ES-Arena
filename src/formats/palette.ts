/**
 * Palette (.COL) reader.
 *
 * 776 bytes: a u32 file size, a u32 magic (0xB123), then 256 RGB triplets
 * with 8 bits per channel (6-bit VGA values are scaled up). Some palettes stored inside the executable or
 * BSA are a bare 768-byte table; those are accepted too.
 */
export type Palette = Uint8Array; // 256 * 4 bytes, RGBA

export function parseCol(data: Uint8Array): Palette {
  let rgb: Uint8Array;
  if (data.length === 776) rgb = data.subarray(8);
  else if (data.length === 768) rgb = data;
  else throw new Error(`COL: unexpected size ${data.length}`);

  // Palettes embedded in IMGs use 6-bit VGA values (0-63); scale those up.
  let max = 0;
  for (let i = 0; i < 768; i++) max = Math.max(max, rgb[i]);
  const scale = (v: number) => (max <= 63 ? Math.round((v * 255) / 63) : v);

  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4] = scale(rgb[i * 3]);
    out[i * 4 + 1] = scale(rgb[i * 3 + 1]);
    out[i * 4 + 2] = scale(rgb[i * 3 + 2]);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Turns 8-bit palette indices into RGBA. Index 0 is transparent when asked. */
export function indicesToRgba(indices: Uint8Array, palette: Palette, transparentZero = false): Uint8Array {
  const out = new Uint8Array(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const p = indices[i] * 4;
    out[i * 4] = palette[p];
    out[i * 4 + 1] = palette[p + 1];
    out[i * 4 + 2] = palette[p + 2];
    out[i * 4 + 3] = transparentZero && indices[i] === 0 ? 0 : 255;
  }
  return out;
}

/** Ghost texels 1–13 darken the scene through their silhouette; 14/15 are the eyes.
 * RGBA blending approximates the original indexed light-table composition.
 */
export function spectralRgba(indices: Uint8Array, palette: Palette): Uint8Array {
  const out = indicesToRgba(indices, palette, true);
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i], offset = i * 4;
    if (index >= 1 && index <= 13) {
      out[offset] = out[offset + 1] = out[offset + 2] = 0;
      out[offset + 3] = Math.round((index - 1) * 255 / 12);
    } else if (index === 14 || index === 15) {
      out.set(palette.subarray((index + 144) * 4, (index + 145) * 4), offset);
    }
  }
  return out;
}
