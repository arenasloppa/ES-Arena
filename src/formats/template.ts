/**
 * TEMPLATE.DAT: the game's longer texts, each under a key line such as
 * "#1400" (four digits, sometimes a letter after), running to an "&" or the
 * next key. %pcf stands for the player's first name. Ria Silmane's vision
 * is #1400, and the visions on dying #1402 (hers) and #1403 (Jagar Tharn's).
 */

export type Templates = Map<string, string>;

export function parseTemplates(text: string): Templates {
  const out: Templates = new Map();
  let key: string | undefined;
  let lines: string[] = [];
  const flush = () => {
    if (key !== undefined && !out.has(key)) out.set(key, lines.join('\n').replace(/\s+$/, ''));
    key = undefined;
    lines = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const m = /^#(\d{4}[a-zA-Z]?)\s*$/.exec(line);
    if (m) {
      flush();
      key = m[1];
      continue;
    }
    if (key === undefined) continue;
    const end = line.indexOf('&');
    if (end >= 0) {
      lines.push(line.slice(0, end));
      flush();
    } else lines.push(line);
  }
  flush();
  return out;
}

/** Puts the player's first name in for %pcf. */
export function fillTemplate(text: string, firstName: string): string {
  return text.replace(/%pcf/g, firstName);
}

/** Splits a text into pages of up to `perPage` lines, as the cutscenes show it under the picture. */
export function pages(text: string, perPage = 3): string[] {
  const lines = text.split('\n').filter((l, i, all) => l.trim() || i < all.length - 1);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += perPage) out.push(lines.slice(i, i + perPage).join('\n'));
  return out.filter((p) => p.trim());
}
