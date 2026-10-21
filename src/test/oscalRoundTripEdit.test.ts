import { describe, expect, it } from 'vitest';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import { setSelectedControl } from '@/domain/profileAuthoring';
import { commitExplicitSave, type ExplicitSaveStamp } from '@/domain/profileSave';
import { makeMaximalOscalDocument } from '@/test/fixtures/oscalRoundTripCorpus';
import { makeProfileSource, profileSpecFor } from '@/test/fixtures/profiles';
import {
  formatRoundTripDifferences,
  OSCAL_ROOT_UUID_POLICY,
  runEditRoundTrip,
  type OscalEditOperation,
  type OscalEditPathSegment,
} from './oscalRoundTrip';

const STAMP: ExplicitSaveStamp = {
  uuid: 'cccccccc-0000-4000-8000-0000000000e1',
  lastModified: '2026-10-20T12:00:00.000Z',
};

type Json = Record<string, unknown>;

const REASSIGN_ROOTS = (Object.keys(OSCAL_ROOT_UUID_POLICY) as OscalRootKey[])
  .filter((root) => OSCAL_ROOT_UUID_POLICY[root] === 'reassign');
const KEEP_ROOTS = (Object.keys(OSCAL_ROOT_UUID_POLICY) as OscalRootKey[])
  .filter((root) => OSCAL_ROOT_UUID_POLICY[root] === 'keep');

const titleEdit = (root: string): OscalEditOperation =>
  ({ op: 'replace', path: [root, 'metadata', 'title'], value: 'Geänderter Titel' });

function containerAt(document: unknown, path: readonly OscalEditPathSegment[]): Json | unknown[] {
  return path.reduce<unknown>((node, segment) => (node as Json)[segment as string], document) as Json;
}

function applyEdit(document: Json, edit: OscalEditOperation): void {
  const parent = containerAt(document, edit.path.slice(0, -1)) as Json;
  const last = edit.path.at(-1) as string;
  if (edit.op === 'replace') parent[last] = edit.value;
  else (parent[last] as unknown[]).push(structuredClone(edit.value));
}

function body(document: unknown): Json {
  return Object.values(document as Json)[0] as Json;
}

/**
 * Testeigener Referenz-Editor: wendet die Edit-Operation an und setzt die
 * Identitäten nach der Politik-Tabelle. Er belegt den Harnisch, nicht den
 * Export eines Adapters.
 */
function referenceEditor(edit: OscalEditOperation) {
  return (parsed: unknown, stamp: ExplicitSaveStamp): unknown => {
    const document = parsed as Json;
    const root = Object.keys(document)[0] as OscalRootKey;
    applyEdit(document, edit);
    if (OSCAL_ROOT_UUID_POLICY[root] === 'reassign') body(document).uuid = stamp.uuid;
    (body(document).metadata as Json)['last-modified'] = stamp.lastModified;
    return document;
  };
}

/** Referenz-Editor mit nachgeschalteter Verfälschung des Exportartefakts. */
function corrupted(edit: OscalEditOperation, corrupt: (document: Json) => void) {
  const editor = referenceEditor(edit);
  return (parsed: unknown, stamp: ExplicitSaveStamp): unknown => {
    const document = editor(parsed, stamp) as Json;
    corrupt(document);
    return document;
  };
}

function maximal(root: OscalRootKey): Json {
  return makeMaximalOscalDocument(root, '1.2.2');
}

async function runReference(document: Json, edit: OscalEditOperation, corrupt?: (document: Json) => void) {
  return runEditRoundTrip({
    fixtureText: JSON.stringify(document),
    edit,
    stamp: STAMP,
    exportDocument: corrupt ? corrupted(edit, corrupt) : referenceEditor(edit),
  });
}

describe('Edit-Lauf: Root-UUID-Politik', () => {
  it('entspricht PERSISTENCE.md §5 und ADR-9 Festlegung 4', () => {
    // Der Referenz-Editor liest dieselbe Konstante; nur diese ausgeschriebene Tabelle fängt einen Politikfehler.
    expect(OSCAL_ROOT_UUID_POLICY).toEqual({
      catalog: 'reassign',
      profile: 'reassign',
      'component-definition': 'reassign',
      'mapping-collection': 'reassign',
      'system-security-plan': 'keep',
      'assessment-plan': 'keep',
      'assessment-results': 'keep',
      'plan-of-action-and-milestones': 'keep',
    });
  });
});

describe('Edit-Lauf: Positivfälle je Root @ 1.2.2', () => {
  it.each(REASSIGN_ROOTS)('%s: neue UUID gleich Stempel, last-modified gleich Stempel', async (root) => {
    const result = await runReference(maximal(root), titleEdit(root));

    expect(result).toMatchObject({
      mode: 'edit',
      status: 'passed',
      rootType: root,
      graph: { status: 'passed', unexpected: [], missing: [] },
      identities: { status: 'passed', findings: [] },
      stages: {
        schemaValidation: { status: 'passed' },
        constraints: { status: 'not-checked' },
      },
    });
    expect(['passed', 'not-available']).toContain(result.stages.references.status);
  });

  it.each(KEEP_ROOTS)('%s: UUID unverändert, last-modified gleich Stempel', async (root) => {
    const result = await runReference(maximal(root), titleEdit(root));

    expect(result).toMatchObject({
      status: 'passed',
      rootType: root,
      graph: { status: 'passed', unexpected: [], missing: [] },
      identities: { status: 'passed', findings: [] },
      stages: { schemaValidation: { status: 'passed' }, references: { status: 'not-available' } },
    });
  });

  it('akzeptiert eine add-Operation mit eigener UUID im angehängten Element', async () => {
    const edit: OscalEditOperation = {
      op: 'add',
      path: ['system-security-plan', 'system-implementation', 'users'],
      value: { uuid: '55555555-5555-4555-8555-5555555509f1', title: 'Zweiter Betreuer' },
    };
    const result = await runReference(maximal('system-security-plan'), edit);

    expect(result.status).toBe('passed');
  });
});

describe('Edit-Lauf: Dokument-UUID und last-modified', () => {
  it('meldet bei einem reassign-Root einen Export ohne UUID-Wechsel', async () => {
    const result = await runReference(maximal('catalog'), titleEdit('catalog'), (document) => {
      body(document).uuid = body(maximal('catalog')).uuid;
    });

    expect(result.status).toBe('failed');
    expect(result.identities.findings).toEqual(['document-uuid-not-reassigned', 'document-uuid-not-stamp']);
    expect(result.graph.missing.map((difference) => difference.path)).toEqual(['$.catalog.uuid']);
  });

  it('meldet bei einem reassign-Root eine UUID ungleich der Stempel-UUID', async () => {
    const result = await runReference(maximal('mapping-collection'), titleEdit('mapping-collection'), (document) => {
      body(document).uuid = 'cccccccc-0000-4000-8000-0000000000e2';
    });

    expect(result.status).toBe('failed');
    expect(result.identities.findings).toEqual(['document-uuid-not-stamp']);
  });

  it('meldet bei einem keep-Root eine neu vergebene Dokument-UUID', async () => {
    const result = await runReference(maximal('assessment-plan'), titleEdit('assessment-plan'), (document) => {
      body(document).uuid = STAMP.uuid;
    });

    expect(result.status).toBe('failed');
    expect(result.identities.findings).toEqual(['document-uuid-changed']);
    expect(result.graph.unexpected.map((difference) => difference.path)).toEqual(['$.assessment-plan.uuid']);
  });

  it.each(['profile', 'plan-of-action-and-milestones'] as const)(
    '%s: meldet fehlendes und falsches last-modified',
    async (root) => {
      const original = (body(maximal(root)).metadata as Json)['last-modified'];
      const kept = await runReference(maximal(root), titleEdit(root), (document) => {
        (body(document).metadata as Json)['last-modified'] = original;
      });
      const wrong = await runReference(maximal(root), titleEdit(root), (document) => {
        (body(document).metadata as Json)['last-modified'] = '2026-10-21T00:00:00.000Z';
      });

      expect(kept.status).toBe('failed');
      expect(kept.identities.findings).toEqual(['last-modified-not-updated', 'last-modified-not-stamp']);
      expect(wrong.status).toBe('failed');
      expect(wrong.identities.findings).toEqual(['last-modified-not-stamp']);
    },
  );
});

describe('Edit-Lauf: Unterobjekt-UUIDs bleiben erhalten', () => {
  const NEW_UUID = '99999999-9999-4999-8999-999999999999';

  function assessmentResultsWithRiskAndFinding(): Json {
    const document = maximal('assessment-results');
    const result = (body(document).results as Json[])[0]!;
    result.risks = [{
      uuid: '77777777-7777-4777-8777-7777777700d4',
      title: 'Korpusrisiko',
      description: 'Synthetisches Risiko.',
      statement: 'Synthetische Risikoaussage.',
      status: 'open',
    }];
    result.findings = [{
      uuid: '77777777-7777-4777-8777-7777777700e5',
      title: 'Korpusbefund',
      description: 'Synthetischer Befund.',
      target: { type: 'objective-id', 'target-id': 'ac-1_obj', status: { state: 'not-satisfied' } },
    }];
    return document;
  }

  function withAction(root: OscalRootKey): Json {
    const document = maximal(root);
    (body(document).metadata as Json).actions = [{
      uuid: '66666666-6666-4666-8666-6666666600a1',
      type: 'approval',
      system: 'https://beispiel.invalid/ns/aktionen',
    }];
    return document;
  }

  const cases: ReadonlyArray<readonly [string, () => Json, readonly OscalEditPathSegment[]]> = [
    ['implemented-requirement (SSP)', () => maximal('system-security-plan'),
      ['system-security-plan', 'control-implementation', 'implemented-requirements', 0]],
    ['by-component (SSP)', () => maximal('system-security-plan'),
      ['system-security-plan', 'control-implementation', 'implemented-requirements', 0, 'statements', 0, 'by-components', 0]],
    ['observation (AR)', assessmentResultsWithRiskAndFinding,
      ['assessment-results', 'results', 0, 'observations', 0]],
    ['risk (AR)', assessmentResultsWithRiskAndFinding, ['assessment-results', 'results', 0, 'risks', 0]],
    ['finding (AR)', assessmentResultsWithRiskAndFinding, ['assessment-results', 'results', 0, 'findings', 0]],
    ['metadata.actions', () => withAction('component-definition'),
      ['component-definition', 'metadata', 'actions', 0]],
    ['back-matter-resource', () => maximal('profile'), ['profile', 'back-matter', 'resources', 1]],
  ];

  it.each(cases)('meldet eine neu vergebene UUID an %s', async (_name, makeDocument, objectPath) => {
    const document = makeDocument();
    const root = Object.keys(document)[0]!;
    const result = await runReference(document, titleEdit(root), (exported) => {
      (containerAt(exported, objectPath) as Json).uuid = NEW_UUID;
    });

    expect(result.status).toBe('failed');
    expect(result.identities.findings).toEqual(['subobject-uuid-changed']);
  });

  it('lässt eine Unterobjekt-UUID zu, die selbst das Ziel der Edit-Operation ist', async () => {
    const result = await runReference(withAction('component-definition'), {
      op: 'replace',
      path: ['component-definition', 'metadata', 'actions', 0, 'uuid'],
      value: NEW_UUID,
    });

    expect(result.status).toBe('passed');
    expect(result.identities.findings).toEqual([]);
  });
});

describe('Edit-Lauf: erwartete Differenzmenge', () => {
  it('meldet eine Zusatzänderung mit Pfad und Wertart, ohne den Dokumentwert', async () => {
    const MARKER = 'streng-geheimer-edit-wert-17';
    const document = maximal('catalog');
    (body(document).metadata as Json).version = MARKER;

    const result = await runReference(document, titleEdit('catalog'), (exported) => {
      (body(exported).metadata as Json).version = '2.0.0';
    });

    expect(result.status).toBe('failed');
    expect(result.graph.missing).toEqual([]);
    const output = formatRoundTripDifferences(result.graph.unexpected);
    expect(output).toEqual(['$.catalog.metadata.version: value-changed (string → string)']);
    expect(JSON.stringify(result)).not.toContain(MARKER);
  });

  it('meldet eine nicht angewendete Edit-Operation als fehlenden erwarteten Eintrag', async () => {
    const edit = titleEdit('component-definition');
    const result = await runEditRoundTrip({
      fixtureText: JSON.stringify(maximal('component-definition')),
      edit,
      stamp: STAMP,
      exportDocument: referenceEditor({ ...edit, value: 'Maximalkorpus ohne reale Organisationsdaten' }),
    });

    expect(result.status).toBe('failed');
    expect(formatRoundTripDifferences(result.graph.missing))
      .toEqual(['$.component-definition.metadata.title: value-changed (string → string)']);
  });

  it('meldet einen Export mit falschem Edit-Wert als fehlenden erwarteten Eintrag', async () => {
    const edit = titleEdit('catalog');
    const result = await runEditRoundTrip({
      fixtureText: JSON.stringify(maximal('catalog')),
      edit,
      stamp: STAMP,
      exportDocument: referenceEditor({ ...edit, value: 'Anderer Titel' }),
    });

    expect(result.graph.unexpected).toEqual([]);
    expect(result.graph.missing.map((difference) => difference.path)).toEqual(['$.catalog.metadata.title']);
  });

  it.each([
    ['umsortiertes Array', (document: Json) => { (body(document).metadata as Json).props = [...((body(document).metadata as Json).props as unknown[])].reverse(); }],
    ['entferntes Array-Element', (document: Json) => { ((body(document).metadata as Json).props as unknown[]).pop(); }],
    ['zusätzliches Array-Element', (document: Json) => { ((body(document).metadata as Json).props as unknown[]).push({ name: 'extra', value: 'x' }); }],
  ] as const)('meldet ein %s außerhalb der Edit-Operation', async (_name, corrupt) => {
    const result = await runReference(maximal('assessment-plan'), titleEdit('assessment-plan'), corrupt);

    expect(result.status).toBe('failed');
    expect(result.graph.unexpected.length).toBeGreaterThan(0);
    expect(result.graph.unexpected.every((difference) =>
      difference.path.startsWith('$.assessment-plan.metadata.props'))).toBe(true);
  });

  it('wirft bei einer Edit-Operation, die nicht zum Fixture passt', async () => {
    await expect(runReference(maximal('catalog'), { op: 'replace', path: ['catalog', 'metadata'], value: 'x' }))
      .rejects.toThrow(TypeError);
    await expect(runReference(maximal('catalog'), { op: 'add', path: ['catalog', 'metadata', 'title'], value: 'x' }))
      .rejects.toThrow(TypeError);
  });

  it('berichtet einen Export ohne JSON-Darstellung, statt zu werfen', async () => {
    const result = await runEditRoundTrip({
      fixtureText: JSON.stringify(maximal('catalog')),
      edit: titleEdit('catalog'),
      stamp: STAMP,
      exportDocument: () => undefined,
    });

    expect(result).toMatchObject({
      status: 'failed',
      binding: { ok: false, reason: 'export-not-serializable' },
      graph: { status: 'not-run' },
      stages: { schemaValidation: { status: 'not-run' } },
    });
  });
});

describe('Edit-Lauf: Stufen und Grenzen am Exportartefakt', () => {
  it.each([
    ['Stufe 3', { op: 'replace', path: ['catalog', 'metadata', 'title'], value: null }, 'schemaValidation'],
    ['Stufe 5', { op: 'replace', path: ['catalog', 'metadata', 'links', 0, 'href'], value: 'javascript:beispiel' }, 'references'],
  ] as const)('setzt den Gesamtstatus auf failed, wenn nur %s scheitert', async (_name, edit, stage) => {
    const result = await runReference(maximal('catalog'), edit);

    expect(result.graph.status).toBe('passed');
    expect(result.identities.status).toBe('passed');
    expect(result.stages[stage].status).toBe('failed');
    expect(result.status).toBe('failed');
  });

  it('weist einen Export oberhalb der Byte-Grenze ab', async () => {
    const result = await runReference(maximal('catalog'), {
      op: 'replace',
      path: ['catalog', 'metadata', 'remarks'],
      value: 'x'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes),
    });

    expect(result).toMatchObject({
      status: 'failed',
      exportLimit: { status: 'failed' },
      graph: { status: 'not-run' },
      stages: { schemaValidation: { status: 'not-run' } },
    });
  });

  it('weist einen Export oberhalb der Objektgraph-Grenze ab', async () => {
    let nested: unknown = 'Blatt';
    for (let depth = 0; depth <= CLASS_2_IMPORT_LIMITS.maxDepth; depth += 1) nested = [nested];
    const result = await runReference(maximal('catalog'), {
      op: 'add',
      path: ['catalog', 'metadata', 'props'],
      value: { name: 'tief', value: 'x', remarks: nested },
    });

    expect(result).toMatchObject({ status: 'failed', exportLimit: { status: 'failed' } });
  });
});

describe('Edit-Lauf: Orakel und Versionsgrenze', () => {
  it('lässt einen Schreibpfad, der den übergebenen Stempel umschreibt, nicht bestehen', async () => {
    const stamp = { ...STAMP };
    const edit = titleEdit('catalog');
    const result = await runEditRoundTrip({
      fixtureText: JSON.stringify(maximal('catalog')),
      edit,
      stamp,
      exportDocument: (parsed, passed) => {
        Object.assign(passed, { uuid: 'cccccccc-0000-4000-8000-0000000000e3', lastModified: '2026-10-22T00:00:00.000Z' });
        return referenceEditor(edit)(parsed, passed);
      },
    });

    expect(result.status).toBe('failed');
    expect(result.identities.findings).toEqual(['document-uuid-not-stamp', 'last-modified-not-stamp']);
    expect(stamp).toEqual(STAMP);
  });

  it('lässt einen Schreibpfad, der den Edit-Wert umschreibt, nicht bestehen', async () => {
    const value: Json = { name: 'neu', value: 'a' };
    const edit: OscalEditOperation = { op: 'add', path: ['catalog', 'metadata', 'props'], value };
    const result = await runEditRoundTrip({
      fixtureText: JSON.stringify(maximal('catalog')),
      edit,
      stamp: STAMP,
      exportDocument: (parsed, stamp) => {
        value.value = 'b';
        return referenceEditor(edit)(parsed, stamp);
      },
    });

    expect(result.status).toBe('failed');
    expect(result.graph.missing.map((difference) => difference.path)).toEqual(['$.catalog.metadata.props[2]']);
  });

  it('lässt einen Schreibpfad, der den Edit-Pfad umschreibt, nicht bestehen', async () => {
    const path: OscalEditPathSegment[] = ['catalog', 'metadata', 'title'];
    const result = await runEditRoundTrip({
      fixtureText: JSON.stringify(maximal('catalog')),
      edit: { op: 'replace', path, value: '1.2.2' },
      stamp: STAMP,
      exportDocument: (parsed, stamp) => {
        path[2] = 'oscal-version';
        return referenceEditor({ op: 'replace', path: ['catalog', 'metadata', 'title'], value: 'Falscher Titel' })(parsed, stamp);
      },
    });

    expect(result.status).toBe('failed');
    expect(result.graph.missing.map((difference) => difference.path)).toEqual(['$.catalog.metadata.title']);
  });

  it('weist einen Edit mit Wechsel der OSCAL-Version ab', async () => {
    const result = await runReference(maximal('catalog'), {
      op: 'replace',
      path: ['catalog', 'metadata', 'oscal-version'],
      value: '1.2.1',
    });

    expect(result).toMatchObject({
      status: 'failed',
      binding: { ok: false, reason: 'export-rebinding-failed', diagnostic: { code: 'OSCAL_EXPORT_VERSION_CHANGED' } },
      stages: { schemaValidation: { status: 'not-run' } },
    });
  });
});

describe('Edit-Lauf: echter Schreibpfad commitExplicitSave()', () => {
  const stored = makeProfileSource(profileSpecFor('profile-gspp'));
  const edit: OscalEditOperation = {
    op: 'add',
    path: ['profile', 'imports', 2, 'include-controls', 0, 'with-ids'],
    value: 'NEU.1',
  };

  it('ist grün mit dem Profil-Speicherpfad', async () => {
    const result = await runEditRoundTrip({
      fixtureText: JSON.stringify(stored),
      edit,
      stamp: STAMP,
      exportDocument: (parsed, stamp) =>
        commitExplicitSave(parsed, setSelectedControl(parsed, 2, 'include', 'NEU.1', true), stamp).source,
    });

    expect(result).toMatchObject({
      status: 'passed',
      rootType: 'profile',
      graph: { status: 'passed' },
      identities: { status: 'passed' },
    });
  });

  it('ist rot, wenn der Schreibpfad bei geändertem Inhalt die UUID behält', async () => {
    const result = await runEditRoundTrip({
      fixtureText: JSON.stringify(stored),
      edit,
      stamp: STAMP,
      exportDocument: (parsed, stamp) => {
        const working = setSelectedControl(parsed, 2, 'include', 'NEU.1', true) as Json;
        (body(working).metadata as Json)['last-modified'] = stamp.lastModified;
        return working;
      },
    });

    expect(result.status).toBe('failed');
    expect(result.identities.findings).toContain('document-uuid-not-reassigned');
  });
});

describe('Edit-Lauf: Determinismus', () => {
  it('liefert zwei Läufe mit identischer Eingabe und identischem Stempel tiefgleich', async () => {
    const first = await runReference(maximal('system-security-plan'), titleEdit('system-security-plan'));
    const second = await runReference(maximal('system-security-plan'), titleEdit('system-security-plan'));

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
