import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { AP_UUIDS } from '@/test/fixtures/assessmentPlans';

// Synthetische, anonymisierte Werte; keine realen Organisations- oder Evidenzdaten.
export const AR_UUIDS = {
  results: '00000000-0000-4000-8000-000000000101',
  result: '00000000-0000-4000-8000-000000000102',
  observation: '00000000-0000-4000-8000-000000000103',
  expiredObservation: '00000000-0000-4000-8000-000000000104',
  finding: '00000000-0000-4000-8000-000000000105',
  bareFinding: '00000000-0000-4000-8000-000000000106',
  risk: '00000000-0000-4000-8000-000000000107',
  response: '00000000-0000-4000-8000-000000000108',
  component: '00000000-0000-4000-8000-000000000109',
  party: '00000000-0000-4000-8000-000000000110',
  resource: '00000000-0000-4000-8000-000000000111',
  task: '00000000-0000-4000-8000-000000000112',
  logEntry: '00000000-0000-4000-8000-000000000113',
  statement: '00000000-0000-4000-8000-000000000114',
  missing: '00000000-0000-4000-8000-0000000001ff',
} as const;

export function makeMinimalAssessmentResults(version: PinnedOscalVersion = '1.2.2') {
  return {
    'assessment-results': {
      uuid: AR_UUIDS.results,
      metadata: {
        title: 'Prüfergebnis',
        version: '1',
        'last-modified': '2026-10-22T00:00:00Z',
        'oscal-version': version,
      },
      'import-ap': { href: 'ap.json' },
      results: [
        {
          uuid: AR_UUIDS.result,
          title: 'Prüfung',
          description: 'Nur Prüfumfang und Beginn.',
          start: '2026-10-01T00:00:00Z',
          'reviewed-controls': { 'control-selections': [{ 'include-all': {} }] },
        },
      ],
    },
  };
}

export function makeFullAssessmentResults() {
  const minimal = makeMinimalAssessmentResults();
  const [result] = minimal['assessment-results'].results;
  const origins = [{ actors: [{ type: 'party', 'actor-uuid': AR_UUIDS.party }] }];
  return {
    'assessment-results': {
      ...minimal['assessment-results'],
      metadata: {
        ...minimal['assessment-results'].metadata,
        parties: [{ uuid: AR_UUIDS.party, type: 'person', name: 'Prüferin' }],
      },
      results: [
        {
          ...result,
          end: '2026-10-02T00:00:00Z',
          'local-definitions': {
            components: [
              {
                uuid: AR_UUIDS.component,
                type: 'software',
                title: 'Dienst',
                description: 'Geprüfter Dienst',
                status: { state: 'operational' },
              },
            ],
            tasks: [{ uuid: AR_UUIDS.task, type: 'action', title: 'Interview' }],
          },
          'assessment-log': {
            entries: [{ uuid: AR_UUIDS.logEntry, start: '2026-10-01T08:00:00Z' }],
          },
          observations: [
            {
              uuid: AR_UUIDS.observation,
              description: '<script>alert(1)</script>',
              methods: ['INTERVIEW'],
              collected: '2026-10-01T00:00:00Z',
              expires: '2099-01-01T00:00:00Z',
              origins: [
                {
                  actors: [{ type: 'party', 'actor-uuid': AR_UUIDS.party }],
                  'related-tasks': [{ 'task-uuid': AR_UUIDS.task }],
                },
              ],
              subjects: [{ 'subject-uuid': AR_UUIDS.component, type: 'component' }],
              'relevant-evidence': [{ href: `#${AR_UUIDS.resource}`, description: 'Protokoll' }],
            },
            {
              uuid: AR_UUIDS.expiredObservation,
              description: 'Abgelaufene Beobachtung',
              methods: ['EXAMINE'],
              collected: '2025-01-01T00:00:00Z',
              expires: '2025-06-01T00:00:00Z',
            },
          ],
          risks: [
            {
              uuid: AR_UUIDS.risk,
              title: 'Risiko',
              description: 'Beschreibung',
              statement: 'Aussage',
              status: 'open',
              origins,
              'threat-ids': [{ system: 'https://threats.invalid', id: 'https://threats.invalid/T-1', href: 'https://threats.invalid/T-1.json' }],
              characterizations: [
                {
                  origin: origins[0],
                  facets: [{ name: 'likelihood', system: 'https://facets.invalid', value: 'low' }],
                },
              ],
              remediations: [
                { uuid: AR_UUIDS.response, lifecycle: 'planned', title: 'Maßnahme', description: 'Plan' },
              ],
              'risk-log': {
                entries: [
                  {
                    uuid: AR_UUIDS.logEntry,
                    start: '2026-10-02T00:00:00Z',
                    'status-change': 'open',
                    'related-responses': [{ 'response-uuid': AR_UUIDS.response }],
                  },
                ],
              },
              'related-observations': [{ 'observation-uuid': AR_UUIDS.observation }],
            },
          ],
          findings: [
            {
              uuid: AR_UUIDS.finding,
              title: 'Finding',
              description: 'Abweichung',
              target: {
                type: 'objective-id',
                'target-id': 'ac-1_obj',
                status: { state: 'not-satisfied' },
              },
              'implementation-statement-uuid': AR_UUIDS.statement,
              'related-observations': [{ 'observation-uuid': AR_UUIDS.observation }],
              'related-risks': [{ 'risk-uuid': AR_UUIDS.risk }],
            },
            {
              uuid: AR_UUIDS.bareFinding,
              title: 'Finding ohne Beleg',
              description: 'Nur Ziel',
              target: { type: 'statement-id', 'target-id': 'ac-1_smt', status: { state: 'satisfied' } },
            },
          ],
        },
      ],
      'back-matter': {
        resources: [
          {
            uuid: AR_UUIDS.resource,
            // Deklarierter Typ widerspricht der Nutzlast; er bleibt eine unbestätigte Behauptung.
            base64: { filename: 'protokoll.pdf', 'media-type': 'application/pdf', value: 'PHNjcmlwdD4=' },
          },
        ],
      },
    },
  };
}

/** Assessment Plan, auf den `import-ap` zeigt; trägt die Aufgabe, auf die AR-Herkünfte verweisen können. */
export function makeBoundAssessmentPlanSource() {
  return {
    'assessment-plan': {
      uuid: AP_UUIDS.plan,
      metadata: {
        title: 'Prüfplan',
        version: '1',
        'last-modified': '2026-10-19T00:00:00Z',
        'oscal-version': '1.2.2',
      },
      'import-ssp': { href: 'ssp.json' },
      'reviewed-controls': { 'control-selections': [{ 'include-all': {} }] },
      tasks: [{ uuid: AP_UUIDS.task, type: 'action', title: 'Planaufgabe' }],
    },
  };
}

export type Refs = Record<string, string>[];
/** Bearbeitbare Sicht auf das erste Ergebnis des Vollfalls; dessen erste Einträge tragen alle Felder. */
export interface FixtureResult {
  observations: { origins: { actors: Refs; 'related-tasks'?: Refs }[] }[];
  findings: { 'related-observations': Refs; 'related-risks': Refs }[];
  'local-definitions': { tasks: Record<string, unknown>[] };
}
export const firstResult = (source: ReturnType<typeof makeFullAssessmentResults>) =>
  source['assessment-results'].results[0] as unknown as FixtureResult;
