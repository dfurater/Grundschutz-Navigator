/** Deterministische UUIDs für synthetische Fixtures (Version 4, Variante 8). */
export function makeUuid(seed: string, index: number): string {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}
