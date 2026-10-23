import { describe, expect, it } from 'vitest';
import { latestSavedAt, relativeTime } from '@/features/workspace/StationCards';

const NOW = Date.parse('2026-10-23T12:00:00Z');

describe('relativeTime', () => {
  it.each([
    ['2026-10-23T11:59:30Z', 'gerade eben'],
    ['2026-10-23T12:00:05Z', 'gerade eben'],
    ['2026-10-23T11:58:00Z', 'vor 2 Minuten'],
    ['2026-10-23T09:00:00Z', 'vor 3 Stunden'],
    ['2026-10-20T12:00:00Z', 'vor 3 Tagen'],
  ])('%s → %s', (iso, expected) => expect(relativeTime(iso, NOW)).toBe(expected));

  it('liefert ohne lesbaren Zeitpunkt nichts', () => {
    expect(relativeTime(undefined, NOW)).toBeUndefined();
    expect(relativeTime('kein Datum', NOW)).toBeUndefined();
  });
});

it('latestSavedAt wählt den jüngsten Zeitpunkt, unabhängig vom Zeitzonenformat', () => {
  expect(latestSavedAt(['2026-10-23T10:00:00+02:00', '2026-10-23T09:00:00Z', '2026-10-23T08:30:00Z'])).toBe('2026-10-23T09:00:00Z');
  expect(latestSavedAt([])).toBeUndefined();
});
