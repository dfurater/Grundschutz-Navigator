import { expect, test } from 'vitest';

test('läuft in Chromium', () => {
  expect(navigator.userAgent).toContain('Chrome');
});
