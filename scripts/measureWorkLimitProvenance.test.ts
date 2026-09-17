// =============================================================================
// Die Provenienz der Arbeitsgrenze (GSPP-345). Der Fingerprint entscheidet, ob
// ein committetes Messartefakt den gelieferten Grenzwert noch trägt — eine zu
// enge Hülle macht diese Prüfung still wertlos.
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  WORK_LIMIT_ENTRY_POINTS,
  PROVENANCE_EXCLUDED_PATHS,
  byCodeUnit,
  collectWorkLimitSources,
  runtimeImportSpecifiers,
  workLimitProvenance,
} from './measureWorkLimitProvenance.mjs';

describe('collectWorkLimitSources', () => {
  const { paths: sources, packages } = collectWorkLimitSources();

  it('erfasst den gesamten Auflösungspfad, nicht nur die Einstiegspunkte', () => {
    // Die Hülle wird aus den ECHTEN Importen berechnet. Diese Module tauchen in
    // keinem Einstiegspunkt namentlich auf und sind trotzdem der Code, dessen
    // Kosten gemessen werden — genau deshalb reicht eine handgeschriebene
    // Liste nicht.
    for (const path of [
      'src/domain/profileResolutionMerge.ts',
      'src/domain/profileResolutionModify.ts',
      'src/domain/oscalObjectGraph.ts',
      'src/domain/class2ImportLimits.mjs',
    ]) {
      expect(sources).toContain(path);
    }
  });

  it('enthält jeden Einstiegspunkt selbst', () => {
    for (const entry of WORK_LIMIT_ENTRY_POINTS) expect(sources).toContain(entry);
  });

  it('lässt den Grenzwertkandidaten aus', () => {
    // Diese Datei MUSS zwischen Mess- und Lieferstand verschieden sein. Läge
    // sie in der Hülle, könnte kein Artefakt je zum gelieferten Stand passen.
    for (const path of PROVENANCE_EXCLUDED_PATHS) expect(sources).not.toContain(path);
  });

  it('trennt externe Pakete von Repository-Dateien', () => {
    for (const path of sources) expect(path.startsWith('node_modules/')).toBe(false);
    // Der gemessene Lauf führt vor dem Ergebnis die Schemaprüfung aus. Würde
    // diese Bibliothek langsamer, müsste das Gate das sehen.
    expect(packages).toContain('ajv');
  });

  it('lässt die Auswertung außen vor — sie ist schärfer gebunden als durch einen Hash', () => {
    // Der Bindungstest leitet den Grenzwert bei jedem Lauf mit der AKTUELLEN
    // Auswertung aus dem Artefakt neu her. Sie zusätzlich zu fingerprinten
    // erzwänge einen Browsermesslauf für eine Änderung, die an den Rohdaten
    // nichts ändert.
    expect(sources).not.toContain('scripts/measureClass2BudgetReport.mjs');
  });

  it('ist sortiert und doppelfrei, damit der Fingerprint nicht an der Reihenfolge hängt', () => {
    expect(sources).toEqual([...new Set(sources)].sort());
  });

  it('bricht bei einem fehlenden Einstiegspunkt ab, statt eine leere Hülle zu liefern', () => {
    expect(() => collectWorkLimitSources(['src/domain/gibtEsNicht.ts']))
      .toThrow(/Einstiegspunkt des Messwegs fehlt/);
  });

  it('folgt keiner Kante, die ausschließlich einen Typ transportiert', () => {
    // `src/domain/models.ts` wird aus dem Auflösungspfad ZEHNMAL erreicht, und
    // jedes Mal über ein `import type`. TypeScript löscht diese Importe beim
    // Kompilieren: Die Datei läuft im gemessenen Lauf gar nicht mit und kann
    // seine Dauer nicht beeinflussen. Läge sie trotzdem in der Hülle, erzwänge
    // schon eine geänderte Kommentarzeile einen Browsermesslauf, der nichts
    // belegt — genau die Begründung, mit der oben auch die übrigen
    // Harnisch-Importe ausgeschlossen sind.
    expect(sources).not.toContain('src/domain/models.ts');
    // Kaskade: Die einzige Kante nach `catalogLineage.ts` ist ein `import type`
    // aus `models.ts`. Fällt die Quelle, fällt auch das Ziel — und mit ihm die
    // `.mjs`, die nur von dort re-exportiert wird.
    expect(sources).not.toContain('src/domain/catalogLineage.ts');
    expect(sources).not.toContain('src/domain/catalogLineage.mjs');
  });

  it('hält jede Datei, zu der mindestens eine Wertkante führt', () => {
    // Der Gegentest zur Verengung: `oscalProfileAdapter.ts` trägt sowohl
    // `export type * from '@/domain/profileModel'` als auch zwei
    // `export { … } from '@/domain/profileModel'`. Ein Ausschluss, der nur die
    // Typform sieht und die Wertform derselben Datei übergeht, nähme dem Gate
    // echten Laufzeitcode.
    expect(sources).toContain('src/domain/profileModel.ts');
    // `oscalRootDocument.ts` zeigt die Gegenrichtung: Sie verliert ihre eigenen
    // Typkanten, bleibt aber selbst drin, weil sie über eine Wertkante
    // erreicht wird.
    expect(sources).toContain('src/domain/oscalRootDocument.ts');
  });
});

describe('runtimeImportSpecifiers', () => {
  // Die Hülle folgt genau diesen Spezifizierern. Getestet wird hier die
  // Erkennung selbst, an Quelltext statt an Dateien auf der Platte — sonst
  // prüfte der Test nur den heutigen Zustand des Repositoriums mit.

  it('lässt eine reine Typkante aus, in jeder ihrer Schreibweisen', () => {
    expect(runtimeImportSpecifiers("import type { A } from './a';")).toEqual([]);
    expect(runtimeImportSpecifiers("import type A from './a';")).toEqual([]);
    expect(runtimeImportSpecifiers("export type { A } from './a';")).toEqual([]);
    expect(runtimeImportSpecifiers("export type * from './a';")).toEqual([]);
    expect(runtimeImportSpecifiers("export type * as A from './a';")).toEqual([]);
  });

  it('lässt eine mehrzeilige Typkante aus', () => {
    // Die `from`-Form deckt mehrzeilige Listen ab, weil sie am `from` ansetzt.
    // Die Typerkennung muss dasselbe können, sonst bliebe ausgerechnet der
    // häufigste Fall langer Typimporte unerkannt.
    const source = ['import type {', '  A,', '  B,', "} from './a';"].join('\n');
    expect(runtimeImportSpecifiers(source)).toEqual([]);
  });

  it('hält die Mischform, die neben Typen auch einen Wert einführt', () => {
    expect(runtimeImportSpecifiers("import { type A, b } from './a';")).toEqual(['./a']);
    expect(runtimeImportSpecifiers("export { type A, b } from './a';")).toEqual(['./a']);
  });

  it('hält ein Ziel, das dieselbe Datei anderswo als Wert importiert', () => {
    // Zwei getrennte Anweisungen auf dasselbe Ziel: Die eine trägt nur Typen,
    // die andere einen Wert. Gezählt wird deshalb je Vorkommen, nicht je Ziel.
    const source = ["import type { A } from './a';", "import { b } from './a';"].join('\n');
    expect(runtimeImportSpecifiers(source)).toEqual(['./a']);
  });

  it('hält ein seitenwirksames und ein dynamisches Import desselben Ziels', () => {
    // Beide Formen können gar keine Typangabe tragen — sie laufen immer mit,
    // auch wenn dasselbe Ziel daneben als Typ importiert wird.
    expect(runtimeImportSpecifiers("import type { A } from './a';\nimport './a';"))
      .toEqual(['./a']);
    expect(runtimeImportSpecifiers("import type { A } from './a';\nawait import('./a');"))
      .toEqual(['./a']);
  });

  it('hält eine Kante, die es nicht zweifelsfrei als Typkante einordnen kann', () => {
    // FAIL-CLOSED. Die Textsuche ist ausdrücklich kein Parser: Sie darf keine
    // Datei ÜBERSEHEN. Wo die Erkennung unsicher ist, bleibt die Kante stehen
    // und kostet höchstens einen zu breiten Fingerprint — der umgekehrte
    // Fehler machte das Gate still wertlos.
    expect(runtimeImportSpecifiers("import /* c */ type { A } from './a';")).toEqual(['./a']);
    expect(runtimeImportSpecifiers("import type { A: { B } } from './a';")).toEqual(['./a']);
    expect(runtimeImportSpecifiers("const type = 1; import { a } from './a';")).toEqual(['./a']);
    // `typeA` ist ein Bezeichner dieses Namens, kein Typimport — vor einem
    // Bezeichner trägt erst das Trennzeichen die Grenze.
    expect(runtimeImportSpecifiers("import typeA from './a';")).toEqual(['./a']);
  });

  it('erkennt die kompakte Schreibweise, wo die Grenze ohne Leerraum eindeutig ist', () => {
    // `{` und `*` können kein Bezeichnerzeichen sein. Diese Formen sind
    // zweifelsfrei Typkanten, auch ohne Leerraum nach `type`.
    expect(runtimeImportSpecifiers("import type{A}from'./a';")).toEqual([]);
    expect(runtimeImportSpecifiers("export type*from'./a';")).toEqual([]);
  });

  it('hält gewöhnliche Wertkanten unverändert', () => {
    expect(runtimeImportSpecifiers("import { a } from './a';")).toEqual(['./a']);
    expect(runtimeImportSpecifiers("import a from './a';")).toEqual(['./a']);
    expect(runtimeImportSpecifiers("export * from './a';")).toEqual(['./a']);
    expect(runtimeImportSpecifiers("export { a } from './a';")).toEqual(['./a']);
  });
});

describe('byCodeUnit', () => {
  // Genau der Fall, an dem die beiden Ordnungen im echten Baum auseinanderlaufen:
  // `I` steht als Code-Unit vor `i`, in jeder Locale-Kollation aber dahinter.
  const paths = [
    'src/components/Input.tsx',
    'src/components/icons.test.tsx',
    'src/components/Badge.tsx',
  ];

  // Der Comparator wird direkt aufgerufen, nicht nur über `.sort()` gereicht.
  // `Array.prototype.sort(undefined)` fällt auf die Default-Vergleichsfunktion
  // zurück, und die ist für Strings ihrerseits Code-Unit-Ordnung: Ein Test, der
  // nur sortiert, bliebe grün, wenn der Export wieder verschwände, und pinnte
  // damit nichts.
  it('ist eine echte Vergleichsfunktion und kein weggefallener Export', () => {
    expect(typeof byCodeUnit).toBe('function');
    expect(byCodeUnit('src/components/Input.tsx', 'src/components/icons.test.tsx')).toBeLessThan(0);
    expect(byCodeUnit('src/components/icons.test.tsx', 'src/components/Input.tsx')).toBeGreaterThan(0);
    expect(byCodeUnit('src/components/Input.tsx', 'src/components/Input.tsx')).toBe(0);
  });

  it('ordnet über UTF-16-Code-Units, nicht über die Kollation einer Locale', () => {
    expect([...paths].sort(byCodeUnit)).toEqual([
      'src/components/Badge.tsx',
      'src/components/Input.tsx',
      'src/components/icons.test.tsx',
    ]);
  });

  it('weicht an dieser Eingabe nachweislich von `localeCompare` ab', () => {
    // Die Locale ist gepinnt, damit der Nachweis nicht an der Umgebung des
    // Testläufers hängt. Der Test hält damit fest, was der Kommentar an der
    // Definition bisher nur behauptet: Ein Umbau auf `localeCompare` — etwa
    // auf Zuruf einer Werkzeugmeldung — ändert die Reihenfolge und damit
    // jeden Fingerprint, der auf ihr steht.
    expect([...paths].sort((left, right) => left.localeCompare(right, 'en')))
      .not.toEqual([...paths].sort(byCodeUnit));
  });
});

describe('workLimitProvenance', () => {
  it('liefert einen stabilen Fingerprint über die gezählte Hülle', () => {
    const first = workLimitProvenance();
    const second = workLimitProvenance();
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sha256).toBe(second.sha256);
    expect(first.files).toBe(first.paths.length);
    expect(first.files).toBeGreaterThan(WORK_LIMIT_ENTRY_POINTS.length);
  });

  it('nennt die aufgelösten Laufzeitversionen, nicht nur die Paketnamen', () => {
    const runtime = workLimitProvenance().runtime;
    expect(runtime.some((entry) => /^ajv@\d+\.\d+\.\d+/.test(entry))).toBe(true);
    // Transitiv: Ajv bringt eigene Abhängigkeiten mit, und auch deren Laufzeit
    // läuft im gemessenen Pfad mit.
    expect(runtime.length).toBeGreaterThan(1);
  });
});
