import { describe, expect, it } from 'vitest';
import { isPlaceholderNamespace } from './placeholderNamespace';

describe('isPlaceholderNamespace', () => {
  it('erkennt den heutigen BSI-Platzhalter der WLAN-Taxonomie', () => {
    expect(isPlaceholderNamespace('https://bsi.bund.de/ns/sdt/custom-properties/placeholder')).toBe(true);
    expect(isPlaceholderNamespace('https://bsi.bund.de/ns/sdt/custom-properties/placeholder/')).toBe(true);
  });

  it('lässt einen ausgetauschten, echten Namensraum sichtbar', () => {
    expect(isPlaceholderNamespace('https://bsi.bund.de/ns/sdt/custom-properties/wlan-taxonomy')).toBe(false);
    expect(isPlaceholderNamespace('https://bsi.bund.de/ns/placeholder/taxonomy')).toBe(false);
  });

  it('wertet fehlende oder nicht lesbare Angaben nicht als Platzhalter', () => {
    expect(isPlaceholderNamespace(undefined)).toBe(false);
    expect(isPlaceholderNamespace('')).toBe(false);
    expect(isPlaceholderNamespace('placeholder')).toBe(false);
  });
});
