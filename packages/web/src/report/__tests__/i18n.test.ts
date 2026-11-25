/**
 * The report face speaks cs, en and sk (vt-3811): a Slovak host or browser gets
 * the Slovak catalog, every catalog carries every string, and Slovak plurals
 * take the 1 · 2–4 · 5+ forms.
 */
import { describe, expect, it } from 'bun:test';

import { parseLocale, strings } from '../i18n';

describe('locales', () => {
  it('parses Slovak like the others', () => {
    expect([parseLocale('sk'), parseLocale('sk-SK'), parseLocale('SK_sk'), parseLocale('cs-CZ'), parseLocale('en-GB'), parseLocale('de')]).toEqual([
      'sk',
      'sk',
      'sk',
      'cs',
      'en',
      null,
    ]);
  });

  it('gives every locale the same strings, none empty', () => {
    const keys = (l: 'cs' | 'en' | 'sk') => Object.keys(strings(l)).sort();
    expect(keys('sk')).toEqual(keys('cs'));
    expect(keys('sk')).toEqual(keys('en'));
    for (const [k, v] of Object.entries(strings('sk'))) {
      if (typeof v === 'string') expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });

  it('speaks Slovak, with Slovak plurals', () => {
    const sk = strings('sk');
    expect(sk.button).toBe('Nahlásiť problém');
    expect([sk.windowLength(1), sk.windowLength(3), sk.windowLength(30), sk.windowLength(300)]).toEqual(['1 sekunda', '3 sekundy', '30 sekúnd', '5 minút']);
    expect(sk.discardMarks(2)).toBe('Zahodiť 2 značky?');
  });
});
