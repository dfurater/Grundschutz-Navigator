import { describe, expect, it } from 'vitest';
import {
  DocumentedVersionError,
  collectVersionDrift,
  formatDrift,
  parseBrowserClaim,
  parseDependencyClaims,
  readRepositoryState,
} from './verify-documented-versions.mjs';

const DOCUMENTATION = `## Testinfrastruktur

| Abhängigkeit | Exakte Version | Lizenz | Zweck |
| --- | --- | --- | --- |
| \`vitest\` + \`@vitest/coverage-v8\` | \`5.0.0\` | MIT | Test- und Coverage-Basis |
| \`playwright\` | \`1.62.1\` | Apache-2.0 | Startet das gepinnte Chromium |

Die exakte \`playwright\`-Version \`1.62.1\` liefert laut ihrem mitinstallierten
\`browsers.json\` Chromium-Revision \`1234\` als Chrome for Testing
\`151.0.7922.34\`. Der CI-Schritt verwendet ausschließlich den lokalen Befehl.
`;

const PACKAGE_MANIFEST = {
  devDependencies: {
    vitest: '5.0.0',
    '@vitest/coverage-v8': '5.0.0',
    playwright: '1.62.1',
  },
};

const BROWSERS_MANIFEST = {
  browsers: [
    { name: 'chromium', revision: '1234', browserVersion: '151.0.7922.34' },
    { name: 'firefox', revision: '9999', browserVersion: '0.0.0' },
  ],
};

function driftFor(overrides: {
  documentation?: string;
  packageManifest?: unknown;
  browsersManifest?: unknown;
}) {
  return collectVersionDrift({
    documentation: DOCUMENTATION,
    packageManifest: PACKAGE_MANIFEST,
    browsersManifest: BROWSERS_MANIFEST,
    ...overrides,
  });
}

describe('parseDependencyClaims', () => {
  it('liest eine Zeile mit mehreren Paketen als gemeinsame Zusage', () => {
    expect(parseDependencyClaims(DOCUMENTATION)).toEqual([
      { line: 5, packages: ['vitest', '@vitest/coverage-v8'], version: '5.0.0' },
      { line: 6, packages: ['playwright'], version: '1.62.1' },
    ]);
  });

  it('schlägt fehl, wenn die Tabelle nicht mehr auffindbar ist', () => {
    expect(() => parseDependencyClaims('# Ohne Tabelle\n')).toThrow(DocumentedVersionError);
  });

  it('schlägt fehl, wenn die Tabelle keine auswertbare Zeile mehr trägt', () => {
    const emptyTable = DOCUMENTATION.split('\n').slice(0, 4).join('\n');

    expect(() => parseDependencyClaims(emptyTable)).toThrow(
      /enthält keine auswertbare Zeile/,
    );
  });

  it('schlägt fehl, wenn eine Paketzeile keine eindeutige Version mehr nennt', () => {
    const withRange = DOCUMENTATION.replace('| `5.0.0` |', '| `5.0.0`–`5.1.0` |');

    expect(() => parseDependencyClaims(withRange)).toThrow(
      /:5: Die Tabellenzeile nennt vitest, @vitest\/coverage-v8, aber keine eindeutige/,
    );
  });

  it('schlägt fehl, wenn einer Paketzeile die Backticks um den Paketnamen fehlen', () => {
    const withoutBackticks = DOCUMENTATION.replace(
      '| `playwright` | `1.62.1` |',
      '| playwright | `1.62.1` |',
    );

    expect(() => parseDependencyClaims(withoutBackticks)).toThrow(
      /:6: Die Tabellenzeile nennt kein in Backticks gesetztes Paket/,
    );
  });
});

describe('parseBrowserClaim', () => {
  it('findet die drei Werte samt ihrer Zeilen trotz Zeilenumbrüchen im Absatz', () => {
    expect(parseBrowserClaim(DOCUMENTATION)).toEqual({
      playwrightVersion: '1.62.1',
      playwrightLine: 8,
      revision: '1234',
      revisionLine: 9,
      browserVersion: '151.0.7922.34',
      browserVersionLine: 10,
    });
  });

  it('toleriert eine Neuformatierung des Absatzes ohne inhaltliche Änderung', () => {
    const reflowed = DOCUMENTATION.replace(
      /Die exakte[\s\S]*?`151\.0\.7922\.34`\./,
      'Die exakte `playwright`-Version `1.62.1` liefert laut ihrem mitinstallierten `browsers.json` '
      + 'Chromium-Revision `1234` als Chrome for Testing `151.0.7922.34`.',
    );

    expect(parseBrowserClaim(reflowed)).toMatchObject({
      playwrightVersion: '1.62.1',
      revision: '1234',
      browserVersion: '151.0.7922.34',
    });
  });

  it('schlägt fehl, wenn der Absatz umformuliert wurde', () => {
    const rewritten = DOCUMENTATION.replace(
      'Chromium-Revision',
      'die Chromium-Revision',
    );

    expect(() => parseBrowserClaim(rewritten)).toThrow(/nicht mehr auffindbar/);
  });
});

describe('collectVersionDrift', () => {
  it('meldet nichts, wenn Dokumentation und installierter Stand übereinstimmen', () => {
    expect(driftFor({})).toEqual([]);
  });

  it('meldet einen angehobenen Paket-Pin mit Zeile, Soll- und Ist-Wert', () => {
    const drift = driftFor({
      packageManifest: {
        devDependencies: { ...PACKAGE_MANIFEST.devDependencies, playwright: '1.63.0' },
      },
    });

    expect(drift).toContainEqual({
      line: 6,
      subject: 'playwright',
      documented: '1.62.1',
      measured: '1.63.0',
      source: 'package.json → devDependencies',
    });
  });

  it('meldet jedes Paket einer geteilten Tabellenzeile einzeln', () => {
    const drift = driftFor({
      packageManifest: {
        devDependencies: { ...PACKAGE_MANIFEST.devDependencies, '@vitest/coverage-v8': '5.1.0' },
      },
    });

    expect(drift).toEqual([
      {
        line: 5,
        subject: '@vitest/coverage-v8',
        documented: '5.0.0',
        measured: '5.1.0',
        source: 'package.json → devDependencies',
      },
    ]);
  });

  it('löst ein Paket auch aus dependencies statt devDependencies auf', () => {
    const drift = driftFor({
      packageManifest: {
        dependencies: { playwright: '1.62.1' },
        devDependencies: { vitest: '5.0.0', '@vitest/coverage-v8': '5.0.0' },
      },
    });

    expect(drift).toEqual([]);
  });

  it('nennt dependencies als Quelle, wenn das Paket dort abweicht', () => {
    const drift = driftFor({
      packageManifest: {
        dependencies: { playwright: '1.63.0' },
        devDependencies: { vitest: '5.0.0', '@vitest/coverage-v8': '5.0.0' },
      },
    });

    expect(drift).toContainEqual({
      line: 6,
      subject: 'playwright',
      documented: '1.62.1',
      measured: '1.63.0',
      source: 'package.json → dependencies',
    });
  });

  it('meldet ein dokumentiertes Paket, das im Manifest fehlt', () => {
    const drift = driftFor({
      packageManifest: { devDependencies: { vitest: '5.0.0', playwright: '1.62.1' } },
    });

    expect(drift).toContainEqual({
      line: 5,
      subject: '@vitest/coverage-v8',
      documented: '5.0.0',
      measured: 'im Manifest nicht vorhanden',
      source: 'package.json → dependencies/devDependencies',
    });
  });

  it('meldet eine abweichende Chromium-Revision und Chrome-for-Testing-Version', () => {
    const drift = driftFor({
      browsersManifest: {
        browsers: [{ name: 'chromium', revision: '1243', browserVersion: '153.0.8010.12' }],
      },
    });

    expect(drift).toEqual([
      {
        line: 9,
        subject: 'Chromium-Revision',
        documented: '1234',
        measured: '1243',
        source: 'node_modules/playwright-core/browsers.json → browsers[name=chromium].revision',
      },
      {
        line: 10,
        subject: 'Chrome for Testing',
        documented: '151.0.7922.34',
        measured: '153.0.8010.12',
        source: 'node_modules/playwright-core/browsers.json → browsers[name=chromium].browserVersion',
      },
    ]);
  });

  it('schlägt fehl, wenn browsers.json keinen Chromium-Eintrag mehr führt', () => {
    expect(() => driftFor({ browsersManifest: { browsers: [{ name: 'firefox' }] } })).toThrow(
      DocumentedVersionError,
    );
  });

  it('prüft auch die im Fließtext wiederholte playwright-Version', () => {
    const documentation = DOCUMENTATION.replace(
      'Die exakte `playwright`-Version `1.62.1`',
      'Die exakte `playwright`-Version `1.60.0`',
    );

    expect(driftFor({ documentation })).toContainEqual({
      line: 8,
      subject: 'playwright',
      documented: '1.60.0',
      measured: '1.62.1',
      source: 'package.json → devDependencies',
    });
  });
});

describe('formatDrift', () => {
  it('nennt Datei, Zeile, dokumentierten und gemessenen Wert je Fundstelle', () => {
    const drift = driftFor({
      packageManifest: {
        devDependencies: { ...PACKAGE_MANIFEST.devDependencies, playwright: '1.63.0' },
      },
    });

    // Die Tabellenzeile und der Fließtext sagen dieselbe Version zu; ein Bump
    // macht beide Fundstellen falsch, und beide werden einzeln gemeldet.
    expect(formatDrift(drift)).toBe(
      'docs/ARCHITECTURE.md:6 — playwright: dokumentiert "1.62.1", gemessen "1.63.0" '
      + '(Quelle: package.json → devDependencies)\n'
      + 'docs/ARCHITECTURE.md:8 — playwright: dokumentiert "1.62.1", gemessen "1.63.0" '
      + '(Quelle: package.json → devDependencies)',
    );
  });
});

describe('Repository-Stand', () => {
  it('läuft unverändert ohne Abweichung durch', () => {
    expect(collectVersionDrift(readRepositoryState())).toEqual([]);
  });

  it('wird rot, sobald der installierte playwright-Pin von der Dokumentation abweicht', () => {
    const state = readRepositoryState();
    const manifest = state.packageManifest as {
      devDependencies: Record<string, string>;
    };

    const drift = collectVersionDrift({
      ...state,
      packageManifest: {
        ...manifest,
        devDependencies: { ...manifest.devDependencies, playwright: '99.0.0' },
      },
    });

    expect(drift.length).toBeGreaterThan(0);
    expect(formatDrift(drift)).toContain('gemessen "99.0.0"');
  });
});
