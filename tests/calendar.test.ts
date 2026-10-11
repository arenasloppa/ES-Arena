import { describe, expect, it } from 'vitest';
import { formatDate, formatTime, readCalendar, START_MINUTES, type Calendar } from '../src/formats/calendar';

/** Made-up words in the game's layout; none of them are the game's. */
const CAL: Calendar = {
  months: Array.from({ length: 12 }, (_, i) => `Moon${i}`),
  monthMinutes: new Array(12).fill(30 * 1440),
  weekdays: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
  suffixes: ['st', 'nd', 'rd', 'th'],
  periods: ['early', 'morning', 'noon', 'afternoon', 'evening', 'night', 'midnight'],
  dateFormat: '%s, %u%s of %s in the year 3E %d',
};

describe('the calendar', () => {
  it('starts at noon on the 1st of the ninth month of 389, and names the weekday by the day of the month', () => {
    expect(formatDate(START_MINUTES, CAL)).toBe('D1, 1st of Moon8 in the year 3E 389');
    expect(formatTime(START_MINUTES, CAL)).toBe('12:00 noon');
    expect(formatDate(START_MINUTES + 1440 * 21, CAL)).toBe('D1, 22nd of Moon8 in the year 3E 389');
    expect(formatDate(START_MINUTES + 1440 * 10, CAL)).toBe('D4, 11th of Moon8 in the year 3E 389');
    expect(formatDate(START_MINUTES + 1440 * 120, CAL)).toBe('D1, 1st of Moon0 in the year 3E 390');
  });

  it('tells the time out of 12 with the game’s word for the part of the day', () => {
    const at = (h: number, m = 0) => formatTime(h * 60 + m, CAL);
    expect([at(0), at(2, 5), at(4), at(9, 30), at(13), at(19), at(23)]).toEqual([
      '12:00 midnight',
      '2:05 night',
      '4:00 early',
      '9:30 morning',
      '1:00 afternoon',
      '7:00 evening',
      '11:00 night',
    ]);
  });

  it('reads the words and month lengths from a program laid out like the game’s', () => {
    const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const months = CAL.months.map((m) => m.replace('Moon0', 'Morning Star')).join('\0') + '\0';
    const bytes = [
      ...text(months),
      ...text('Morndas\0D1\0D2\0D3\0D4\0D5\0D6\0'),
      ...text('st\0nd\0rd\0th\0'),
      ...text('%s, %u%s of %s in the year 3E %d\r\0'),
      ...text('early morning\0a\0b\0c\0d\0e\0f\0pointer1.dat\0'),
      ...new Array(12).fill([0xc0, 0xa8, 0, 0]).flat(),
    ];
    const cal = readCalendar(new Uint8Array(bytes))!;
    expect(cal.months[0]).toBe('Morning Star');
    expect(cal.weekdays).toEqual(['Morndas', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
    expect(cal.periods[0]).toBe('early morning');
    expect(cal.monthMinutes).toEqual(new Array(12).fill(43200));
    expect(cal.dateFormat).toBe('%s, %u%s of %s in the year 3E %d');
    expect(readCalendar(new Uint8Array(10))).toBeUndefined();
  });
});
