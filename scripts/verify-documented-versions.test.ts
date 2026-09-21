import { describe, expect, it } from 'vitest';
import {
  ToolchainContractError,
  assertChromiumParagraph,
  assertExpectedTable,
  collectContractViolations,
  findVersionLiterals,
  formatViolations,
  parseDependencyClaims,
  parseSection,
  readRepositoryState,
} from './verify-documented-versions.mjs';

const DOCUMENTATION = `## Browser-Testlane

Die Lane nutzt \`vitest\` mit jsdom.

| Abhängigkeit | Pin | Lizenz | Zweck |
| --- | --- | --- | --- |
| \`vitest\` + \`@vitest/coverage-v8\` + \`@vitest/browser-playwright\` | exakt, für alle drei identisch | MIT | Testbasis |
| \`playwright\` | exakt | Apache-2.0 | Startet Chromium |

Die Versionen stehen in \`package.json\`, \`package-lock.json\` bindet sie samt
Integritätshashes. Chromium ist an den gepinnten \`playwright\`-Stand gebunden:
Der CI-Schritt lädt ausschließlich die Revision, die das \`browsers.json\` der
von \`playwright\` aufgelösten \`playwright-core\`-Installation nennt; einen
unversionierten Browser-Download gibt es nicht.

Bei Port 65535 wird auf 65534 ausgewichen; die Schwellen sind Lines 87 und Branches 77.

## Verzeichnisstruktur

Greptiles \`strictness\` ist invers (\`1\` = ausführlich, \`3\` = nur Kritisches).
`;

const PACKAGE_MANIFEST = {
  devDependencies: {
    vitest: '5.0.0',
    '@vitest/coverage-v8': '5.0.0',
    '@vitest/browser-playwright': '5.0.0',
    playwright: '1.63.0',
  },
};

const PLAYWRIGHT_CORE = {
  name: 'playwright-core',
  version: '1.63.0',
  manifestPath: 'node_modules/playwright-core/browsers.json',
  packagePath: 'node_modules/playwright-core/package.json',
  browsersManifest: {
    browsers: [
      { name: 'chromium', revision: '1243', browserVersion: '153.0.8010.12' },
      { name: 'firefox', revision: '9999', browserVersion: '0.0.0' },
    ],
  },
};

function violationsFor(overrides: {
  documentation?: string;
  packageManifest?: unknown;
  playwrightCore?: unknown;
}) {
  return collectContractViolations({
    documentation: DOCUMENTATION,
    packageManifest: PACKAGE_MANIFEST,
    playwrightCore: PLAYWRIGHT_CORE,
    ...overrides,
  });
}

describe('parseSection', () => {
  it('grenzt den Abschnitt bis zur nächsten Überschrift ab', () => {
    const section = parseSection(DOCUMENTATION);

    expect(section.startLine).toBe(1);
    expect(section.endLine).toBe(17);
    expect(section.lines).toHaveLength(17);
  });

  it('schlägt fehl, wenn die Überschrift nicht mehr auffindbar ist', () => {
    expect(() => parseSection('# Ohne Abschnitt\n')).toThrow(ToolchainContractError);
  });
});

describe('parseDependencyClaims', () => {
  it('liest Trio-Zeile und playwright-Zeile mit ihren Pin-Eigenschaften', () => {
    expect(parseDependencyClaims(DOCUMENTATION)).toEqual([
      {
        line: 7,
        packages: ['vitest', '@vitest/coverage-v8', '@vitest/browser-playwright'],
        pinProperty: 'exakt, für alle drei identisch',
      },
      { line: 8, packages: ['playwright'], pinProperty: 'exakt' },
    ]);
  });

  it('schlägt fehl, wenn die Tabelle nicht mehr auffindbar ist', () => {
    expect(() => parseDependencyClaims('# Ohne Tabelle\n')).toThrow(ToolchainContractError);
  });

  it('schlägt fehl, wenn die Tabelle keine auswertbare Zeile mehr trägt', () => {
    const emptyTable = DOCUMENTATION.split('\n').slice(0, 6).join('\n');

    expect(() => parseDependencyClaims(emptyTable)).toThrow(
      /enthält keine auswertbare Zeile/,
    );
  });

  it('schlägt fehl, wenn einer Paketzeile die Backticks um den Paketnamen fehlen', () => {
    const withoutBackticks = DOCUMENTATION.replace(
      '| `playwright` | exakt |',
      '| playwright | exakt |',
    );

    expect(() => parseDependencyClaims(withoutBackticks)).toThrow(
      /:8: Die Tabellenzeile nennt kein in Backticks gesetztes Paket/,
    );
  });

  it('schlägt fehl, wenn einer Zeile die Pin-Eigenschaft fehlt', () => {
    const withoutProperty = DOCUMENTATION.replace(
      '| `playwright` | exakt | Apache-2.0 | Startet Chromium |',
      '| `playwright` |  | Apache-2.0 | Startet Chromium |',
    );

    expect(() => parseDependencyClaims(withoutProperty)).toThrow(
      /:8: Die Tabellenzeile nennt playwright, aber keine auswertbare Pin-Eigenschaft/,
    );
  });
});

describe('assertExpectedTable', () => {
  it('akzeptiert die dokumentierte Form', () => {
    expect(() => assertExpectedTable(parseDependencyClaims(DOCUMENTATION))).not.toThrow();
  });

  it('schlägt fehl, wenn eine Zeile entfällt', () => {
    const singleRow = DOCUMENTATION.replace(
      '| `playwright` | exakt | Apache-2.0 | Startet Chromium |\n',
      '',
    );

    expect(() => assertExpectedTable(parseDependencyClaims(singleRow))).toThrow(
      /statt der erwarteten 2 Zeilen/,
    );
  });

  it('schlägt fehl, wenn eine Pin-Eigenschaft umformuliert wurde', () => {
    const reworded = DOCUMENTATION.replace(
      'exakt, für alle drei identisch',
      'ungefähr gleich',
    );

    expect(() => assertExpectedTable(parseDependencyClaims(reworded))).toThrow(
      /:7: Die Tabellenzeile weicht von der geprüften Form ab/,
    );
  });
});

describe('assertChromiumParagraph', () => {
  it('findet den Absatz trotz Zeilenumbrüchen', () => {
    expect(assertChromiumParagraph(DOCUMENTATION)).toEqual({ line: 10 });
  });

  it('toleriert eine Neuformatierung des Absatzes ohne inhaltliche Änderung', () => {
    const reflowed = DOCUMENTATION.replace(
      /Die Versionen stehen[\s\S]*?gibt es nicht\./,
      'Die Versionen stehen in `package.json`, `package-lock.json` bindet sie samt Integritätshashes. Chromium ist an den gepinnten `playwright`-Stand gebunden: Der CI-Schritt lädt ausschließlich die Revision, die das `browsers.json` der von `playwright` aufgelösten `playwright-core`-Installation nennt; einen unversionierten Browser-Download gibt es nicht.',
    );

    expect(assertChromiumParagraph(reflowed)).toEqual({ line: 10 });
  });

  it('schlägt fehl, wenn der Absatz umformuliert wurde', () => {
    const rewritten = DOCUMENTATION.replace(
      'unversionierten Browser-Download',
      'freien Browser-Download',
    );

    expect(() => assertChromiumParagraph(rewritten)).toThrow(/nicht mehr auffindbar/);
  });
});

describe('findVersionLiterals', () => {
  it('meldet nichts für Abschnitt ohne Versionsliteral', () => {
    // Gegenprobe: Portnummern und Coverage-Schwellen stehen ohne Backticks und
    // dürfen nicht anschlagen; die Backtick-Zahlen `1` und `3` liegen außerhalb
    // des Abschnitts und bindet die Abschnittsgrenze ebenfalls nicht.
    expect(findVersionLiterals(DOCUMENTATION)).toEqual([]);
  });

  it('meldet ein Versionsliteral im Abschnitt mit Zeile', () => {
    const withLiteral = DOCUMENTATION.replace(
      'Die Lane nutzt `vitest` mit jsdom.',
      'Die Lane nutzt `vitest` mit jsdom in `5.0.1`.',
    );

    expect(findVersionLiterals(withLiteral)).toEqual([{ line: 3, value: '5.0.1' }]);
  });

  it('meldet kein Literal außerhalb des Abschnitts', () => {
    const outsideOnly = '# Ohne Abschnitt\n\nDie Version `9.9.9` steht hier.\n';

    expect(findVersionLiterals(outsideOnly, { startLine: 1, endLine: 1, lines: ['# Ohne Abschnitt'] })).toEqual([]);
  });
});

describe('collectContractViolations', () => {
  it('meldet nichts, wenn der Vertrag am installierten Stand gilt', () => {
    expect(violationsFor({})).toEqual([]);
  });

  it('meldet einen Nicht-Pin mit Caret', () => {
    const violations = violationsFor({
      packageManifest: {
        devDependencies: { ...PACKAGE_MANIFEST.devDependencies, vitest: '^5.0.0' },
      },
    });

    expect(violations).toContainEqual({
      line: 7,
      subject: 'vitest',
      expected: 'exakter Pin',
      measured: '^5.0.0',
      source: 'package.json → devDependencies',
    });
  });

  it('meldet einen Nicht-Pin mit Range', () => {
    const violations = violationsFor({
      packageManifest: {
        devDependencies: { ...PACKAGE_MANIFEST.devDependencies, playwright: '>=1.0.0 <2.0.0' },
      },
    });

    expect(violations).toContainEqual({
      line: 8,
      subject: 'playwright',
      expected: 'exakter Pin',
      measured: '>=1.0.0 <2.0.0',
      source: 'package.json → devDependencies',
    });
  });

  it('meldet ungleiche Trio-Pins', () => {
    const violations = violationsFor({
      packageManifest: {
        devDependencies: { ...PACKAGE_MANIFEST.devDependencies, '@vitest/coverage-v8': '5.0.1' },
      },
    });

    expect(violations).toContainEqual({
      line: 7,
      subject: 'Vitest-Trio',
      expected: 'identische Pins für alle drei',
      measured: 'vitest 5.0.0, @vitest/coverage-v8 5.0.1, @vitest/browser-playwright 5.0.0',
      source: 'package.json → dependencies/devDependencies',
    });
  });

  it('meldet ein dokumentiertes Paket, das im Manifest fehlt', () => {
    const { playwright, ...withoutPlaywright } = PACKAGE_MANIFEST.devDependencies;
    void playwright;

    expect(
      violationsFor({ packageManifest: { devDependencies: withoutPlaywright } }),
    ).toContainEqual({
      line: 8,
      subject: 'playwright',
      expected: 'exakter Pin',
      measured: 'im Manifest nicht vorhanden',
      source: 'package.json → dependencies/devDependencies',
    });
  });

  it('löst ein Paket auch aus dependencies statt devDependencies auf', () => {
    expect(
      violationsFor({
        packageManifest: {
          dependencies: { playwright: '1.63.0' },
          devDependencies: {
            vitest: '5.0.0',
            '@vitest/coverage-v8': '5.0.0',
            '@vitest/browser-playwright': '5.0.0',
          },
        },
      }),
    ).toEqual([]);
  });

  it('meldet eine abweichende aufgelöste playwright-core-Version', () => {
    const violations = violationsFor({
      playwrightCore: { ...PLAYWRIGHT_CORE, version: '1.62.1' },
    });

    expect(violations).toContainEqual({
      line: 10,
      subject: 'playwright-core',
      expected: '1.63.0',
      measured: '1.62.1',
      source: 'node_modules/playwright-core/package.json → version',
    });
  });

  it('schlägt fehl, wenn browsers.json keinen Chromium-Eintrag mehr führt', () => {
    expect(
      () =>
        violationsFor({
          playwrightCore: {
            ...PLAYWRIGHT_CORE,
            browsersManifest: { browsers: [{ name: 'firefox' }] },
          },
        }),
    ).toThrow(ToolchainContractError);
  });

  it('meldet einen Chromium-Eintrag ohne Revision', () => {
    const violations = violationsFor({
      playwrightCore: {
        ...PLAYWRIGHT_CORE,
        browsersManifest: {
          browsers: [{ name: 'chromium', browserVersion: '153.0.8010.12' }],
        },
      },
    });

    expect(violations).toContainEqual({
      line: 10,
      subject: 'Chromium-revision',
      expected: 'belegter Eintrag',
      measured: 'fehlt',
      source: 'node_modules/playwright-core/browsers.json → browsers[name=chromium].revision',
    });
  });

  it('meldet ein Versionsliteral im geprüften Abschnitt', () => {
    const documentation = DOCUMENTATION.replace(
      'Die Lane nutzt `vitest` mit jsdom.',
      'Die Lane nutzt `vitest` mit jsdom in `5.0.1`.',
    );

    expect(violationsFor({ documentation })).toContainEqual({
      line: 3,
      subject: 'Versionsliteral `5.0.1`',
      expected: 'kein Versionsliteral',
      measured: '5.0.1',
      source: 'docs/ARCHITECTURE.md → Abschnitt "## Browser-Testlane"',
    });
  });
});

describe('formatViolations', () => {
  it('nennt Datei, Zeile, erwarteten und gemessenen Wert je Verletzung', () => {
    const violations = violationsFor({
      packageManifest: {
        devDependencies: { ...PACKAGE_MANIFEST.devDependencies, vitest: '^5.0.0' },
      },
    });

    expect(formatViolations(violations)).toContain(
      'docs/ARCHITECTURE.md:7 — vitest: erwartet "exakter Pin", gemessen "^5.0.0" '
      + '(Quelle: package.json → devDependencies)',
    );
  });
});

describe('Repository-Stand', () => {
  it('läuft unverändert ohne Verletzung durch', () => {
    expect(collectContractViolations(readRepositoryState())).toEqual([]);
  });

  it('wird rot, sobald der installierte playwright-Pin vom Vertrag abweicht', () => {
    const state = readRepositoryState();
    const manifest = state.packageManifest as {
      devDependencies: Record<string, string>;
    };

    const violations = collectContractViolations({
      ...state,
      packageManifest: {
        ...manifest,
        devDependencies: { ...manifest.devDependencies, playwright: '99.0.0' },
      },
    });

    expect(violations.length).toBeGreaterThan(0);
    expect(formatViolations(violations)).toContain('erwartet "99.0.0"');
  });
});
