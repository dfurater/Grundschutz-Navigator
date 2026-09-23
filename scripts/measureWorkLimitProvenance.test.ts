// =============================================================================
// Die Provenienz der Arbeitsgrenze (GSPP-345, Hülle seit GSPP-445). Der
// Fingerprint entscheidet, ob ein committetes Messartefakt den gelieferten
// Grenzwert noch trägt — eine zu enge Hülle macht diese Prüfung still wertlos,
// eine zu weite erzwingt Browsermessläufe, die nichts belegen.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PROVENANCE_EXCLUDED_PATHS,
  SPEND_WORK,
  WORK_LIMIT_PROVENANCE_METHOD,
  byCodeUnit,
  deriveScalingHull,
  fingerprintHull,
  normalizeSource,
  workLimitProvenance,
} from './measureWorkLimitProvenance.mjs';
import { WORK_UNIT_CATEGORIES } from './profileResolutionWorstCaseFixtures.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const fileUrl = (path: string) => pathToFileURL(resolve(REPO_ROOT, path)).href;

type Call = [string, string, number, number];
type Run = { workUnits: number; calls: Call[] };

const BUDGET = fileUrl(SPEND_WORK.path);
const ENGINE = fileUrl('src/domain/profileResolutionEngine.ts');

/**
 * Eine Zählung, wie sie `measureWorkLimitCallCounts.mjs` liefert: `spendWork`
 * wächst mit den Wiederholungen, `resolveProfile` läuft je Lauf einmal.
 */
function observation(
  adjust: (category: string, runs: { n: Run; twoN: Run }) => void = () => {},
) {
  return {
    repetitions: { n: 4, twoN: 8 },
    categories: WORK_UNIT_CATEGORIES.map((category: string) => {
      const runs = {
        n: { workUnits: 40, calls: [[BUDGET, 'spendWork', 100, 40], [ENGINE, 'resolveProfile', 0, 1]] as Call[] },
        twoN: { workUnits: 80, calls: [[BUDGET, 'spendWork', 100, 80], [ENGINE, 'resolveProfile', 0, 1]] as Call[] },
      };
      adjust(category, runs);
      return { category, ...runs };
    }),
  };
}

describe('deriveScalingHull', () => {
  it('nimmt nur Dateien mit wachsender Aufrufzahl auf', () => {
    // `resolveProfile` läuft bei N und 2N je einmal — genau der Code mit
    // konstanter Aufrufzahl, den die frühere Importhülle mitfingerprintete.
    expect(deriveScalingHull(observation())).toEqual({ paths: [SPEND_WORK.path], packages: [] });
  });

  it('lässt eine Funktion zählen, die nur in einer Kategorie wächst', () => {
    const merge = fileUrl('src/domain/profileResolutionMerge.ts');
    const hull = deriveScalingHull(observation((category, { n, twoN }) => {
      n.calls.push([merge, 'mergeStep', 7, 3]);
      twoN.calls.push([merge, 'mergeStep', 7, category === 'merge-step' ? 6 : 3]);
    }));
    expect(hull.paths).toEqual([SPEND_WORK.path, 'src/domain/profileResolutionMerge.ts']);
  });

  it('wertet eine Funktion, die erst bei 2N läuft, als skalierend', () => {
    const modify = fileUrl('src/domain/profileResolutionModify.ts');
    const hull = deriveScalingHull(observation((category, { twoN }) => {
      if (category === 'alter-candidate') twoN.calls.push([modify, 'alterCandidate', 9, 1]);
    }));
    expect(hull.paths).toContain('src/domain/profileResolutionModify.ts');
  });

  it('wertet eine Funktion, die bei 2N seltener läuft, nicht als skalierend', () => {
    // Eine einmalige Initialisierung im ersten Lauf (etwa ein Schemacache)
    // lässt die Zahl bei 2N fallen, nicht steigen.
    const schema = fileUrl('src/domain/oscalSchemaValidation.ts');
    const hull = deriveScalingHull(observation((category, { n }) => {
      if (category === WORK_UNIT_CATEGORIES[0]) n.calls.push([schema, 'compile', 3, 1]);
    }));
    expect(hull.paths).not.toContain('src/domain/oscalSchemaValidation.ts');
  });

  it('unterscheidet gleichnamige Funktionen an ihrer Position', () => {
    const selection = fileUrl('src/domain/profileResolutionSelection.ts');
    const hull = deriveScalingHull(observation((_category, { n, twoN }) => {
      n.calls.push([selection, '', 10, 5], [selection, '', 50, 1]);
      twoN.calls.push([selection, '', 10, 5], [selection, '', 50, 2]);
    }));
    expect(hull.paths).toContain('src/domain/profileResolutionSelection.ts');
  });

  it('ordnet Bibliothekscode seinem Paket zu, nicht als Repository-Datei', () => {
    const hull = deriveScalingHull(observation((_category, { n, twoN }) => {
      n.calls.push([fileUrl('node_modules/ajv/dist/compile/index.js'), 'validate', 0, 1]);
      twoN.calls.push([fileUrl('node_modules/ajv/dist/compile/index.js'), 'validate', 0, 2]);
      n.calls.push([fileUrl('node_modules/@scope/paket/lib/x.js'), 'f', 0, 1]);
      twoN.calls.push([fileUrl('node_modules/@scope/paket/lib/x.js'), 'f', 0, 2]);
    }));
    expect(hull).toEqual({ paths: [SPEND_WORK.path], packages: ['@scope/paket', 'ajv'] });
  });

  it('übergeht Nodes eigene Laufzeit', () => {
    const hull = deriveScalingHull(observation((_category, { twoN }) => {
      twoN.calls.push(['node:internal/util', 'getLazy', 0, 9]);
    }));
    expect(hull.paths).toEqual([SPEND_WORK.path]);
  });

  it('bricht bei skalierendem Code ohne Datei oder außerhalb des Repositoriums ab', () => {
    for (const url of ['', 'evalmachine.<anonymous>']) {
      expect(() => deriveScalingHull(observation((_category, { twoN }) => {
        twoN.calls.push([url, 'f', 0, 1]);
      }))).toThrow(/Skalierende Funktion ohne Datei im Messweg/);
    }
    expect(() => deriveScalingHull(observation((_category, { twoN }) => {
      twoN.calls.push([pathToFileURL(resolve(REPO_ROOT, '..', 'fremd.mjs')).href, 'f', 0, 1]);
    }))).toThrow(/außerhalb des Repositoriums/);
  });

  it('lässt den Grenzwertkandidaten aus', () => {
    // Diese Datei MUSS zwischen Mess- und Lieferstand verschieden sein. Läge
    // sie in der Hülle, könnte kein Artefakt je zum gelieferten Stand passen.
    const hull = deriveScalingHull(observation((_category, { twoN }) => {
      for (const path of PROVENANCE_EXCLUDED_PATHS) twoN.calls.push([fileUrl(path), 'f', 0, 1]);
    }));
    for (const path of PROVENANCE_EXCLUDED_PATHS) expect(hull.paths).not.toContain(path);
  });

  it('sortiert die Hülle über Code-Units', () => {
    const upper = fileUrl('src/domain/Zeta.ts');
    const hull = deriveScalingHull(observation((_category, { twoN }) => {
      twoN.calls.push([fileUrl('src/domain/alpha.ts'), 'f', 0, 1], [upper, 'f', 0, 1]);
    }));
    expect(hull.paths).toEqual([...hull.paths].sort(byCodeUnit));
    expect(hull.paths.indexOf('src/domain/Zeta.ts')).toBeLessThan(hull.paths.indexOf('src/domain/alpha.ts'));
  });

  describe('Selbstnachweis', () => {
    it('scheitert, wenn spendWork nicht als skalierend erkannt ist', () => {
      expect(() => deriveScalingHull(observation((_category, { twoN }) => {
        twoN.calls[0] = [BUDGET, 'spendWork', 100, 40];
      }))).toThrow(
        'Selbstnachweis der Messwegprovenienz gescheitert: spendWork aus src/domain/profileResolutionBudget.ts ist nicht als skalierend erkannt',
      );
    });

    it('scheitert, wenn spendWork an anderer Stelle liegt als erwartet', () => {
      // Eine gleichnamige Funktion in einer anderen Datei belegt nicht, dass
      // die Zählung die Buchung der Arbeitseinheiten sieht.
      const elsewhere = fileUrl('src/domain/profileResolutionMerge.ts');
      expect(() => deriveScalingHull(observation((_category, { n, twoN }) => {
        n.calls[0] = [elsewhere, 'spendWork', 100, 40];
        twoN.calls[0] = [elsewhere, 'spendWork', 100, 80];
      }))).toThrow(/spendWork aus src\/domain\/profileResolutionBudget\.ts ist nicht als skalierend erkannt/);
    });

    it('scheitert, wenn eine Kategorie zwischen N und 2N nicht wächst', () => {
      expect(() => deriveScalingHull(observation((category, { twoN }) => {
        if (category === 'alter-target-lookup') twoN.workUnits = 40;
      }))).toThrow(
        'Selbstnachweis der Messwegprovenienz gescheitert: Kategorie alter-target-lookup verbraucht bei 2N nicht mehr Arbeitseinheiten als bei N (40 → 40)',
      );
    });

    it('scheitert, wenn eine Kategorie gar nicht gezählt ist', () => {
      const partial = observation();
      partial.categories = partial.categories.filter((entry) => entry.category !== 'glob-state');
      expect(() => deriveScalingHull(partial))
        .toThrow('Selbstnachweis der Messwegprovenienz gescheitert: Kategorie glob-state wurde nicht gezählt');
      expect(() => deriveScalingHull({})).toThrow(/wurde nicht gezählt/);
    });
  });
});

describe('fingerprintHull', () => {
  const path = SPEND_WORK.path;
  const original = readFileSync(resolve(REPO_ROOT, path), 'utf8');
  const fingerprint = (source: string) => fingerprintHull([path], [], () => source);

  it('bleibt bei einer reinen Kommentaränderung stehen', () => {
    const variant = `/* neuer Dateikopf */\n${original}`
      .replace('// Vor der Operation, nicht danach:', '// Umformulierter Kommentar:');
    expect(variant).not.toBe(original);
    expect(fingerprint(variant)).toBe(fingerprint(original));
  });

  it('bleibt bei einer reinen Formatierungsänderung stehen', () => {
    const variant = original
      .replace('workUnits += count;', 'workUnits   +=   count;\n\n')
      .replace('const base64Limit =\n    testLimits', 'const base64Limit = testLimits')
      .replaceAll('\n  ', '\n    ');
    expect(variant).not.toBe(original);
    expect(fingerprint(variant)).toBe(fingerprint(original));
  });

  it('verschiebt sich bei einer inhaltlichen Änderung derselben Datei', () => {
    const variant = original.replace('if (workUnits + count > workLimit)', 'if (workUnits + count >= workLimit)');
    expect(variant).not.toBe(original);
    expect(fingerprint(variant)).not.toBe(fingerprint(original));
  });

  it('verschiebt sich mit Pfad und Laufzeitversionen', () => {
    expect(fingerprintHull(['a.ts'], [], () => 'f();')).not.toBe(fingerprintHull(['b.ts'], [], () => 'f();'));
    expect(fingerprintHull(['a.ts'], ['ajv@1.0.0'], () => 'f();'))
      .not.toBe(fingerprintHull(['a.ts'], ['ajv@1.0.1'], () => 'f();'));
  });

  it('hängt nicht an der Reihenfolge des Aufrufers', () => {
    const read = (file: string) => `export const name = ${JSON.stringify(file)};`;
    expect(fingerprintHull(['src/b.ts', 'src/A.ts', 'src/a.ts'], [], read))
      .toBe(fingerprintHull(['src/a.ts', 'src/b.ts', 'src/A.ts'], [], read));
  });

  it('normalisiert auch .mjs-Quellen', () => {
    expect(normalizeSource('x.mjs', 'export const a = 1; // Kommentar\n'))
      .toBe(normalizeSource('x.mjs', '/* Kopf */\nexport   const a =\n  1;\n'));
  });
});

describe('Zählabschnitt der Aufrufzählung', () => {
  it('ist genau der Abschnitt, den der Messharnisch zeitlich misst', () => {
    // Die Aufrufzählung spiegelt `runResolutionFixture` des Browserharnisches.
    // Wandert dort Vorbereitung in den gemessenen Abschnitt, muss die Zählung
    // folgen — sonst fehlten skalierende Funktionen in der Hülle.
    const harness = readFileSync(resolve(REPO_ROOT, 'scripts/measure/class2-budget.harness.mjs'), 'utf8');
    const collector = readFileSync(resolve(REPO_ROOT, 'scripts/measureWorkLimitCallCounts.mjs'), 'utf8');
    const between = (source: string, anchor: string, start: string, end: string) => {
      const from = source.indexOf(start, source.indexOf(anchor));
      expect(source.indexOf(anchor)).toBeGreaterThanOrEqual(0);
      const to = source.indexOf(end, from + start.length);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeGreaterThan(from);
      return source.slice(from + start.length, to).trim();
    };
    expect(between(harness, 'async function runResolutionFixture(', 'const start = nowMs();', 'const ms = nowMs() - start;'))
      .toBe('const outcome = await resolveProfile({ plan, edgesByArtifactKey, profileViews });');
    expect(between(
      collector,
      'async function countedRun(',
      "await session.post('Profiler.takePreciseCoverage');",
      "const { result } = await session.post('Profiler.takePreciseCoverage');",
    )).toBe('const outcome = await domain.resolveProfile({ plan, edgesByArtifactKey, profileViews });');
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
  // Echte Aufrufzählung im Kindprozess, ohne Browser.
  let first: ReturnType<typeof workLimitProvenance>;
  let second: ReturnType<typeof workLimitProvenance>;
  beforeAll(() => {
    first = workLimitProvenance();
    second = workLimitProvenance();
  }, 120_000);

  it('liefert in zwei Läufen denselben Fingerprint', () => {
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toEqual(first);
    expect(first.method).toBe(WORK_LIMIT_PROVENANCE_METHOD);
    expect(first.files).toBe(first.paths.length);
  });

  it('enthält den Code, der je Arbeitseinheit läuft', () => {
    expect(first.paths).toContain('src/domain/profileResolutionBudget.ts');
  });

  it('lässt Vorbereitung und konstant oft laufenden Code aus', () => {
    // Die Versionsmatrix und der Root-Dispatch laufen in der Abschlusskette
    // einmal je Profil, `parseProfileDocument` vor dem Timer. Keine der drei
    // Dateien ändert die Kosten pro Arbeitseinheit.
    for (const path of [
      'src/domain/oscalVersionMatrix.mjs',
      'src/adapters/oscalRootDispatch.ts',
      'src/adapters/oscalProfileDocument.ts',
    ]) {
      expect(first.paths).not.toContain(path);
    }
  });

  it('sortiert die Pfade über Code-Units', () => {
    expect(first.paths).toEqual([...first.paths].sort(byCodeUnit));
  });
});
