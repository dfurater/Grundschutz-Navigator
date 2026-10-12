import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPACT_QUERY, DESKTOP_QUERY, OWN_SCROLL_AREA_QUERY } from './breakpointQueries';

const SRC = resolve(import.meta.dirname, '..');
const INDEX_CSS = readFileSync(join(SRC, 'index.css'), 'utf8');

/** Quelldateien mit Klassen; Tests und Fixtures bleiben außen vor. */
function classSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : classSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('breakpointQueries', () => {
  it('stellt den Desktop über Breite und fehlendes Touch als Eingabemöglichkeit fest', () => {
    expect(DESKTOP_QUERY).toBe('(width >= 64rem) and (not (any-pointer: coarse))');
  });

  it('verlegt den eigenen Scrollbereich auf die Tablet-Breite des iPad mini im Hochformat', () => {
    expect(OWN_SCROLL_AREA_QUERY).toBe('(width >= 46.5rem)');
    expect(INDEX_CSS).toContain('--breakpoint-md: 46.5rem;');
  });

  it('negiert den Desktop für CSS', () => {
    expect(COMPACT_QUERY).toBe(`not (${DESKTOP_QUERY})`);
  });

  it('trägt die Bedingungen in index.css wortgleich', () => {
    // Variante `desktop`, Variante `compact` und Schubladenblock stehen in `index.css`.
    expect(INDEX_CSS).toContain(`@custom-variant desktop (@media ${DESKTOP_QUERY});`);
    expect(INDEX_CSS).toContain(`@custom-variant compact (@media ${COMPACT_QUERY});`);
    expect(INDEX_CSS).toContain(`  @media ${COMPACT_QUERY} {\n    /* Die verschobene Seite`);
  });

  it('drückt den Desktop-Zustand in Klassen nur über `desktop:` und `compact:` aus', () => {
    // `lg:` bliebe bei Touch-Geräten mit Desktop-Breite auf dem Desktop-Zweig,
    // obwohl die Komponenten dort den Tablet-Teilbaum mounten. Ausnahmen sind
    // rein breitenabhängig: Tastenkürzel-Hinweise der Suche und Überschriftengröße.
    const allowed = new Map([
      ['components/HeaderBar.tsx', 3],
    ]);
    const offenders = classSources(SRC).flatMap((path) => {
      const name = relative(SRC, path);
      const count = (readFileSync(path, 'utf8').match(/(?<![\w-])(?:max-)?lg:(?=[\w[!-])/g) ?? []).length;
      return count === (allowed.get(name) ?? 0) ? [] : [`${name}: ${count}`];
    });
    expect(offenders).toEqual([]);
    expect(INDEX_CSS.match(/(?<![\w-])lg:(?=[\w[!-])/g)).toHaveLength(1);
  });
});
