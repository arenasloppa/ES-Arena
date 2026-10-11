/**
 * The loose files character creation reads:
 *
 * QUESTION.TXT: the questions that choose a class. Each starts "N." and
 * has three answers, "a)" to "c)", every one ending in a tag such as
 * "(5v)": its letter counts the answer toward the warrior's path (v), the
 * thief's (c) or the mage's (l).
 *
 * CLASSES.DAT, 216 bytes: 18 class bytes (the low five bits are the class's
 * place in the game's list), then 66 triples of counts of v, c and l
 * answers, one for each way ten answers can fall. The first 48 triples go
 * four to a class, the last 18 three to a class, in the order of the class
 * bytes.
 *
 * NAMECHNK.DAT: groups of name pieces, each a u16 length (of the whole
 * group), a count and that many zero-terminated strings. A name is made by
 * picking one piece from each of a few groups (see game/character.ts).
 */

/** v: the warrior's path, c: the thief's, l: the mage's, as CLASSES.DAT counts them. */
export const PATHS = ['v', 'c', 'l'] as const;

export interface Answer {
  text: string;
  /** Which path it counts toward: 0 warrior, 1 thief, 2 mage. */
  path: number;
}

export interface Question {
  text: string;
  answers: Answer[];
}

/** Reads QUESTION.TXT; questions that don't have three tagged answers are left out. */
export function parseQuestions(text: string): Question[] {
  const questions: Question[] = [];
  let question: { text: string[]; answers: string[][] } | undefined;
  let part: string[] | undefined;
  const finish = () => {
    if (!question) return;
    const answers = question.answers.map((lines) => {
      const all = tidy(lines.join(' '));
      const tag = /\s*\(\d*([vcl])\)\s*$/i.exec(all);
      return tag ? { text: all.slice(0, tag.index), path: PATHS.indexOf(tag[1].toLowerCase() as (typeof PATHS)[number]) } : undefined;
    });
    if (answers.length === 3 && answers.every((a) => a && a.text)) {
      questions.push({ text: tidy(question.text.join(' ')), answers: answers as Answer[] });
    }
    question = undefined;
  };
  for (const line of text.split(/\r?\n|\r/)) {
    const start = /^\s*\d+\.\s+(.*)$/.exec(line);
    const answer = /^\s*([abc])\)\s*(.*)$/i.exec(line);
    if (start) {
      finish();
      question = { text: [start[1]], answers: [] };
      part = question.text;
    } else if (answer && question) {
      part = [answer[2]];
      question.answers.push(part);
    } else if (part && line.trim()) part.push(line);
  }
  finish();
  return questions;
}

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Which class a tally of answers leads to: counts of warrior, thief and mage answers. */
export type ClassChooser = (counts: readonly number[]) => number | undefined;

/** Reads CLASSES.DAT. */
export function parseClassAnswers(data: Uint8Array): ClassChooser {
  if (data.length !== 216) throw new Error(`CLASSES.DAT: unexpected size ${data.length}`);
  const classes = [...data.subarray(0, 18)].map((b) => b & 0x1f);
  const table = new Map<string, number>();
  for (let i = 0; i < 66; i++) {
    const counts = [...data.subarray(18 + i * 3, 21 + i * 3)];
    if (counts.reduce((a, b) => a + b, 0) !== 10) throw new Error('CLASSES.DAT: a tally does not add up to ten');
    table.set(counts.join(','), classes[i < 48 ? i >> 2 : 12 + Math.floor((i - 48) / 3)]);
  }
  return (counts) => table.get(counts.join(','));
}

/** Reads NAMECHNK.DAT into its groups of name pieces. */
export function parseNameChunks(data: Uint8Array): string[][] {
  const groups: string[][] = [];
  for (let p = 0; p + 3 <= data.length; ) {
    const length = data[p] | (data[p + 1] << 8);
    if (length < 3 || p + length > data.length) throw new Error('NAMECHNK.DAT: a group runs past the end of the file');
    const pieces: string[] = [];
    let s = '';
    for (let q = p + 3; q < p + length && pieces.length < data[p + 2]; q++) {
      if (data[q] === 0) {
        pieces.push(s);
        s = '';
      } else s += String.fromCharCode(data[q]);
    }
    groups.push(pieces);
    p += length;
  }
  return groups;
}
