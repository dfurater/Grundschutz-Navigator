import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoNetworkCalls, stubNoNetwork } from '@/test/noNetwork';
import {
  blocksPositiveFinding,
  deriveEvidenceReadModel,
  type EvidenceRootType,
} from '@/domain/evidenceReadModel';

// Synthetische Fixtures ohne reale Evidenzinhalte.
const AT = new Date('2026-06-01T00:00:00Z');
const RES_FILE = '11111111-1111-4111-8111-111111111111';
const RES_EMPTY = '22222222-2222-4222-8222-222222222222';
const OBS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OBS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OBS_FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECRET_DESCRIPTION = 'geheime-beschreibung';
const SECRET_FILENAME = 'geheim-nachweis.pdf';
const SECRET_HASH = 'deadbeef00';
const EXTERNAL_HREF = 'https://evidence.example.test/report';

function observation(uuid: string, extra: Record<string, unknown> = {}) {
  return {
    uuid,
    description: SECRET_DESCRIPTION,
    methods: ['TEST'],
    collected: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function backMatter() {
  return {
    resources: [
      {
        uuid: RES_FILE,
        rlinks: [{ href: EXTERNAL_HREF, 'media-type': 'application/pdf', hashes: [{ algorithm: 'SHA-256', value: SECRET_HASH }] }],
        base64: { filename: SECRET_FILENAME, 'media-type': 'application/pdf', value: 'AAAA' },
      },
      { uuid: RES_EMPTY },
    ],
  };
}

const METADATA = { title: 'T', 'last-modified': '2026-01-02T00:00:00Z', version: '1', 'oscal-version': '1.2.2' };

function assessmentResults(results: unknown[]) {
  return {
    'assessment-results': {
      uuid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      metadata: { ...METADATA, props: [{ name: 'fremd', ns: 'https://ns.example.test', value: 'x' }] },
      'import-ap': { href: '#ap' },
      results,
      'back-matter': backMatter(),
    },
  };
}

function poam(body: Record<string, unknown>) {
  return {
    'plan-of-action-and-milestones': {
      uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      metadata: METADATA,
      'poam-items': [],
      'back-matter': backMatter(),
      ...body,
    },
  };
}

function derive(source: unknown, rootType: EvidenceRootType, contextUuids?: ReadonlySet<string>) {
  return deriveEvidenceReadModel({ source, rootType, oscalVersion: '1.2.2', at: AT, contextUuids });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deriveEvidenceReadModel', () => {
  it('liest Beobachtungen aus allen results eines Assessment-Results-Dokuments', () => {
    const model = derive(
      assessmentResults([{ observations: [observation(OBS_A)] }, { observations: [observation(OBS_B)] }]),
      'assessment-results',
    );
    expect(model.observations.map((entry) => entry.uuid)).toEqual([OBS_A, OBS_B]);
    expect(model.observations[1].path).toBe('/assessment-results/results/1/observations/0');
  });

  it('leitet die Gültigkeit nur aus collected und expires ab', () => {
    const model = derive(
      poam({
        observations: [
          observation(OBS_A),
          observation(OBS_B, { expires: '2026-12-31T00:00:00Z' }),
          observation(OBS_FOREIGN, { expires: '2026-06-01T00:00:00Z' }),
          observation(RES_EMPTY, { collected: 'kein-datum' }),
          observation(RES_EMPTY, { collected: undefined }),
          observation(RES_EMPTY, { expires: 'kein-datum' }),
          observation(RES_EMPTY, { expires: '2026-12-31T00:00:00' }),
          observation(RES_EMPTY, { expires: '2026-12-31' }),
          observation(RES_EMPTY, { expires: '2026-06-01T00:00:00.000001Z' }),
          observation(RES_EMPTY, { expires: '2026-06-01T00:00:00.000000+00:00' }),
        ],
      }),
      'plan-of-action-and-milestones',
    );
    const validity = model.observations.map((entry) => entry.validity);
    expect(validity).toEqual([
      'no-expiry-declared',
      'current',
      'expired',
      'not-evaluable',
      'not-evaluable',
      'not-evaluable',
      'not-evaluable',
      'not-evaluable',
      'current',
      'expired',
    ]);
    expect(validity.map(blocksPositiveFinding)).toEqual([false, false, true, true, true, true, true, true, false, true]);
  });

  it('bewertet vorhandene, nicht lesbare Ablaufwerte und unmögliche Kalenderdaten als not-evaluable', () => {
    const unreadable = [null, 123, {}, '2026-02-30T00:00:00Z', '2027-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z', '2026-12-31T24:00:00Z', '2026-12-31T00:00:00+15:00', '2026-12-31T00:00:00+05:15'];
    const model = derive(
      poam({
        observations: [
          ...unreadable.map((expires) => observation(OBS_A, { expires })),
          observation(OBS_A, { collected: '2026-02-30T00:00:00Z' }),
          observation(OBS_B, { expires: '2028-02-29T00:00:00Z' }),
          observation(OBS_B, { expires: '2026-12-31T23:59:59.123456+05:45' }),
          observation(OBS_B, { expires: '2026-06-01T00:30:00-09:30' }),
        ],
      }),
      'plan-of-action-and-milestones',
    );
    expect(model.observations.map((entry) => entry.validity)).toEqual([
      ...unreadable.map(() => 'not-evaluable'),
      'not-evaluable',
      'current',
      'current',
      'current',
    ]);
  });

  it('erhält undokumentierte methods und types als Rohwert', () => {
    const model = derive(
      poam({ observations: [observation(OBS_A, { methods: ['UNKNOWN', 'ERFUNDEN'], types: ['finding', 'eigen'] })] }),
      'plan-of-action-and-milestones',
    );
    expect(model.observations[0].methods).toEqual([
      { value: 'UNKNOWN', status: 'documented' },
      { value: 'ERFUNDEN', status: 'undocumented' },
    ]);
    expect(model.observations[0].types).toEqual([
      { value: 'finding', status: 'documented' },
      { value: 'eigen', status: 'undocumented' },
    ]);
  });

  it('klassifiziert Evidenzeinträge ohne Netzwerkzugriff', () => {
    const network = stubNoNetwork();
    const model = derive(
      poam({
        observations: [
          observation(OBS_A, {
            'relevant-evidence': [
              { description: SECRET_DESCRIPTION },
              { description: 'd', href: `#${RES_FILE}` },
              { description: 'd', href: EXTERNAL_HREF },
              { description: 'd', href: 'file:///etc/passwd' },
              { description: 'd', links: [{ href: `#${RES_EMPTY}`, 'resource-fragment': 'seite-2' }, { text: 'ohne href' }, { href: 'nachweise/datei.pdf' }] },
            ],
            subjects: [
              { 'subject-uuid': RES_FILE, type: 'resource' },
              { 'subject-uuid': OBS_B, type: 'component' },
              { 'subject-uuid': OBS_FOREIGN, type: 'component' },
            ],
          }),
        ],
      }),
      'plan-of-action-and-milestones',
      new Set([OBS_B]),
    );
    const [descriptive, local, external, unsafe, linked] = model.observations[0].evidence;

    expect(descriptive.kind).toBe('descriptive');
    expect(local.href).toMatchObject({ kind: 'resource', resource: { uuid: RES_FILE, content: 'available' } });
    expect(external.href?.kind).toBe('external');
    expect(unsafe.href).toMatchObject({ kind: 'unresolved', reason: 'unsafe-protocol' });
    expect(linked.links).toHaveLength(2);
    expect(linked.links[0]).toMatchObject({ kind: 'resource', resourceFragment: 'seite-2', resource: { content: 'empty' } });
    expect(linked.links[1]).toMatchObject({ kind: 'unresolved', reason: 'relative' });
    expect(model.observations[0].subjects.map((subject) => subject.state)).toEqual([
      'resolved',
      'resolved-in-context',
      'not-resolvable-in-context',
    ]);
    expect(model.diagnostics).toEqual([]);
    expectNoNetworkCalls(network);
  });

  it('weist leere Ressourcen, Hashes und base64-Metadaten aus, ohne die Nutzlast zu übernehmen', () => {
    const model = derive(poam({}), 'plan-of-action-and-milestones');
    const [file, empty] = model.resources;
    expect(empty).toMatchObject({ uuid: RES_EMPTY, content: 'empty' });
    expect(file.rlinks[0]).toMatchObject({ mediaType: 'application/pdf', integrity: 'declared' });
    expect(file.embeddedContent).toEqual({ filename: SECRET_FILENAME, mediaType: 'application/pdf' });
    expect(JSON.stringify(model)).not.toContain('AAAA');
  });

  it('löst observation-uuid im POA&M gegen Dokument und Kontext auf, ohne Diagnose', () => {
    const source = poam({
      observations: [observation(OBS_A)],
      'poam-items': [
        { 'related-observations': [{ 'observation-uuid': OBS_A.toUpperCase() }, { 'observation-uuid': OBS_FOREIGN }] },
      ],
    });
    expect(derive(source, 'plan-of-action-and-milestones').observationReferences.map((ref) => ref.state)).toEqual([
      'resolved',
      'not-resolvable-in-context',
    ]);
    const withContext = derive(source, 'plan-of-action-and-milestones', new Set([OBS_FOREIGN]));
    expect(withContext.observationReferences[1].state).toBe('resolved-in-context');
    expect(withContext.diagnostics).toEqual([]);
  });

  it('meldet fehlende dokumentinterne Ziele in Assessment Results redigiert, auch bei passendem Kontext', () => {
    const model = derive(
      assessmentResults([
        {
          observations: [observation(OBS_A, { subjects: [{ 'subject-uuid': OBS_FOREIGN, type: 'resource' }] })],
          findings: [{ 'related-observations': [{ 'observation-uuid': OBS_FOREIGN }] }],
        },
      ]),
      'assessment-results',
      new Set([OBS_FOREIGN]),
    );
    expect(model.observationReferences[0].state).toBe('missing-in-document');
    expect(model.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([
      ['OSCAL_EVIDENCE_RESOURCE_NOT_FOUND', '/assessment-results/results/0/observations/0/subjects/0/subject-uuid'],
      [
        'OSCAL_EVIDENCE_OBSERVATION_NOT_FOUND',
        '/assessment-results/results/0/findings/0/related-observations/0/observation-uuid',
      ],
    ]);
    const serialized = JSON.stringify(model.diagnostics);
    for (const secret of [SECRET_DESCRIPTION, SECRET_FILENAME, SECRET_HASH, EXTERNAL_HREF, OBS_FOREIGN]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('ist eine reine Funktion und verändert die Quelle nicht', () => {
    const source = deepFreeze(
      assessmentResults([
        {
          observations: [
            observation(OBS_A, { 'relevant-evidence': [{ description: 'd', links: [{ href: `#${RES_FILE}`, 'resource-fragment': 'f' }] }] }),
          ],
        },
      ]),
    );
    const before = JSON.stringify(source);
    expect(derive(source, 'assessment-results')).toEqual(derive(source, 'assessment-results'));
    expect(JSON.stringify(source)).toBe(before);
  });

  it('liefert ein leeres Modell für einen fehlenden Root', () => {
    expect(derive({ catalog: {} }, 'assessment-results').observations).toEqual([]);
  });
});
