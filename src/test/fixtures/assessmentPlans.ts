import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

export const AP_UUIDS = {
  plan: '00000000-0000-4000-8000-000000000001',
  component: '00000000-0000-4000-8000-000000000002',
  user: '00000000-0000-4000-8000-000000000003',
  inventory: '00000000-0000-4000-8000-000000000004',
  activity: '00000000-0000-4000-8000-000000000005',
  task: '00000000-0000-4000-8000-000000000006',
  child: '00000000-0000-4000-8000-000000000007',
  resource: '00000000-0000-4000-8000-000000000008',
  platform: '00000000-0000-4000-8000-000000000009',
  step: '00000000-0000-4000-8000-000000000010',
  sibling: '00000000-0000-4000-8000-000000000011',
} as const;

export function makeMinimalAssessmentPlan(version: PinnedOscalVersion = '1.2.2') {
  return {
    'assessment-plan': {
      uuid: AP_UUIDS.plan,
      metadata: {
        title: 'Prüfplan',
        version: '1',
        'last-modified': '2026-10-19T00:00:00Z',
        'oscal-version': version,
      },
      'import-ssp': { href: 'ssp.json' },
      'reviewed-controls': { 'control-selections': [{ 'include-all': {} }] },
    },
  };
}

export function makeFullAssessmentPlan() {
  const minimal = makeMinimalAssessmentPlan();
  const subjects = [
    {
      type: 'component',
      'include-subjects': [{ 'subject-uuid': AP_UUIDS.component, type: 'component' }],
    },
  ];
  return {
    'assessment-plan': {
      ...minimal['assessment-plan'],
      metadata: {
        ...minimal['assessment-plan'].metadata,
        roles: [{ id: 'assessor', title: 'Prüfer' }],
      },
      'local-definitions': {
        components: [
          {
            uuid: AP_UUIDS.component,
            type: 'software',
            title: 'Prüfwerkzeug',
            description: '**Rohmarkup**',
            status: { state: 'operational' },
          },
        ],
        users: [
          {
            uuid: AP_UUIDS.user,
            title: 'Beispielnutzer',
            'role-ids': ['assessor'],
          },
        ],
        'inventory-items': [{ uuid: AP_UUIDS.inventory, description: 'Beispielgerät' }],
        'objectives-and-methods': [
          {
            'control-id': 'ac-1',
            parts: [{ id: 'ac-1_obj', name: 'objective', prose: 'Ziel' }],
          },
        ],
        activities: [
          {
            uuid: AP_UUIDS.activity,
            description: '*Interview*',
            props: [
              { name: 'method', value: 'INTERVIEW' },
              {
                ns: 'https://vendor.invalid/ns',
                name: 'secret',
                value: 'foreign-marker',
              },
            ],
            steps: [
              {
                uuid: AP_UUIDS.step,
                description: 'Schritt',
                'reviewed-controls': minimal['assessment-plan']['reviewed-controls'],
              },
            ],
            'related-controls': {
              'control-selections': [
                {
                  'include-controls': [{ 'control-id': 'ac-1', 'statement-ids': ['ac-1_smt'] }],
                },
              ],
              'control-objective-selections': [
                {
                  'include-objectives': [{ 'objective-id': 'ac-1_obj', remarks: 'Auswahl' }],
                },
              ],
            },
          },
        ],
      },
      'terms-and-conditions': {
        parts: [
          {
            name: 'methodology',
            prose: '**Methode**',
            parts: [{ name: 'custom', ns: 'https://vendor.invalid/ns' }],
          },
        ],
      },
      'assessment-subjects': subjects,
      'assessment-assets': {
        'assessment-platforms': [
          {
            uuid: AP_UUIDS.platform,
            title: 'Plattform',
            'uses-components': [{ 'component-uuid': AP_UUIDS.component }],
          },
        ],
      },
      tasks: [
        {
          uuid: AP_UUIDS.task,
          type: 'action',
          title: 'Prüfung',
          timing: {
            'on-date': { date: '2026-10-19T00:00:00Z', remarks: 'Termin' },
          },
          'responsible-roles': [{ 'role-id': 'assessor' }],
          'associated-activities': [{ 'activity-uuid': AP_UUIDS.activity, subjects }],
          subjects,
          tasks: [
            {
              uuid: AP_UUIDS.child,
              type: 'action',
              title: 'Zweite Teilprüfung',
              dependencies: [{ 'task-uuid': AP_UUIDS.task }],
            },
            {
              uuid: AP_UUIDS.sibling,
              type: 'action',
              title: 'Erste Teilprüfung',
              dependencies: [{ 'task-uuid': AP_UUIDS.child }],
            },
          ],
        },
      ],
      'back-matter': {
        resources: [
          {
            uuid: AP_UUIDS.resource,
            base64: {
              'media-type': 'application/octet-stream',
              value: 'c2Vuc2l0aXZl',
            },
          },
        ],
      },
    },
  };
}
