/**
 * Access to the player's own Arena folder.
 *
 * The remake ships no game data. The player picks the folder that holds
 * GLOBAL.BSA, and every asset is read from it at runtime. Lookups are
 * case-insensitive by base name (DOS file names), and loose files take
 * priority over GLOBAL.BSA entries, as in the original game.
 */
import { BsaArchive } from '../formats/bsa';

export interface FileSource {
  /** Upper-case base names of every file in the chosen folder. */
  names(): string[];
  read(name: string): Promise<Uint8Array>;
}

export interface RequiredFile {
  /** Any one of these names satisfies the requirement. */
  anyOf: string[];
  why: string;
}

export const REQUIRED_FILES: RequiredFile[] = [
  { anyOf: ['GLOBAL.BSA'], why: 'textures, maps and sounds archive' },
  { anyOf: ['ACD.EXE', 'A.EXE'], why: 'game executable (CD or floppy version)' },
  { anyOf: ['PAL.COL'], why: 'main colour palette' },
  { anyOf: ['TEMPLATE.DAT'], why: 'dialogue templates' },
  { anyOf: ['QUESTION.TXT'], why: 'character creation questions' },
  { anyOf: ['CITYDATA.65'], why: 'new-game city data' },
  { anyOf: ['SPELLSG.65'], why: 'new-game spell data' },
  { anyOf: ['ARENAFNT.DAT', 'FONT_A.DAT'], why: 'font' },
];

export interface ValidationResult {
  ok: boolean;
  checks: Array<RequiredFile & { found?: string }>;
}

export function validateFolder(names: Iterable<string>): ValidationResult {
  const set = new Set([...names].map((n) => n.toUpperCase()));
  const checks = REQUIRED_FILES.map((req) => ({ ...req, found: req.anyOf.find((n) => set.has(n)) }));
  return { ok: checks.every((c) => c.found), checks };
}

/** Builds a source from <input type="file" webkitdirectory> results. */
export function sourceFromFileList(files: Iterable<File>): FileSource {
  const all = [...files];
  // The player may pick a parent folder (e.g. the GamesNostalgia wrapper);
  // use the directory that actually contains GLOBAL.BSA.
  const bsa = all.find((f) => baseName(f).toUpperCase() === 'GLOBAL.BSA');
  const root = bsa ? dirName(relPath(bsa)) : undefined;
  const byName = new Map<string, File>();
  for (const f of all) {
    const dir = dirName(relPath(f));
    if (root !== undefined && dir !== root && !dir.startsWith(root + '/')) continue;
    const key = (dir === root ? '' : dir.slice((root ?? '').length).replace(/^\//, '') + '/') + baseName(f);
    const upper = key.toUpperCase();
    if (!byName.has(upper)) byName.set(upper, f);
  }
  return {
    names: () => [...byName.keys()],
    read: async (name) => {
      const f = byName.get(name.toUpperCase());
      if (!f) throw new Error(`${name} is not in the chosen folder`);
      return new Uint8Array(await f.arrayBuffer());
    },
  };
}

/** Builds a source from a File System Access API directory handle (Chromium). */
export async function sourceFromDirectoryHandle(dir: FileSystemDirectoryHandle): Promise<FileSource> {
  const byName = new Map<string, FileSystemFileHandle>();
  const walk = async (d: FileSystemDirectoryHandle, prefix: string, depth: number) => {
    for await (const [name, handle] of d.entries()) {
      if (handle.kind === 'file') byName.set((prefix + name).toUpperCase(), handle as FileSystemFileHandle);
      else if (depth < 4) await walk(handle as FileSystemDirectoryHandle, prefix + name + '/', depth + 1);
    }
  };
  await walk(dir, '', 0);

  // Re-root at the folder holding GLOBAL.BSA if the player picked a parent.
  const bsaKey = [...byName.keys()].find((k) => k === 'GLOBAL.BSA' || k.endsWith('/GLOBAL.BSA'));
  const root = bsaKey ? bsaKey.slice(0, bsaKey.length - 'GLOBAL.BSA'.length) : '';
  const rooted = new Map<string, FileSystemFileHandle>();
  for (const [k, h] of byName) if (k.startsWith(root)) rooted.set(k.slice(root.length), h);

  return {
    names: () => [...rooted.keys()],
    read: async (name) => {
      const h = rooted.get(name.toUpperCase());
      if (!h) throw new Error(`${name} is not in the chosen folder`);
      return new Uint8Array(await (await h.getFile()).arrayBuffer());
    },
  };
}

/** Game data: loose files first, then GLOBAL.BSA. */
export class GameData {
  private constructor(
    private readonly source: FileSource,
    readonly bsa: BsaArchive,
    private readonly loose: Set<string>,
  ) {}

  static async open(source: FileSource): Promise<GameData> {
    const bsa = new BsaArchive(await source.read('GLOBAL.BSA'));
    return new GameData(source, bsa, new Set(source.names()));
  }

  has(name: string): boolean {
    const n = name.toUpperCase();
    return this.loose.has(n) || this.bsa.has(n);
  }

  async read(name: string): Promise<Uint8Array> {
    const n = name.toUpperCase();
    if (this.loose.has(n)) return this.source.read(n);
    const e = this.bsa.get(n);
    if (!e) throw new Error(`${name} was not found in the Arena folder or GLOBAL.BSA`);
    return e;
  }

  /** Every map name available, loose and archived. */
  mapNames(): string[] {
    const names = new Set<string>();
    for (const n of this.loose) if (n.endsWith('.MIF') && !n.includes('/')) names.add(n);
    for (const e of this.bsa.entries) if (e.name.toUpperCase().endsWith('.MIF')) names.add(e.name.toUpperCase());
    return [...names].sort();
  }
}

function relPath(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}
function baseName(f: File): string {
  return f.name;
}
function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}
