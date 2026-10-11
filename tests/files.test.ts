import { describe, expect, it } from 'vitest';
import { GameData, sourceFromFileList, validateFolder } from '../src/data/files';
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
