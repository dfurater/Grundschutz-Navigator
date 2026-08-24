import { describe, expect, it } from 'vitest';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import {
  VERSION_MATRIX_DIAGNOSTIC_CODES,
} from '@/domain/oscalVersionMatrix';
import { ROOT_DISPATCH_DIAGNOSTIC_CODES } from '@/adapters/oscalRootDispatch';
import { listArtifacts } from '@/domain/sourceRegistry';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import {
  buildScopedIdentityIndex,
  collectScopedIdentities,
  readDocumentIdentities,
  runNoOpRoundTrip,
  assertConstraintGapDocumented,
} from './oscalRoundTrip';

const CATALOG_122 = () => makeSchemaValidOscalDocument('catalog', '1.2.2');

/** Ein registrierter Katalog-Artefaktpfad für die artefaktscharfe Stufe 2. */
const CATALOG_ARTIFACT = listArtifacts({ lifecycle: 'supported' })
  .find((artifact): artifact is Extract<typeof artifact, { kind: 'oscal' }> =>
    artifact.kind === 'oscal' && artifact.expectedRootType === 'catalog')!;
const CATALOG_UPSTREAM_PATH = CATALOG_ARTIFACT.upstreamPath;
const CATALOG_ARTIFACT_KEY = CATALOG_ARTIFACT.artifactKey;

/** Setzt oder entfernt `metadata.oscal-version` am Katalogfixturkörper. */
function setCatalogOscalVersion(document: Record<string, unknown>, value?: string): void {
  const body = document.catalog as Record<string, unknown>;
  const metadata = body.metadata as Record<string, unknown>;
  if (value === undefined) {
    delete metadata['oscal-version'];
    return;
  }
  metadata['oscal-version'] = value;
}

function makeMappingWithInventedRelationship(): Record<string, unknown> {
  const document = structuredClone(
    makeSchemaValidOscalDocument('mapping-collection', '1.2.2'),
  ) as Record<string, unknown>;
  const body = document['mapping-collection'] as Record<string, unknown>;
  const mappings = body.mappings as Record<string, unknown>[];
  const maps = mappings[0]!.maps as Record<string, unknown>[];
  maps[0]!.relationship = 'maps-to';
  return document;
}

function makeAssessmentResultsWithForeignActorType(): Record<string, unknown> {
  const document = structuredClone(
    makeSchemaValidOscalDocument('assessment-results', '1.2.2'),
  ) as Record<string, unknown>;
  const body = document['assessment-results'] as Record<string, unknown>;
  const results = body.results as Record<string, unknown>[];
  results[0]!.observations = [{
    uuid: '77777777-7777-4777-8777-7777777700b2',
    description: 'Beobachtung mit erfundenem Akteurtyp.',
    methods: ['EXAMINE'],
    collected: '2026-08-16T00:00:00Z',
    origins: [{ actors: [{ type: 'telepathy', 'actor-uuid': '77777777-7777-4777-8777-7777777700c3' }] }],
  }];
  return document;
}

describe('Stufenstatusmodell', () => {
  it('weist Stufe 3 bestanden, Stufe 4 als not-checked und Stufe 5 als geprüft aus', async () => {
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(CATALOG_122()),
    });

    expect(result.stages.schemaValidation).toEqual({
      stage: 'json-schema',
      status: 'passed',
    });
    expect(result.stages.constraints).toEqual({
      stage: 'oscal-constraint',
      status: 'not-checked',
      documentedGap: true,
      reference: 'docs/OSCAL_VALIDATION.md',
      pendingCases: [],
    });
    expect(result.stages.references).toMatchObject({
      stage: 'reference',
      status: 'passed',
    });
  });

  it('weist Stufe 5 für Roots ohne Referenzumsetzung als nicht verfügbar aus', async () => {
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(makeSchemaValidOscalDocument('system-security-plan', '1.2.2')),
    });

    expect(result.stages.schemaValidation).toEqual({ stage: 'json-schema', status: 'passed' });
    expect(result.stages.references).toEqual({
      stage: 'reference',
      status: 'not-available',
      reason: 'catalog-only-implementation',
    });
  });

  it('lässt alle Stufen nicht laufen, wenn die Bindung scheitert', async () => {
    const document = CATALOG_122();
    setCatalogOscalVersion(document, '9.9.9');

    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(document),
    });

    for (const stage of ['schemaValidation', 'constraints', 'references'] as const) {
      expect(result.stages[stage].status).toBe('not-run');
    }
  });

  it('führt einen erfundenen map/relationship-Wert als sichtbare Constraint-Lücke', async () => {
    // Der Wert ist schema-valide (TokenDatatype) — genau deshalb darf der
    // Lauf ihn nicht als geprüft melden: Die Constraint-Stufe bleibt
    // not-checked und der Fall wird als pendierende Lücke benannt.
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(makeMappingWithInventedRelationship()),
    });

    expect(result.stages.schemaValidation.status).toBe('passed');
    expect(result.stages.constraints).toMatchObject({
      status: 'not-checked',
      documentedGap: true,
      pendingCases: ['map-relationship-token'],
    });
  });

  it('meldet keine pendierenden Constraint-Fälle für ein bekanntes relationship-Token', async () => {
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(
        makeSchemaValidOscalDocument('mapping-collection', '1.2.2'),
      ),
    });

    expect(result.stages.constraints.pendingCases).toEqual([]);
  });

  it('lehnt origin-actor.type außerhalb des geschlossenen Spektrums bereits in Stufe 3 ab', async () => {
    // Gegenprobe zur Lücke: Anders als map/relationship bindet das Schema
    // hier über allOf/enum — der invented Token fällt noch in Stufe 3.
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(makeAssessmentResultsWithForeignActorType()),
    });

    expect(result.stages.schemaValidation).toMatchObject({
      stage: 'json-schema',
      status: 'failed',
    });
    if (result.stages.schemaValidation.status === 'failed') {
      expect(result.stages.schemaValidation.diagnostic?.code)
        .toBe('OSCAL_SCHEMA_ENUM_MISMATCH');
    }
    // Die Vergleichsebenen laufen unabhängig von Stufe 3 weiter.
    expect(result.serialization.status).toBe('passed');
    expect(result.graph.status).toBe('passed');
  });

  it('erzwingt die dokumentierte Lücke gegen stille Erosion', () => {
    const forged = {
      stages: {
        constraints: { stage: 'oscal-constraint', status: 'passed' },
      },
    };

    expect(() => assertConstraintGapDocumented(forged as never)).toThrow(/not-checked/);
    expect(() => assertConstraintGapDocumented({
      stages: { constraints: { status: 'not-checked' } },
    } as never)).not.toThrow();
  });
});

describe('Versionsbindungs-Negativkorpus', () => {
  const codes = VERSION_MATRIX_DIAGNOSTIC_CODES;

  async function bindingCodeOf(document: Record<string, unknown>): Promise<{
    code: string;
    path: string;
  }> {
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(document),
    });
    expect(result.binding).toMatchObject({ ok: false, reason: 'dispatch-rejected' });
    if (!result.binding.ok && result.binding.reason === 'dispatch-rejected') {
      return {
        code: result.binding.diagnostic.code,
        path: result.binding.diagnostic.path,
      };
    }
    throw new Error('unerreichbar');
  }

  it('weist eine fehlende oscal-version mit OSCAL_VERSION_MISSING ab', async () => {
    const document = CATALOG_122();
    setCatalogOscalVersion(document);

    expect((await bindingCodeOf(document)).code).toBe(codes.VERSION_MISSING);
  });

  it('weist eine v-präfigierte oscal-version mit OSCAL_VERSION_MALFORMED ab', async () => {
    // Bestandsverhalten gemäß GSPP-357: fail-closed, keine Normalisierung.
    const document = CATALOG_122();
    setCatalogOscalVersion(document, 'v1.2.2');

    expect((await bindingCodeOf(document)).code).toBe(codes.VERSION_MALFORMED);
  });

  it('weist eine nicht gepinnte Version mit OSCAL_ROOT_VERSION_UNSUPPORTED ab', async () => {
    const document = CATALOG_122();
    setCatalogOscalVersion(document, '1.0.4');

    expect((await bindingCodeOf(document)).code).toBe(codes.ROOT_VERSION_UNSUPPORTED);
  });

  it('weist mapping-collection unter 1.2.0 als nicht existent — nicht bloß ungepinnt — aus', async () => {
    for (const version of ['1.1.2', '1.1.3'] as const) {
      const document = makeSchemaValidOscalDocument('mapping-collection', '1.2.2');
      const body = document['mapping-collection'] as Record<string, unknown>;
      const metadata = body.metadata as Record<string, unknown>;
      metadata['oscal-version'] = version;

      const finding = await bindingCodeOf(document);
      expect(finding.code, `mapping-collection @ ${version}`).toBe(codes.ROOT_VERSION_IMPOSSIBLE);
      expect(finding.path).toBe('/mapping-collection/metadata/oscal-version');
    }
  });

  it('lehnt einen $schema-Konflikt gegen die gewählte Zelle ab und lässt $schema nie wählen', async () => {
    // Die Zelle wird allein über metadata.oscal-version gewählt; der
    // Direktivwert eines ANDEREN Roots widerspricht ihr und wird abgelehnt.
    const document = CATALOG_122();
    document.$schema = 'http://csrc.nist.gov/ns/oscal/1.2.2/oscal-profile-schema.json';

    const finding = await bindingCodeOf(document);
    expect(finding.code).toBe(codes.SCHEMA_DIRECTIVE_CONFLICT);
    expect(finding.path).toBe('/$schema');
  });

  it('lehnt einen Export mit zwei Root-Keys als mehrdeutig ab', async () => {
    const document = CATALOG_122() as Record<string, unknown>;
    document.profile = makeSchemaValidOscalDocument('profile', '1.2.2').profile;

    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(document),
    });

    expect(result.binding).toMatchObject({
      ok: false,
      reason: 'dispatch-rejected',
      diagnostic: { code: ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_KEY_AMBIGUOUS },
    });
    for (const stage of ['schemaValidation', 'constraints', 'references'] as const) {
      expect(result.stages[stage].status).toBe('not-run');
    }
  });
});

describe('runNoOpRoundTrip', () => {
  it('durchläuft ein gültiges Minimaldokument ohne Differenz', async () => {
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(CATALOG_122()),
    });

    expect(result.mode).toBe('no-op');
    expect(result.rootType).toBe('catalog');
    expect(result.resourceLimit.status).toBe('passed');
    expect(result.binding).toMatchObject({ ok: true });
    if (result.binding.ok) {
      expect(result.binding.pin.rootKey).toBe('catalog');
      expect(result.binding.pin.oscalVersion).toBe('1.2.2');
    }
    expect(result.serialization).toEqual({ status: 'passed' });
    expect(result.graph).toEqual({ status: 'passed', differences: [] });
    expect(result.identities).toEqual({ status: 'passed', findings: [] });
  });

  it('weist ein Dokument oberhalb der Byte-Eingangsgrenze vor dem Parsen ab', async () => {
    const oversized = `{"catalog":{"x":"${'a'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes)}"}}`;

    const result = await runNoOpRoundTrip({
      fixtureText: oversized,
    });

    expect(result.resourceLimit.status).toBe('failed');
    if (result.resourceLimit.status === 'failed') {
      expect(result.resourceLimit.diagnostic?.code).toBe('OSCAL_BYTE_LIMIT_EXCEEDED');
    }
    expect(result.binding).toEqual({ ok: false, reason: 'limits-not-run' });
    expect(result.serialization).toEqual({ status: 'not-run' });
    expect(result.graph).toEqual({ status: 'not-run', differences: [] });
    expect(result.identities).toEqual({ status: 'not-run', findings: [] });
  });

  it('weist ein Dokument oberhalb der Tiefe-Grenze ab', async () => {
    const tooDeep = `${'['.repeat(CLASS_2_IMPORT_LIMITS.maxDepth + 1)}${']'.repeat(CLASS_2_IMPORT_LIMITS.maxDepth + 1)}`;

    const result = await runNoOpRoundTrip({
      fixtureText: tooDeep,
    });

    expect(result.resourceLimit.status).toBe('failed');
    if (result.resourceLimit.status === 'failed') {
      expect(result.resourceLimit.diagnostic?.code).toBe('OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED');
    }
    expect(result.serialization).toEqual({ status: 'not-run' });
  });

  it('meldet den Wertverlust von Infinity auf dem Graphen, nicht in der Serialisierung', async () => {
    // Befund 7: Beide Serialisierungen lauten null — die Blindstelle bleibt
    // grün; nur die Graph-Ebene erkennt den Verlust. Das Literal 1e400 steht
    // bewusst im Quelltext, damit JSON.parse beim Harnisch überhaupt ein
    // Infinity erzeugt.
    const baseText = JSON.stringify(CATALOG_122());
    const fixtureText = baseText.replace(
      '"oscal-version":"1.2.2"',
      '"oscal-version":"1.2.2","x-fixture-nonfinite":1e400',
    );
    expect(fixtureText).not.toBe(baseText);

    const result = await runNoOpRoundTrip({
      fixtureText,
    });

    expect(result.serialization.status).toBe('passed');
    expect(result.graph.status).toBe('failed');
    if (result.graph.status === 'failed') {
      expect(result.graph.differences).toHaveLength(1);
      expect(result.graph.differences[0]).toMatchObject({
        kind: 'value-changed',
        leftKind: 'non-finite-number',
        rightKind: 'null',
      });
    }
  });

  it('meldet −0 als Graph-Differenz, obwohl die Serialisierung gleich bleibt', async () => {
    const baseText = JSON.stringify(CATALOG_122());
    const fixtureText = baseText.replace(
      '"oscal-version":"1.2.2"',
      '"oscal-version":"1.2.2","x-fixture-negative-zero":-0',
    );

    const result = await runNoOpRoundTrip({
      fixtureText,
    });

    expect(result.serialization.status).toBe('passed');
    expect(result.graph.status).toBe('failed');
    if (result.graph.status === 'failed') {
      expect(result.graph.differences[0]).toMatchObject({
        leftKind: 'negative-zero',
        rightKind: 'number',
      });
    }
  });

  it('vergleicht nie gegen die Quellbytes: Textabweichungen sind kein Verlust', async () => {
    const fixtureText = JSON.stringify(CATALOG_122()).replace('"1.0.0"', '1.0');

    const result = await runNoOpRoundTrip({
      fixtureText,
    });

    // Die Quellbytes enthalten 1.0, die Ausgabe schreibt 1 — der Lauf bleibt
    // grün, weil der Harnisch auf Werten und nicht auf Bytes vergleicht.
    expect(JSON.parse(fixtureText).catalog.metadata.version).toBe(1);
    expect(result.serialization.status).toBe('passed');
    expect(result.graph.status).toBe('passed');
  });

  it('reicht eine fehlgeschlagene Versionsbindung unverändert durch und lässt Folgestufen nicht laufen', async () => {
    const document = CATALOG_122();
    setCatalogOscalVersion(document, '9.9.9');

    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(document),
    });

    expect(result.binding).toMatchObject({ ok: false, reason: 'dispatch-rejected' });
    if (!result.binding.ok && result.binding.reason === 'dispatch-rejected') {
      expect(result.binding.diagnostic.code)
        .toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_UNSUPPORTED);
    }
    expect(result.serialization).toEqual({ status: 'not-run' });
    expect(result.graph).toEqual({ status: 'not-run', differences: [] });
  });

  it('nimmt einen eingespeisten Export entgegen und meldet dessen Abweichung auf beiden Ebenen', async () => {
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(CATALOG_122()),
      exportDocument: (parsed) => {
        const copy = structuredClone(parsed) as Record<string, unknown>;
        const body = copy.catalog as Record<string, unknown>;
        copy.catalog = { ...body, title: undefined };
        delete (copy.catalog as Record<string, unknown>).uuid;
        return copy;
      },
    });

    expect(result.serialization.status).toBe('failed');
    expect(result.graph.status).toBe('failed');
    if (result.graph.status === 'failed') {
      expect(result.graph.differences.some((entry) => entry.kind === 'key-missing')).toBe(true);
    }
    expect(result.identities.findings).toContain('document-uuid-changed');
  });

  it('berichtet den abgeleiteten Root-Typ, nie einen behaupteten', async () => {
    // Es gibt keine rootType-Eingabe: Der Harnisch leitet den Root
    // ausschließlich aus dem Dokument ab und meldet null, solange die Kette
    // keinen gebundenen Root kennt.
    const profileResult = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(makeSchemaValidOscalDocument('profile', '1.2.2')),
    });
    expect(profileResult.rootType).toBe('profile');

    // Passender Registry-Kontext: Der abgeleitete Root bleibt der wahre.
    const catalogResult = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(CATALOG_122()),
      upstreamPath: CATALOG_UPSTREAM_PATH,
    });
    expect(catalogResult.rootType).toBe('catalog');
    expect(catalogResult.binding).toMatchObject({ ok: true });
  });

  it('erzwingt die Registry-Erwartung: Profil-Bytes am Katalog-Artefaktpfad werden abgewiesen', async () => {
    // Greptile-Befund (T-Rex-Reproduktion): Ohne weitergereichten
    // Registry-Kontext lief ein Profil trotz Katalog-Artefaktpfad durch.
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(makeSchemaValidOscalDocument('profile', '1.1.3')),
      upstreamPath: CATALOG_UPSTREAM_PATH,
    });

    expect(result.binding).toMatchObject({
      ok: false,
      reason: 'dispatch-rejected',
      diagnostic: { code: ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_TYPE_MISMATCH },
    });
    if (!result.binding.ok && result.binding.reason === 'dispatch-rejected') {
      expect(result.binding.diagnostic.artifact.key).toBe(CATALOG_ARTIFACT_KEY);
    }
    expect(result.rootType).toBeNull();
  });

  it('prüft Stufe 3 gegen das reimportierte Exportartefakt, nicht gegen die Eingabe', async () => {
    // Greptile-Befund: Ein Export, der ein Pflichtfeld entfernt, meldete
    // Stufe 3 „passed", weil gegen die Eingabe geprüft wurde.
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(CATALOG_122()),
      exportDocument: (parsed) => {
        const copy = structuredClone(parsed) as Record<string, unknown>;
        const body = copy.catalog as Record<string, unknown>;
        const metadata = body.metadata as Record<string, unknown>;
        delete metadata.title;
        return copy;
      },
    });

    expect(result.stages.schemaValidation).toMatchObject({
      stage: 'json-schema',
      status: 'failed',
      diagnostic: { code: 'OSCAL_SCHEMA_REQUIRED_PROPERTY_MISSING' },
    });
    // Die Vergleichsebenen sehen denselben Verlust zusätzlich.
    expect(result.graph.status).toBe('failed');
  });

  it('prüft Stufe 5 gegen das Exportartefakt: ein eingeschmuggeltes unsicheres Protokoll fällt auf', async () => {
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(CATALOG_122()),
      catalogKey: 'gspp',
      exportDocument: (parsed) => {
        const copy = structuredClone(parsed) as Record<string, unknown>;
        const body = copy.catalog as Record<string, unknown>;
        const metadata = body.metadata as Record<string, unknown>;
        metadata.links = [{ href: 'javascript:eingeschmuggelt' }];
        return copy;
      },
    });

    expect(result.stages.references).toMatchObject({ stage: 'reference', status: 'failed' });
    expect(result.serialization.status).toBe('failed');
  });

  it('bindet das Exportartefakt erneut: Ein Katalog, der ein valides Profil exportiert, wird als Profil geprüft', async () => {
    // Greptile-Befund (T-Rex-Reproduktion): Ohne Re-Bindung wurde das
    // exportierte Profil gegen das Katalogschema geprüft und meldete
    // Katalog-Diagnosen. Mit Re-Bindung besteht es Stufe 3 als Profil.
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(CATALOG_122()),
      exportDocument: () =>
        makeSchemaValidOscalDocument('profile', '1.2.2'),
    });

    expect(result.binding).toMatchObject({ ok: true });
    if (result.binding.ok) {
      expect(result.binding.pin.rootKey).toBe('catalog');
    }
    expect(result.stages.schemaValidation).toEqual({
      stage: 'json-schema',
      status: 'passed',
    });
    expect(result.stages.constraints).toMatchObject({ status: 'not-checked' });
    expect(result.stages.references).toEqual({
      stage: 'reference',
      status: 'not-available',
      reason: 'catalog-only-implementation',
    });
  });
});

describe('readDocumentIdentities', () => {
  it('liest uuid und last-modified ohne sie zu verändern', () => {
    const identities = readDocumentIdentities(CATALOG_122());
    expect(identities.documentUuid).toBeTypeOf('string');
    expect(identities.lastModified).toBe('2026-08-16T00:00:00Z');
  });
});

describe('Kataloggescopte Control-Identitäten', () => {
  function catalogWithControl(id: string): unknown {
    const document = CATALOG_122();
    const body = document.catalog as Record<string, unknown>;
    body.controls = [{ id, title: 'Kollisionskandidat' }];
    delete body.groups;
    return document;
  }

  it('sammelt Controls kataloggescopt und Gruppen nach Instanzregel', () => {
    const parsed = makeSchemaValidOscalDocument('catalog', '1.2.2');
    const identities = collectScopedIdentities(parsed, { catalogKey: 'gspp' });

    // Das Minimaldokument führt genau einen Control in einer Gruppe.
    expect(identities.controls).toEqual([
      { scope: 'catalog', catalogKey: 'gspp', controlId: 'ac-1' },
    ]);
    expect(identities.groups).toEqual([
      { scope: 'instance', groupId: 'ac' },
    ]);
  });

  it('löst eine Control ausschließlich innerhalb ihres Katalogs auf', () => {
    const index = buildScopedIdentityIndex([
      { parsed: catalogWithControl('GC.1'), catalogKey: 'catalog-a' },
      { parsed: catalogWithControl('GC.1'), catalogKey: 'catalog-b' },
    ]);

    // Kollidierende IDs bleiben zwei getrennte Einträge; die Auflösung
    // überschreitet nie die Kataloggrenze.
    expect(index.resolveControlIdentity('catalog-a', 'GC.1')).toEqual({
      scope: 'catalog', catalogKey: 'catalog-a', controlId: 'GC.1',
    });
    expect(index.resolveControlIdentity('catalog-b', 'GC.1')).toEqual({
      scope: 'catalog', catalogKey: 'catalog-b', controlId: 'GC.1',
    });
    expect(index.resolveControlIdentity('catalog-c', 'GC.1')).toBeNull();
    expect(index.listControlIdentities()).toHaveLength(2);
  });

  it('ordnet Gruppen instanzlokal zu, auch wenn IDs über Instanzen kollidieren', () => {
    const index = buildScopedIdentityIndex([
      { parsed: makeSchemaValidOscalDocument('catalog', '1.2.2'), catalogKey: 'catalog-a' },
      { parsed: makeSchemaValidOscalDocument('catalog', '1.2.2'), catalogKey: 'catalog-b' },
    ]);

    // Beide Instanzen tragen die Gruppe `ac` — zulässig, denn group/@id ist
    // nur instanzweit eindeutig.
    expect(index.listGroupIdentities()).toEqual([
      { scope: 'instance', groupId: 'ac' },
      { scope: 'instance', groupId: 'ac' },
    ]);
  });
});
