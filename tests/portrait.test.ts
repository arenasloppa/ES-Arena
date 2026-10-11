import { describe, expect, it } from 'vitest';
import { dollLayers, equipmentFile } from '../src/render/portrait';

describe('the paper doll', () => {
  it('stacks the race’s background, the face, the clothes and then the gear, for men and women', () => {
    expect(dollLayers({ race: 2, gender: 'male', face: 4, robe: false, equipment: [7, 20] })).toEqual([
      { file: 'CHARBK02.IMG' },
      { file: 'FACES12.CIF', frame: 4 },
      { file: 'MPANTS.IMG' },
      { file: 'MSSHIRT.IMG' },
      { file: '0EQUIP.CIF', frame: 7 },
      { file: '0EQUIP.CIF', frame: 20 },
    ]);
    expect(dollLayers({ race: 7, gender: 'female', face: 0, robe: true, equipment: [] })).toEqual([
      { file: 'CHRBKF07.IMG' },
      { file: 'FACESF17.CIF', frame: 0 },
      { file: 'FPANTS.IMG' },
      { file: 'FRSHIRT.IMG' },
    ]);
    expect(equipmentFile('female')).toBe('1EQUIP.CIF');
  });
});
