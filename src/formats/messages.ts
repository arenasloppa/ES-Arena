/**
 * The game's own messages, read from the unpacked program (see pklite.ts) so
 * the remake says what Arena says: drowning, dropping from exhaustion,
 * camping and the like. Each is found by a piece of its text, so the same
 * reader works on the CD and floppy programs; one that isn't found is left
 * out and the caller says something plainer. Their meanings are as
 * OpenTESArena's exe string lists name them ([Camping], [Status]).
 *
 * Arena's texts mark line breaks with \r and its menu entries' hot keys
 * with tab-delimited colour codes; both are cleaned up here.
 */
import { cString } from './cstrings';

export interface GameMessages {
  /** "Fatigue overcomes you and sends you to a watery grave...." */
  drowning?: string;
  /** "You are so fatigued that you simply drop where you stand. One hour later...." */
  exhaustedRecover?: string;
  /** "You drop from exhaustion and quickly fall prey to monsters...." */
  exhaustedDeath?: string;
  /** "How many hours do you wish to rest?" */
  hoursToRest?: string;
  /** "Camp for a while..." and "Until fully healed": the two ways to rest. */
  restForHours?: string;
  restUntilHealed?: string;
  /** "You are healed..." */
  doneHealed?: string;
  /** "You wake up..." */
  doneWakeUp?: string;
  /** "Your time is up..." */
  doneTimesUp?: string;
  /** "You can't camp. Enemies are nearby!!!" */
  enemiesNearby?: string;
  /** "There are enemies nearby..." */
  enemiesWhileResting?: string;
  /** "You don't need to rest." */
  fullyRested?: string;
  /** "You can't camp here." */
  campingNotAllowed?: string;
}

/** A piece of each message's text to find it by. */
const KEYS: Record<keyof GameMessages, string> = {
  drowning: 'watery grave',
  exhaustedRecover: 'simply drop where you stand',
  exhaustedDeath: 'quickly fall prey to monsters',
  hoursToRest: 'How many hours do you wish to rest',
  restForHours: 'amp for a while',
  restUntilHealed: 'ntil fully',
  doneHealed: 'You are healed',
  doneWakeUp: 'You wake up',
  doneTimesUp: 'Your time is up',
  enemiesNearby: "You can't camp. Enemies",
  enemiesWhileResting: 'There are enemies nearby',
  fullyRested: "You don't need to rest",
  campingNotAllowed: "You can't camp here",
};

export function readMessages(image: Uint8Array): GameMessages {
  const out: GameMessages = {};
  for (const [key, piece] of Object.entries(KEYS) as Array<[keyof GameMessages, string]>) {
    const at = indexOf(image, piece);
    if (at < 0) continue;
    let start = at;
    while (start > 0 && image[start - 1] !== 0 && at - start < 200) start--;
    out[key] = clean(cString(image, start));
  }
  return out;
}

/** Turns Arena's \r line breaks into spaces and drops its colour codes (a tab, a byte, ... a tab, a byte). */
export function clean(text: string): string {
  return text
    .replace(/\t./g, '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function indexOf(image: Uint8Array, text: string): number {
  const first = text.charCodeAt(0);
  outer: for (let i = image.indexOf(first); i !== -1; i = image.indexOf(first, i + 1)) {
    for (let k = 1; k < text.length; k++) if (image[i + k] !== text.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}
