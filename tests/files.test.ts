import { describe, expect, it } from 'vitest';
import { GameData, indexGameFolder, isRuntimeFile, sourceFromFileList, sourceFromPaths, validateFolder } from '../src/data/files';
import { makeBsa } from './helpers/encode';

const REQUIRED = ['GLOBAL.BSA', 'ACD.EXE', 'PAL.COL', 'TEMPLATE.DAT', 'QUESTION.TXT', 'CITYDATA.65', 'SPELLSG.65', 'ARENAFNT.DAT'];

function file(path: string, bytes: Uint8Array = new Uint8Array([1])): File {
  const f = new File([bytes as BlobPart], path.split('/').pop()!);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

describe('validateFolder', () => {
  it('passes with every required file, in any case', () => {
    expect(validateFolder(REQUIRED.map((n) => n.toLowerCase())).ok).toBe(true);
  });

  it('accepts the floppy executable and either font', () => {
    const names = REQUIRED.filter((n) => n !== 'ACD.EXE' && n !== 'ARENAFNT.DAT').concat('A.EXE', 'FONT_A.DAT');
    expect(validateFolder(names).ok).toBe(true);
  });

  it('reports what is missing', () => {
    const r = validateFolder(['GLOBAL.BSA']);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.found).map((c) => c.anyOf[0])).toContain('PAL.COL');
  });
});

describe('sourceFromFileList', () => {
  it('re-roots at the folder holding GLOBAL.BSA when a parent folder is picked', async () => {
    const src = sourceFromFileList([
      file('Wrapper/README.txt'),
      file('Wrapper/game/arena/GLOBAL.BSA', new Uint8Array([7])),
      file('Wrapper/game/arena/SPEECH/1294_00A.VOC'),
    ]);
    expect(src.names().sort()).toEqual(['GLOBAL.BSA', 'SPEECH/1294_00A.VOC']);
    expect([...(await src.read('global.bsa'))]).toEqual([7]);
  });
});

describe('sourceFromPaths', () => {
  it('reads each file by the path it was listed under', async () => {
    const asked: string[] = [];
    const src = sourceFromPaths(['ARENA/global.bsa', 'ARENA/Pal.Col', 'DOSBox/dosbox.conf'], async (path) => {
      asked.push(path);
      return new Uint8Array([path.length]);
    });
    expect(src.names().sort()).toEqual(['GLOBAL.BSA', 'PAL.COL']);
    expect([...(await src.read('PAL.COL'))]).toEqual(['ARENA/Pal.Col'.length]);
    expect(asked).toEqual(['ARENA/Pal.Col']);
    await expect(src.read('dosbox.conf')).rejects.toThrow('not in the chosen folder');
  });
});

describe('indexGameFolder', () => {
  const index = (paths: string[]) => [...indexGameFolder(paths.map((path) => ({ path, value: path }))).keys()].sort();

  it('finds the Steam layout and matches names case-insensitively', () => {
    expect(index(['ARENA/global.bsa', 'ARENA/Pal.Col', 'DOSBOX/dosbox.conf', 'ARENA/SPEECH/1294_00a.voc'])).toEqual([
      'GLOBAL.BSA',
      'PAL.COL',
      'SPEECH/1294_00A.VOC',
    ]);
  });

  it('finds the Mac wrapper layout three folders down', () => {
    expect(index(['game/Resources/arena/GLOBAL.BSA', 'game/Resources/arena/ACD.EXE', 'README.txt'])).toEqual(['ACD.EXE', 'GLOBAL.BSA']);
  });

  it('prefers the shallowest copy when the folder holds several', () => {
    const idx = indexGameFolder([
      { path: 'Mac/game/Resources/arena/GLOBAL.BSA', value: 'mac' },
      { path: 'Windows/arena/GLOBAL.BSA', value: 'windows' },
    ]);
    expect(idx.get('GLOBAL.BSA')).toBe('windows');
  });

  it('leaves out saves and runtime files but keeps new-game templates', () => {
    const kept = index([
      'ARENA/GLOBAL.BSA',
      'ARENA/CITYDATA.65',
      'ARENA/SPELLSG.65',
      'ARENA/WILD001.RMD',
      'ARENA/SAVEGAME.00',
      'ARENA/SAVEENGN.64',
      'ARENA/CITYDATA.00',
      'ARENA/WILD001.03',
      'ARENA/AUTOMAP.01',
      'ARENA/TEMPSAVE.$$$',
      'ARENA/SCREENSV.$$2',
      'ARENA/SOUND.CFG',
      'ARENA/VISION.EMS',
    ]);
    expect(kept).toEqual(['CITYDATA.65', 'GLOBAL.BSA', 'SPELLSG.65', 'WILD001.RMD']);
  });

  it('classifies runtime files', () => {
    expect(isRuntimeFile('savegame.05')).toBe(true);
    expect(isRuntimeFile('STATES.65')).toBe(false);
    expect(isRuntimeFile('GLOBAL.BSA')).toBe(false);
  });
});

describe('GameData', () => {
  it('prefers loose files over GLOBAL.BSA entries', async () => {
    const bsa = makeBsa({ 'START.MIF': new Uint8Array([1]), 'ONLY.IMG': new Uint8Array([2]) });
    const data = await GameData.open(
      sourceFromFileList([file('arena/GLOBAL.BSA', bsa), file('arena/START.MIF', new Uint8Array([9]))]),
    );
    expect([...(await data.read('start.mif'))]).toEqual([9]);
    expect([...(await data.read('ONLY.IMG'))]).toEqual([2]);
    expect(data.mapNames()).toEqual(['START.MIF']);
    await expect(data.read('NOPE.IMG')).rejects.toThrow();
  });
});
