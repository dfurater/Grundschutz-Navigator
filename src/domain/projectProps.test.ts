import { describe, expect, it } from 'vitest';
import {
  PROJECT_PROPS_NAMESPACE,
  PROJECT_PROP_DIAGNOSTIC_CODES,
  PROJECT_PROP_NAMES,
  PROJECT_PROP_REGISTRY,
  createProjectProp,
  isOscalToken,
  normalizeEffortEstimateInput,
  parseCanonicalEffortEstimate,
  readProjectProps,
  validatePlanningMeasureProjectProps,
} from '@/domain/projectProps';
import type { RawOscalProp } from '@/domain/models';

describe('projectProps registry', () => {
  it('registriert exakt die sechs ADR-10-Namen und ist tief eingefroren', () => {
    expect(PROJECT_PROPS_NAMESPACE).toBe(
      'https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props',
    );
    expect(PROJECT_PROP_NAMES).toEqual([
      'implementation-priority',
      'effort-estimate-hours',
      'custom-tag',
      'protection-need-level',
      'assessed-against-catalog-key',
      'assessed-against-catalog-commit',
    ]);
    expect(Object.isFrozen(PROJECT_PROP_NAMES)).toBe(true);
    expect(Object.isFrozen(PROJECT_PROP_REGISTRY)).toBe(true);
    for (const entry of Object.values(PROJECT_PROP_REGISTRY)) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.carriers)).toBe(true);
      expect(Object.isFrozen(entry.cardinality)).toBe(true);
      expect(entry.meaning.length).toBeGreaterThan(0);
      expect(entry.valueContract.length).toBeGreaterThan(0);
      expect(entry.canonicalization).toMatch(/^(identity|decimal-comma-to-point)$/);
      expect('introducedBy' in entry).toBe(false);
    }
    expect(PROJECT_PROP_REGISTRY['effort-estimate-hours'].canonicalization)
      .toBe('decimal-comma-to-point');
  });
});

describe('OSCAL TokenDatatype', () => {
  it.each(['a', '_a', 'ä-1', 'catalog.gspp', 'iso27001-annex-a'])(
    'akzeptiert %s',
    (value) => expect(isOscalToken(value)).toBe(true),
  );

  it.each(['', '1a', '-a', 'a b', 'a/b', 'a:1'])(
    'weist %s ab',
    (value) => expect(isOscalToken(value)).toBe(false),
  );
});

describe('effort-estimate-hours', () => {
  it.each(['0.25', '1.5', '12'])(
    'akzeptiert den kanonischen Speicherwert %s',
    (value) => expect(parseCanonicalEffortEstimate(value)).toBe(value),
  );

  it.each(['0', '-1', '1.234', '1e3', '1 h', '01', '1.0', '1.50', '.5', '1.'])(
    'weist den nichtkanonischen Speicherwert %s ab',
    (value) => expect(parseCanonicalEffortEstimate(value)).toBeNull(),
  );

  it('normalisiert das UI-Dezimalkomma getrennt vom Speicherparser', () => {
    expect(normalizeEffortEstimateInput('1,5')).toBe('1.5');
    expect(normalizeEffortEstimateInput('1.5')).toBe('1.5');
    expect(normalizeEffortEstimateInput('1,234')).toBeNull();
    expect(parseCanonicalEffortEstimate('1,5')).toBeNull();
  });
});

describe('projectProps read contract', () => {
  it('interpretiert fremde Namespaces nicht und erhält Liste und Property referenzidentisch', () => {
    const foreignProp = Object.freeze({
      name: 'future-name',
      ns: 'https://example.invalid/ns',
      value: 'vertraulicher-marker',
    });
    const props = Object.freeze([foreignProp]);

    const result = readProjectProps(props, 'metadata');

    expect(result.preservedProps).toBe(props);
    expect(result.foreignProps).toEqual([foreignProp]);
    expect(result.foreignProps[0]).toBe(foreignProp);
    expect(result.projectProps).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.writeAllowed).toBe(true);
  });

  it('liefert für fehlende Props stabile eingefrorene Leerlisten', () => {
    const first = readProjectProps(undefined, 'metadata');
    const second = readProjectProps(undefined, 'metadata');

    expect(first.preservedProps).toBe(second.preservedProps);
    expect(first.projectProps).toBe(second.projectProps);
    expect(first.foreignProps).toBe(second.foreignProps);
    expect(Object.isFrozen(first.preservedProps)).toBe(true);
  });

  it('sperrt unbekannte Projektnamen, ohne Name oder Wert zu diagnostizieren', () => {
    const marker = 'nicht-in-diagnose-ausgeben';
    const prop = Object.freeze({
      name: marker,
      ns: PROJECT_PROPS_NAMESPACE,
      value: marker,
    });

    const result = readProjectProps(Object.freeze([prop]), 'metadata');

    expect(result.preservedProps[0]).toBe(prop);
    expect(result.projectProps).toEqual([]);
    expect(result.writeAllowed).toBe(false);
    expect(result.diagnostics[0].code).toBe(PROJECT_PROP_DIAGNOSTIC_CODES.UNKNOWN);
    expect(JSON.stringify(result.diagnostics)).not.toContain(marker);
  });

  it('prüft den Namen vor der Registry-Auflösung', () => {
    const result = readProjectProps([
      { name: '1future', ns: PROJECT_PROPS_NAMESPACE, value: 'secret' },
    ], 'metadata');

    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      PROJECT_PROP_DIAGNOSTIC_CODES.NAME_INVALID,
    ]);
  });

  it('prüft auch bei unbekanntem Projektnamen eine vorhandene Gruppe', () => {
    const marker = 'ungültige gruppe';
    const result = readProjectProps([
      {
        name: 'future-name',
        ns: PROJECT_PROPS_NAMESPACE,
        value: 'secret',
        group: marker,
      },
    ], 'metadata');

    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      PROJECT_PROP_DIAGNOSTIC_CODES.GROUP_INVALID,
      PROJECT_PROP_DIAGNOSTIC_CODES.UNKNOWN,
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain(marker);
  });

  it('weist einen bekannten Namen auf dem falschen Träger redigiert ab', () => {
    const result = readProjectProps([
      { name: 'custom-tag', ns: PROJECT_PROPS_NAMESPACE, value: 'intern' },
    ], 'metadata');

    expect(result.writeAllowed).toBe(false);
    expect(result.diagnostics[0].code).toBe(
      PROJECT_PROP_DIAGNOSTIC_CODES.CARRIER_INVALID,
    );
    expect(result.diagnostics[0].path).toBe('/metadata/props');
    expect(JSON.stringify(result.diagnostics)).not.toContain('intern');
  });

  it.each<[RawOscalProp, Parameters<typeof readProjectProps>[1]]>([
    [{ name: 'implementation-priority', value: 'high', ns: PROJECT_PROPS_NAMESPACE }, 'metadata'],
    [{ name: 'effort-estimate-hours', value: '1.5', ns: PROJECT_PROPS_NAMESPACE }, 'metadata'],
    [{ name: 'custom-tag', value: 'intern', ns: PROJECT_PROPS_NAMESPACE }, 'poam-item'],
    [{ name: 'protection-need-level', value: 'hoch', ns: PROJECT_PROPS_NAMESPACE, remarks: 'Grund' }, 'metadata'],
    [{ name: 'assessed-against-catalog-key', value: 'gspp', ns: PROJECT_PROPS_NAMESPACE, group: 'gspp' }, 'poam-item'],
    [{ name: 'assessed-against-catalog-commit', value: '0123456789abcdef0123456789abcdef01234567', ns: PROJECT_PROPS_NAMESPACE, group: 'gspp' }, 'poam-item'],
  ])('weist %s auf einem unzulässigen Träger ab', (prop, carrier) => {
    expect(readProjectProps([prop], carrier).diagnostics[0]?.code).toBe(
      PROJECT_PROP_DIAGNOSTIC_CODES.CARRIER_INVALID,
    );
  });

  it('weist eine ungültige vorhandene Gruppe ab', () => {
    const marker = 'ungültige gruppe';
    const result = readProjectProps([
      {
        name: 'implementation-priority',
        ns: PROJECT_PROPS_NAMESPACE,
        value: 'high',
        group: marker,
      },
    ], 'poam-item');

    expect(result.diagnostics[0]?.code).toBe(PROJECT_PROP_DIAGNOSTIC_CODES.GROUP_INVALID);
    expect(JSON.stringify(result.diagnostics)).not.toContain(marker);
  });

  it.each([
    ['implementation-priority', 'urgent', 'poam-item', undefined],
    ['effort-estimate-hours', '1 h', 'remediation', undefined],
    ['custom-tag', ' intern', 'implemented-requirement', undefined],
    ['custom-tag', '', 'implemented-requirement', undefined],
    ['protection-need-level', 'mittel', 'system-component', 'Begründung'],
  ] as const)('weist den ungültigen Wert für %s ab', (name, value, carrier, remarks) => {
    const result = readProjectProps([
      { name, value, ns: PROJECT_PROPS_NAMESPACE, remarks },
    ], carrier);

    expect(result.diagnostics[0]?.code).toBe(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID);
    if (value.length > 0) {
      expect(JSON.stringify(result.diagnostics)).not.toContain(value);
    }
  });

  it('verlangt nichtleere remarks beim Schutzbedarf', () => {
    const result = readProjectProps([
      {
        name: 'protection-need-level',
        value: 'hoch',
        ns: PROJECT_PROPS_NAMESPACE,
        remarks: '   ',
      },
    ], 'system-component');

    expect(result.diagnostics[0]?.code).toBe(
      PROJECT_PROP_DIAGNOSTIC_CODES.REMARKS_REQUIRED,
    );
  });

  it('begrenzt singuläre Projektproperties auf eine Instanz je Träger', () => {
    const props = [
      { name: 'implementation-priority', value: 'high', ns: PROJECT_PROPS_NAMESPACE },
      { name: 'implementation-priority', value: 'low', ns: PROJECT_PROPS_NAMESPACE },
    ];

    const result = readProjectProps(props, 'poam-item');

    expect(result.diagnostics.map(({ code }) => code)).toContain(
      PROJECT_PROP_DIAGNOSTIC_CODES.CARDINALITY_INVALID,
    );
  });

  it('verlangt case-insensitiv eindeutige custom-tags', () => {
    const props = [
      { name: 'custom-tag', value: 'Intern', ns: PROJECT_PROPS_NAMESPACE },
      { name: 'custom-tag', value: 'intern', ns: PROJECT_PROPS_NAMESPACE },
    ];

    const result = readProjectProps(props, 'implemented-requirement');

    expect(result.diagnostics.map(({ code }) => code)).toContain(
      PROJECT_PROP_DIAGNOSTIC_CODES.DUPLICATE_VALUE,
    );
  });
});

describe('projectProps writer', () => {
  it.each([
    [{ name: 'implementation-priority', value: 'high', carrier: 'poam-item' }],
    [{ name: 'effort-estimate-hours', value: '1.5', carrier: 'remediation' }],
    [{ name: 'custom-tag', value: 'intern', carrier: 'implemented-requirement' }],
    [{ name: 'protection-need-level', value: 'normal', carrier: 'inventory-item', remarks: 'Begründung' }],
    [{ name: 'assessed-against-catalog-key', value: 'gspp', carrier: 'metadata', group: 'gspp' }],
    [{ name: 'assessed-against-catalog-commit', value: '0123456789abcdef0123456789abcdef01234567', carrier: 'metadata', group: 'gspp' }],
  ] as const)('erzeugt ein gültiges, eingefrorenes %s', (input) => {
    const result = createProjectProp(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prop).toMatchObject({
      name: input.name,
      value: input.value,
      ns: PROJECT_PROPS_NAMESPACE,
    });
    expect(Object.isFrozen(result.prop)).toBe(true);
  });

  it('gibt bei ungültiger Eingabe nur eine redigierte Diagnose zurück', () => {
    const marker = 'nicht-ausgeben';
    const result = createProjectProp({
      name: 'custom-tag',
      value: marker,
      carrier: 'metadata',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe(PROJECT_PROP_DIAGNOSTIC_CODES.CARRIER_INVALID);
    expect(JSON.stringify(result.diagnostic)).not.toContain(marker);
  });

  it('verwendet für eine ungültige Gruppe dieselbe redigierte Prüfung wie der Lesepfad', () => {
    const marker = 'ungültige gruppe';
    const result = createProjectProp({
      name: 'implementation-priority',
      value: 'high',
      carrier: 'poam-item',
      group: marker,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe(PROJECT_PROP_DIAGNOSTIC_CODES.GROUP_INVALID);
    expect(JSON.stringify(result.diagnostic)).not.toContain(marker);
  });

  it.each([
    ['1future', PROJECT_PROP_DIAGNOSTIC_CODES.NAME_INVALID],
    ['future-name', PROJECT_PROP_DIAGNOSTIC_CODES.UNKNOWN],
  ] as const)('weist den Laufzeitnamen %s im Writer redigiert ab', (name, code) => {
    const marker = 'nicht-ausgeben';
    const result = createProjectProp({
      name: name as never,
      value: marker,
      carrier: 'metadata',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe(code);
    expect(JSON.stringify(result.diagnostic)).not.toContain(name);
    expect(JSON.stringify(result.diagnostic)).not.toContain(marker);
  });
});

describe('metadata catalog reference pairs', () => {
  const validSha = '0123456789abcdef0123456789abcdef01234567';

  function catalogKey(value: string, group = value): RawOscalProp {
    return {
      name: 'assessed-against-catalog-key',
      ns: PROJECT_PROPS_NAMESPACE,
      value,
      group,
    };
  }

  function catalogCommit(group: string, value = validSha): RawOscalProp {
    return {
      name: 'assessed-against-catalog-commit',
      ns: PROJECT_PROPS_NAMESPACE,
      value,
      group,
    };
  }

  it('akzeptiert die vollständige Abwesenheit und ein vollständiges Paar', () => {
    expect(readProjectProps(undefined, 'metadata').writeAllowed).toBe(true);
    expect(readProjectProps([catalogKey('gspp'), catalogCommit('gspp')], 'metadata'))
      .toMatchObject({ writeAllowed: true, diagnostics: [] });
  });

  it('akzeptiert mehrere vollständige Paare mit verschiedenen bekannten Katalogen', () => {
    const result = readProjectProps([
      catalogKey('gspp'),
      catalogCommit('gspp'),
      catalogKey('wlan'),
      catalogCommit('wlan'),
    ], 'metadata');

    expect(result.writeAllowed).toBe(true);
  });

  it.each([
    [[catalogKey('gspp')], PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_INCOMPLETE],
    [[catalogCommit('gspp')], PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_INCOMPLETE],
    [[catalogKey('gspp'), catalogKey('gspp'), catalogCommit('gspp')], PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_DUPLICATE],
    [[catalogKey('gspp'), catalogCommit('wlan')], PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_GROUP_MISMATCH],
    [[catalogKey('unbekannt'), catalogCommit('unbekannt')], PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_KEY_INVALID],
    [[catalogKey('gspp', 'wlan'), catalogCommit('wlan')], PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_KEY_INVALID],
  ] as const)('sperrt ein ungültiges Katalogpaar', (props, code) => {
    const result = readProjectProps(props, 'metadata');

    expect(result.writeAllowed).toBe(false);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(code);
  });

  it.each([
    validSha.toUpperCase(),
    validSha.slice(1),
    `${validSha}0`,
    `${validSha.slice(0, -1)}g`,
  ])('weist den ungültigen Commit %s redigiert ab', (value) => {
    const result = readProjectProps([catalogKey('gspp'), catalogCommit('gspp', value)], 'metadata');

    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_COMMIT_INVALID,
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain(value);
  });
});

describe('explicit planning measure context', () => {
  it.each([
    [[{ name: 'implementation-priority', value: 'high' }]],
    [[{ name: 'effort-estimate-hours', value: '1.5' }]],
  ] as const)('akzeptiert Planungsprops auf genau einem expliziten Träger', (plainProps) => {
    const props = plainProps.map((prop) => ({ ...prop, ns: PROJECT_PROPS_NAMESPACE }));

    expect(validatePlanningMeasureProjectProps({ poamItemProps: props }).writeAllowed).toBe(true);
    expect(validatePlanningMeasureProjectProps({ remediationProps: props }).writeAllowed).toBe(true);
  });

  it('sperrt dieselbe explizit zugeordnete Maßnahme bei beiden Trägern', () => {
    const prop = {
      name: 'implementation-priority',
      ns: PROJECT_PROPS_NAMESPACE,
      value: 'high',
    } as const;

    const result = validatePlanningMeasureProjectProps({
      poamItemProps: [prop],
      remediationProps: [prop],
    });

    expect(result.writeAllowed).toBe(false);
    expect(result.diagnostics.at(-1)?.code).toBe(
      PROJECT_PROP_DIAGNOSTIC_CODES.MEASURE_CARRIER_CONFLICT,
    );
    expect(result.diagnostics.at(-1)?.path).toBe('/plan-of-action-and-milestones');
  });

  it('sperrt auch verschiedene Planungsprops derselben Maßnahme auf beiden Trägern', () => {
    const result = validatePlanningMeasureProjectProps({
      poamItemProps: [{
        name: 'implementation-priority',
        ns: PROJECT_PROPS_NAMESPACE,
        value: 'high',
      }],
      remediationProps: [{
        name: 'effort-estimate-hours',
        ns: PROJECT_PROPS_NAMESPACE,
        value: '1.5',
      }],
    });

    expect(result.diagnostics.at(-1)?.code).toBe(
      PROJECT_PROP_DIAGNOSTIC_CODES.MEASURE_CARRIER_CONFLICT,
    );
  });

  it('errät ohne expliziten zweiten Träger keinen Konflikt', () => {
    const prop = {
      name: 'implementation-priority',
      ns: PROJECT_PROPS_NAMESPACE,
      value: 'high',
    } as const;

    expect(validatePlanningMeasureProjectProps({ poamItemProps: [prop] }).diagnostics).toEqual([]);
  });
});
