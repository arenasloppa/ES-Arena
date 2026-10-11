import { describe, expect, it } from 'vitest';
import { parseClassAnswers, parseNameChunks, parseQuestions } from '../src/formats/creation';
import { ascii, u16 } from './helpers/encode';

describe('QUESTION.TXT', () => {
  it('reads questions with their three tagged answers, joining wrapped lines', () => {
    const text = [
      '1. Which tool do you',
      'reach for first?',
      'a) A hammer (5v)',
      'b) A lockpick',
      '   in the dark (3c)',
      'c) A book (2l)',
      '',
      '2. A question with an untagged answer?',
      'a) Yes (1v)',
      'b) No',
      'c) Maybe (2l)',
      '3. What do you fear?',
      'a) Nothing (V)',
      'b) Being caught (c)',
      'c) Ignorance (9L)',
    ].join('\r\n');
    const questions = parseQuestions(text);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toEqual({
      text: 'Which tool do you reach for first?',
      answers: [
        { text: 'A hammer', path: 0 },
        { text: 'A lockpick in the dark', path: 1 },
        { text: 'A book', path: 2 },
      ],
    });
    expect(questions[1].answers.map((a) => a.path)).toEqual([0, 1, 2]);
  });
});

describe('CLASSES.DAT', () => {
  // Every way ten answers can fall among the three paths, and a made-up order of classes.
  const tallies: number[][] = [];
  for (let v = 10; v >= 0; v--) for (let c = 0; c <= 10 - v; c++) tallies.push([v, c, 10 - v - c]);
  const order = Array.from({ length: 18 }, (_, i) => (i * 7) % 18);
  const data = () => new Uint8Array([...order.map((n, i) => n | (i % 2 ? 0x40 : 0x20)), ...tallies.flat()]);

  it('gives four tallies to each of the first twelve classes and three to the rest', () => {
    const choose = parseClassAnswers(data());
    expect(tallies).toHaveLength(66);
    expect(choose(tallies[0])).toBe(order[0]);
    expect(choose(tallies[3])).toBe(order[0]);
    expect(choose(tallies[4])).toBe(order[1]);
    expect(choose(tallies[47])).toBe(order[11]);
    expect(choose(tallies[48])).toBe(order[12]);
    expect(choose(tallies[65])).toBe(order[17]);
    expect(choose([3, 3, 3])).toBeUndefined();
  });

  it('rejects a file that is not one', () => {
    expect(() => parseClassAnswers(new Uint8Array(100))).toThrow(/size/);
    const bad = data();
    bad[18] = 9;
    expect(() => parseClassAnswers(bad)).toThrow(/ten/);
  });
});

describe('NAMECHNK.DAT', () => {
  const group = (pieces: string[]) => {
    const body = pieces.flatMap((p) => [...ascii(p), 0]);
    return [...u16(body.length + 3), pieces.length, ...body];
  };

  it('reads the groups of name pieces', () => {
    const data = new Uint8Array([...group(['Ka', 'Lo']), ...group(['rin', 'mak', 'dul'])]);
    expect(parseNameChunks(data)).toEqual([
      ['Ka', 'Lo'],
      ['rin', 'mak', 'dul'],
    ]);
  });

  it('rejects a group that runs past the end', () => {
    expect(() => parseNameChunks(new Uint8Array([...u16(40), 1, 0]))).toThrow(/past the end/);
  });
});
