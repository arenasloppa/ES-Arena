/**
 * Finding things in the unpacked program (see pklite.ts) by the text near
 * them, and reading its zero-terminated strings. Shared by the readers of
 * the program's tables (exe.ts, classes.ts).
 */

/** The program is laid out differently from the one the readers know, so its tables are not trusted. */
export class ExeLayoutError extends Error {}

/** Where `text` first appears at or after `from`; throws when it is nowhere. */
export function find(image: Uint8Array, text: string, what: string, from = 0): number {
  const first = text.charCodeAt(0);
  outer: for (let i = image.indexOf(first, from); i !== -1; i = image.indexOf(first, i + 1)) {
    for (let k = 1; k < text.length; k++) if (image[i + k] !== text.charCodeAt(k)) continue outer;
    return i;
  }
  throw new ExeLayoutError(`could not find the ${what}`);
}

export function cString(image: Uint8Array, p: number): string {
  let s = '';
  while (p < image.length && image[p] !== 0 && s.length < 256) s += String.fromCharCode(image[p++]);
  return s;
}

export function stringsAt(image: Uint8Array, p: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const s = cString(image, p);
    out.push(s);
    p += s.length + 1;
  }
  return out;
}

/** Bytes taken by `strings` with their terminating zeros. */
export function stringsLength(strings: string[]): number {
  return strings.reduce((n, s) => n + s.length + 1, 0);
}
