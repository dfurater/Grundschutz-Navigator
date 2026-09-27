/**
 * Routenkennung eines Vokabulars aus seinem Upstream-Pfad.
 *
 * Einzige Quelle dieser Ableitung. Sie steht in einem reinen ESM-Modul, weil
 * die Pipeline (`scripts/vocabulary-utils.mjs`) sie in einer nackten
 * Node-Laufzeit braucht und die Testfixtures unter `src/test/fixtures/` die
 * Kennungen genauso bilden müssen: Eine abgeschriebene Kennung bestätigte nach
 * einer Pfadmigration weiter einen Slug, den es produktiv nicht mehr gibt.
 * Gleiches Muster wie `sourceRegistry.mjs` und `class2ImportLimits.mjs`.
 */

function trimTrailingDashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '-') {
    end -= 1;
  }
  return value.slice(0, end);
}

// Verschiedene Dateinamen können auf dieselbe routeId fallen (`a_b.csv`,
// `a-b.csv`). Fetch und Build prüfen das nicht; erst buildVocabularyRegistry in
// src/domain/vocabulary.ts wirft zur Laufzeit.
export function deriveRouteId(path) {
  const withoutLeadingSeparators = path
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '');

  return trimTrailingDashes(withoutLeadingSeparators);
}
