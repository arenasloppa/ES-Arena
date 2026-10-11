/**
 * Arena's calendar, read from the unpacked program (see pklite.ts): the
 * months and weekdays, the day endings and the words for the time of day,
 * and the formats the game writes dates and times in. Found by their text so
 * the reader works on the CD and floppy programs alike. How the game counts
 * (minutes since the start of 3E 389; months of the lengths the program
 * lists; the weekday from the day of the month) is the OpenTESArena wiki's
 * reading of the program.
 */
import { cString } from './cstrings';

export interface Calendar {
  months: string[];
  /** Minutes in each month. */
  monthMinutes: number[];
  weekdays: string[];
  /** "st", "nd", "rd", "th". */
  suffixes: string[];
  /** "early morning", "in the morning", "noon", "in the afternoon", "in the evening", "at night", "midnight". */
  periods: string[];
  /** "%s, %u%s of %s in the year 3E %d": weekday, day, ending, month, year. */
  dateFormat: string;
}

/** The game's starting time: noon on the 1st of the ninth month, 3E 389 (the wiki's reading of the program). */
export const START_MINUTES = 346320;
const FIRST_YEAR = 389;

/** The remake's own calendar, for when the game's can't be read: plain words, months of 30 days. */
export const FALLBACK_CALENDAR: Calendar = {
  months: Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`),
  monthMinutes: new Array(12).fill(30 * 1440),
  weekdays: Array.from({ length: 7 }, (_, i) => `Day ${i + 1}`),
  suffixes: ['st', 'nd', 'rd', 'th'],
  periods: ['early morning', 'in the morning', 'noon', 'in the afternoon', 'in the evening', 'at night', 'midnight'],
  dateFormat: '%s, %u%s of %s in the year 3E %d',
};

function indexOf(image: Uint8Array, text: string, from = 0): number {
  const first = text.charCodeAt(0);
  outer: for (let i = image.indexOf(first, from); i !== -1; i = image.indexOf(first, i + 1)) {
    for (let k = 1; k < text.length; k++) if (image[i + k] !== text.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

function strings(image: Uint8Array, at: number, count: number): string[] {
  const out: string[] = [];
  for (let p = at; out.length < count; ) {
    const s = cString(image, p);
    out.push(s);
    p += s.length + 1;
  }
  return out;
}

export function readCalendar(image: Uint8Array): Calendar | undefined {
  const monthsAt = indexOf(image, 'Morning Star\0');
  const weekdaysAt = indexOf(image, 'Morndas\0');
  const suffixesAt = indexOf(image, 'st\0nd\0rd\0th\0');
  const periodsAt = indexOf(image, 'early morning\0');
  const formatAt = indexOf(image, ' in the year ');
  if ([monthsAt, weekdaysAt, suffixesAt, periodsAt, formatAt].some((p) => p < 0)) return undefined;
  let formatStart = formatAt;
  while (formatStart > 0 && image[formatStart - 1] !== 0) formatStart--;
  // The months' lengths follow the time words, as 12 32-bit counts of minutes.
  const periods = strings(image, periodsAt, 7);
  let p = periodsAt;
  for (const s of periods) p += s.length + 1;
  p += cString(image, p).length + 1;
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const monthMinutes = Array.from({ length: 12 }, (_, i) => (p + i * 4 + 4 <= image.length ? view.getUint32(p + i * 4, true) : 0));
  const calendar: Calendar = {
    months: strings(image, monthsAt, 12),
    monthMinutes: monthMinutes.every((m) => m >= 20 * 1440 && m <= 40 * 1440) ? monthMinutes : FALLBACK_CALENDAR.monthMinutes,
    weekdays: strings(image, weekdaysAt, 7),
    suffixes: strings(image, suffixesAt, 4),
    periods,
    dateFormat: cString(image, formatStart).replace(/\s+$/, ''),
  };
  return /%s.*%u.*%s.*%s.*%d/.test(calendar.dateFormat) ? calendar : undefined;
}

/** "Tirdas, 1st of Hearthfire in the year 3E 389" for a count of game minutes. */
export function formatDate(minutes: number, cal: Calendar = FALLBACK_CALENDAR): string {
  const yearMinutes = cal.monthMinutes.reduce((a, b) => a + b, 0);
  const year = FIRST_YEAR + Math.floor(minutes / yearMinutes);
  let into = minutes % yearMinutes;
  let month = 0;
  while (month < 11 && into >= cal.monthMinutes[month]) into -= cal.monthMinutes[month++];
  const day = Math.floor(into / 1440) + 1;
  // As the program does: "th" for the teens, else by the last digit (1st, 2nd, 3rd, the rest "th").
  const last = day % 10;
  const suffix = day >= 11 && day <= 13 ? cal.suffixes[3] : cal.suffixes[last >= 1 && last <= 3 ? last - 1 : 3];
  const parts = [cal.weekdays[day % 7], String(day), suffix, cal.months[month], String(year)];
  let i = 0;
  return cal.dateFormat.replace(/%[sud]/g, () => parts[i++] ?? '');
}

/** "12:00 noon": the hour out of 12, and the game's word for the time of day. */
export function formatTime(minutes: number, cal: Calendar = FALLBACK_CALENDAR): string {
  const ofDay = minutes % 1440;
  const hour = Math.floor(ofDay / 60);
  const minute = ofDay % 60;
  const [early, morning, noon, afternoon, evening, night, midnight] = cal.periods;
  const period =
    hour === 0 ? midnight : hour <= 2 ? night : hour <= 5 ? early : hour <= 11 ? morning : hour === 12 ? noon : hour <= 17 ? afternoon : hour <= 20 ? evening : night;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, '0')} ${period}`;
}
