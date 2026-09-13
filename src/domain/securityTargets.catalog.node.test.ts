// @vitest-environment node
// =============================================================================
// Schutzziel-Facetten am realen Grundschutz++-Katalog (GSPP-226)
//
// Der Katalog wird nie committet, sondern bei jedem Build frisch von BSI
// geholt. Deshalb steht hier **keine** feste Trefferzahl: Jede Erwartung wird
// aus dem Rohdokument des jeweils gepinnten Snapshots berechnet und gegen das
// Ergebnis der Adapter- und Facettenpipeline gehalten. Eine Assertion gegen
// "genau 901 Controls mit Vertraulichkeitsangabe" wäre beim nächsten
// Upstream-Update rot, ohne dass etwas kaputt ist.
//
// Der Snapshot stammt aus `upstream-manifest.json`; der Test weist ihn aus,
// damit ein Fehlschlag dem konkreten Stand zuzuordnen ist.
//
// Ohne `npm run fetch-catalog` fehlt die Datei; die Suite wird dann
// übersprungen statt fehlzuschlagen.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { RawOscalControl, RawOscalProp } from '@/domain/models';
import { parseControl } from '@/adapters/oscalAdapter';
import { SECURITY_TARGETS_NAMESPACE_URL } from '@/domain/vocabularyNamespaces';
import {
  SECURITY_TARGET_DIMENSIONS,
  SECURITY_TARGET_RELEVANCE_ORDER,
  classifySecurityTarget,
  matchesSecurityTargetFilterValue,
  securityTargetFacetKeys,
} from '@/domain/securityTargets';

const catalogPath = process.env.GSPP_CATALOG_CORPUS_PATH ?? 'public/data/catalog.json';
const manifestPath = 'upstream-manifest.json';
const corpusAvailable = existsSync(catalogPath) && existsSync(manifestPath);

interface RawGroup {
  controls?: RawOscalControl[];
  groups?: RawGroup[];
}

function collectControls(node: RawGroup): RawOscalControl[] {
  const collected: RawOscalControl[] = [];
  for (const control of node.controls ?? []) {
    collected.push(control);
    collected.push(...collectControls(control as RawGroup));
  }
  for (const group of node.groups ?? []) {
    collected.push(...collectControls(group));
  }
  return collected;
}

function loadCorpus() {
  const raw = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const rawControls = collectControls(raw.catalog as RawGroup);

  return {
    snapshotCommitSha: manifest.snapshotCommitSha as string,
    rawControls,
    controls: rawControls.map((control) => parseControl(control, undefined, undefined)),
  };
}

/** Rohzählung direkt am Dokument — das unabhängige Orakel der Pipeline. */
function rawPropsNamed(control: RawOscalControl, name: string): RawOscalProp[] {
  return (control.props ?? []).filter((prop) => prop.name === name);
}

describe.skipIf(!corpusAvailable)('Schutzziel-Facetten am ausgelieferten Katalog', () => {
  const corpus = corpusAvailable ? loadCorpus() : null;

  it('läuft gegen den im Manifest gepinnten Snapshot', () => {
    expect(corpus!.snapshotCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(corpus!.rawControls.length).toBeGreaterThan(0);
  });

  it.each(SECURITY_TARGET_DIMENSIONS.map((entry) => entry.dimension))(
    'erhält den vorgefundenen Namespace unverändert — %s',
    (dimension) => {
      const meta = SECURITY_TARGET_DIMENSIONS.find((e) => e.dimension === dimension)!;
      let verglichen = 0;

      for (const [index, raw] of corpus!.rawControls.entries()) {
        const rawProp = rawPropsNamed(raw, meta.propName)[0];
        if (!rawProp) continue;

        const parsed = corpus!.controls[index][meta.propKey];
        expect(parsed).toBeDefined();
        expect(parsed!.ns).toBe(rawProp.ns);
        expect(parsed!.value).toBe(rawProp.value);
        verglichen += 1;
      }

      // Der Bestand trägt diese Angabe; ohne sie prüfte der Test nichts.
      expect(verglichen).toBeGreaterThan(0);
    },
  );

  it('vergibt keinen projekteigenen Namensraum', () => {
    // Alle vier Schutzziel-Props verweisen im Bestand auf security_targets.csv.
    // Entscheidend ist nicht die Konstante, sondern die Deckung mit dem Dokument.
    const nsImDokument = new Set<string | undefined>();
    const nsNachParsen = new Set<string | undefined>();

    for (const [index, raw] of corpus!.rawControls.entries()) {
      for (const meta of SECURITY_TARGET_DIMENSIONS) {
        const rawProp = rawPropsNamed(raw, meta.propName)[0];
        if (rawProp) nsImDokument.add(rawProp.ns);
        const parsed = corpus!.controls[index][meta.propKey];
        if (parsed) nsNachParsen.add(parsed.ns);
      }
    }

    expect([...nsNachParsen]).toEqual([...nsImDokument]);
    expect(nsNachParsen).toContain(SECURITY_TARGETS_NAMESPACE_URL);
  });

  it('lässt ein prop ohne Namespace ohne Namespace — alt-identifier im selben Katalog', () => {
    // Der Gegenfall zur Regel oben: Beide Zustände kommen real vor, und keiner
    // von beiden wird normalisiert.
    const ohneNamespace = corpus!.rawControls.filter(
      (control) => rawPropsNamed(control, 'alt-identifier')[0]?.ns === undefined,
    );

    expect(ohneNamespace.length).toBeGreaterThan(0);
  });

  it.each(SECURITY_TARGET_DIMENSIONS.map((entry) => entry.dimension))(
    'trennt Abwesenheit vom Nullwert über den gesamten Bestand — %s',
    (dimension) => {
      const meta = SECURITY_TARGET_DIMENSIONS.find((e) => e.dimension === dimension)!;

      const erwartetOhneProp = corpus!.rawControls.filter(
        (control) => rawPropsNamed(control, meta.propName).length === 0,
      ).length;
      const erwartetNullwert = corpus!.rawControls.filter(
        (control) => rawPropsNamed(control, meta.propName)[0]?.value === '0',
      ).length;

      const klassifikationen = corpus!.controls.map((control) =>
        classifySecurityTarget(control, dimension),
      );
      const unbewertet = klassifikationen.filter((c) => c.state === 'unrated').length;
      const nullwert = klassifikationen.filter(
        (c) => c.state === 'rated' && c.value === '0',
      ).length;

      expect(unbewertet).toBe(erwartetOhneProp);
      expect(nullwert).toBe(erwartetNullwert);

      // Der Bestand trägt beide Fälle — ohne sie prüfte der Test nichts.
      expect(erwartetOhneProp).toBeGreaterThan(0);
      expect(erwartetNullwert).toBeGreaterThan(0);

      // Und sie sind disjunkt: kein Control, das ein prop trägt, landet in
      // `unrated`, und keines ohne prop bekommt einen Wert zugeschrieben.
      const falschAlsUnbewertet = corpus!.controls.filter(
        (control, index) =>
          classifySecurityTarget(control, dimension).state === 'unrated' &&
          rawPropsNamed(corpus!.rawControls[index], meta.propName).length > 0,
      );
      const falschBewertet = corpus!.controls.filter(
        (control, index) =>
          classifySecurityTarget(control, dimension).state !== 'unrated' &&
          rawPropsNamed(corpus!.rawControls[index], meta.propName).length === 0,
      );

      expect(falschAlsUnbewertet).toHaveLength(0);
      expect(falschBewertet).toHaveLength(0);
    },
  );

  it.each(SECURITY_TARGET_DIMENSIONS.map((entry) => entry.dimension))(
    'deckt jede Klassifikation genau einen Zustand ab — %s',
    (dimension) => {
      const klassifikationen = corpus!.controls.map((control) =>
        classifySecurityTarget(control, dimension),
      );

      const rated = klassifikationen.filter((c) => c.state === 'rated').length;
      const unrated = klassifikationen.filter((c) => c.state === 'unrated').length;
      const unknown = klassifikationen.filter((c) => c.state === 'unknown').length;

      expect(rated + unrated + unknown).toBe(corpus!.controls.length);
    },
  );

  it.each(SECURITY_TARGET_DIMENSIONS.map((entry) => entry.dimension))(
    'zählt jede Stufe deckungsgleich mit dem Dokument — %s',
    (dimension) => {
      const meta = SECURITY_TARGET_DIMENSIONS.find((e) => e.dimension === dimension)!;

      const skala = SECURITY_TARGET_RELEVANCE_ORDER as readonly string[];
      const erwartet: Record<string, number> = {};
      for (const control of corpus!.rawControls) {
        const value = rawPropsNamed(control, meta.propName)[0]?.value;
        // Ohne Angabe und außerhalb der Skala zählen in keine Stufe.
        if (value === undefined || !skala.includes(value)) continue;
        erwartet[value] = (erwartet[value] ?? 0) + 1;
      }

      const gezaehlt: Record<string, number> = {};
      for (const control of corpus!.controls) {
        for (const key of securityTargetFacetKeys(
          classifySecurityTarget(control, dimension),
        )) {
          gezaehlt[key] = (gezaehlt[key] ?? 0) + 1;
        }
      }

      expect(gezaehlt).toEqual(erwartet);

      // Die Summe ist die Zahl der bewerteten Anforderungen, nicht die
      // Gesamtzahl — die unbewerteten fehlen bewusst und sind keine Stufe 0.
      const summe = Object.values(gezaehlt).reduce((a, b) => a + b, 0);
      const bewertet = corpus!.rawControls.filter(
        (control) => rawPropsNamed(control, meta.propName).length > 0,
      ).length;

      expect(summe).toBe(bewertet);
      expect(summe).toBeLessThan(corpus!.controls.length);
    },
  );

  it.each(SECURITY_TARGET_DIMENSIONS.map((entry) => entry.dimension))(
    'schließt die höhere Stufe nicht in die niedrigere ein — %s',
    (dimension) => {
      const meta = SECURITY_TARGET_DIMENSIONS.find((e) => e.dimension === dimension)!;

      const stufe2 = corpus!.rawControls.filter(
        (control) => rawPropsNamed(control, meta.propName)[0]?.value === '2',
      ).length;
      expect(stufe2).toBeGreaterThan(0);

      const trefferStufe1 = corpus!.controls.filter((control) =>
        matchesSecurityTargetFilterValue(
          classifySecurityTarget(control, dimension),
          '1',
        ),
      );
      const stufe1ImDokument = corpus!.rawControls.filter(
        (control) => rawPropsNamed(control, meta.propName)[0]?.value === '1',
      ).length;

      expect(trefferStufe1).toHaveLength(stufe1ImDokument);
    },
  );

  it.each(SECURITY_TARGET_DIMENSIONS.map((entry) => entry.dimension))(
    'holt mit der Stufe 0 keine Anforderung ohne Angabe zurück — %s',
    (dimension) => {
      const meta = SECURITY_TARGET_DIMENSIONS.find((e) => e.dimension === dimension)!;

      const trefferStufe0 = corpus!.controls.filter((control, index) => {
        const trifft = matchesSecurityTargetFilterValue(
          classifySecurityTarget(control, dimension),
          '0',
        );
        return trifft && rawPropsNamed(corpus!.rawControls[index], meta.propName).length === 0;
      });

      expect(trefferStufe0).toHaveLength(0);
    },
  );

  it.each(SECURITY_TARGET_DIMENSIONS.map((entry) => entry.dimension))(
    'führt genau die skalenfremden Werte des Dokuments als unbekannt — %s',
    (dimension) => {
      // Der aktuelle Bestand enthält keine skalenfremden Werte; die Substanz
      // dieses Falls liegt in den synthetischen Tests in `securityTargets.test.ts`.
      // Hier zählt, dass Dokument und Pipeline deckungsgleich bleiben, sobald
      // der Upstream einen solchen Wert einführt.
      const meta = SECURITY_TARGET_DIMENSIONS.find((e) => e.dimension === dimension)!;
      const skala = SECURITY_TARGET_RELEVANCE_ORDER as readonly string[];

      const erwartetUnbekannt = corpus!.rawControls.filter((control) => {
        const value = rawPropsNamed(control, meta.propName)[0]?.value;
        return value !== undefined && !skala.includes(value);
      }).length;

      const gezaehltUnbekannt = corpus!.controls.filter(
        (control) => classifySecurityTarget(control, dimension).state === 'unknown',
      ).length;

      expect(gezaehltUnbekannt).toBe(erwartetUnbekannt);
    },
  );

  it('kennt im aktuellen Snapshot ausschließlich Werte der BSI-Skala', () => {
    // Eine Aussage über den gepinnten Stand, keine feste Zahl: Sobald der
    // Upstream die Skala erweitert, schlägt dieser Test an und die
    // Ordnungsannahme in `securityTargets.ts` gehört überprüft.
    const werteImBestand = new Set<string>();
    for (const control of corpus!.rawControls) {
      for (const meta of SECURITY_TARGET_DIMENSIONS) {
        const value = rawPropsNamed(control, meta.propName)[0]?.value;
        if (value !== undefined) werteImBestand.add(value);
      }
    }

    expect(werteImBestand.size).toBeGreaterThan(0);
    expect([...werteImBestand].sort()).toEqual([...SECURITY_TARGET_RELEVANCE_ORDER]);
  });
});

// =============================================================================
// Normbeleg — die beiden OSCAL-Aussagen dieses Slices gegen die gepinnten
// Schemata (R17). Sie stehen im Kopfkommentar von `securityTargets.ts` und in
// `docs/FILTERING.md`; hier werden sie geprüft statt behauptet. Ändert NIST
// eine der Definitionen, schlägt dieser Test an und die Doku ist nachweislich
// überholt.
// =============================================================================

describe('OSCAL-Normbeleg gegen die gepinnten Schemata', () => {
  const schemaDir = 'schemas/oscal/v1.1.3';

  it('führt prop.value als StringDatatype ohne Enum, Zahlentyp und Ordnung', () => {
    const schema = JSON.parse(
      readFileSync(`${schemaDir}/oscal_catalog_schema.json`, 'utf8'),
    );
    const property = schema.definitions['oscal-catalog-oscal-metadata:property'];

    expect(property.properties.value.$ref).toBe('#/definitions/StringDatatype');

    const stringDatatype = schema.definitions.StringDatatype;
    expect(stringDatatype.type).toBe('string');
    expect(stringDatatype.enum).toBeUndefined();
    // Ein nicht leerer String ohne Randwhitespace — mehr sagt OSCAL nicht zu.
    expect(stringDatatype.pattern).toBe('^\\S(.*\\S)?$');
  });

  it('verlangt bei property nur name und value und führt ns, class, group als optional', () => {
    // Trägt die Zuordnung über `name` UND `ns` im Adapter: Wären `ns`, `class`
    // und `group` nicht Teil der Eigenschaft, dürfte der Adapter sie nicht zum
    // Unterscheidungsmerkmal machen.
    const schema = JSON.parse(
      readFileSync(`${schemaDir}/oscal_catalog_schema.json`, 'utf8'),
    );
    const property = schema.definitions['oscal-catalog-oscal-metadata:property'];

    expect(property.required).toEqual(['name', 'value']);
    for (const optional of ['ns', 'class', 'group', 'uuid', 'remarks']) {
      expect(property.properties).toHaveProperty(optional);
      expect(property.required).not.toContain(optional);
    }
  });

  it('führt props auf control als optional — Abwesenheit ist zulässig', () => {
    // Die Grundlage der Unterscheidung „ohne Angabe" gegenüber der Bewertung 0.
    const schema = JSON.parse(
      readFileSync(`${schemaDir}/oscal_catalog_schema.json`, 'utf8'),
    );
    const control = schema.definitions['oscal-catalog-oscal-catalog:control'];

    expect(control.required).toEqual(['id', 'title']);
    expect(control.properties).toHaveProperty('props');
    expect(control.required).not.toContain('props');
  });

  it('kennt implementation-status ausschließlich unter by-component im SSP', () => {
    const schema = JSON.parse(
      readFileSync(`${schemaDir}/oscal_ssp_schema.json`, 'utf8'),
    );

    const traeger = Object.entries(schema.definitions)
      .filter(([, definition]) =>
        Object.hasOwn(
          (definition as { properties?: Record<string, unknown> }).properties ?? {},
          'implementation-status',
        ),
      )
      .map(([key]) => key);

    expect(traeger).toEqual(['oscal-ssp-oscal-ssp:by-component']);
  });
});
