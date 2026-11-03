import { describe, expect, it } from 'vitest';
import {
  PROCESS_CIA_ACTIONS_SYSTEM,
  PROJECT_PROPS_NAMESPACE as ns,
  PROJECT_PROP_DIAGNOSTIC_CODES as codes,
  PROJECT_PROP_REGISTRY,
  actionProjectPropCarrier,
  componentProjectPropCarrier,
  createProjectProp,
  readProjectProps,
  validateBusinessProcessProjectProps,
  type ProjectPropCarrier,
} from '@/domain/projectProps';
import type { RawOscalProp } from '@/domain/models';

const UUID = 'aaaaaaaa-0000-4000-8000-000000000003';
const HASH = `process-cia/3:sha-256:${'0123456789abcdef'.repeat(4)}`;

function prop(name: string, value: string, extra: Partial<RawOscalProp> = {}): RawOscalProp {
  return { ns, name, value, ...extra };
}

function codesOf(props: readonly RawOscalProp[], carrier: ProjectPropCarrier): string[] {
  return readProjectProps(props, carrier).diagnostics.map(({ code }) => code);
}

describe('Prozess-Träger', () => {
  it('erkennt Geschäftsprozesse nur am exakten Typ und Aktionen nur am Prozessaktionssystem', () => {
    expect(componentProjectPropCarrier({ type: 'business-process' })).toBe('business-process');
    expect(componentProjectPropCarrier({ type: 'Business-Process' })).toBe('system-component');
    expect(componentProjectPropCarrier({ type: 'software' })).toBe('system-component');
    expect(componentProjectPropCarrier(null)).toBe('system-component');
    expect(actionProjectPropCarrier({ system: PROCESS_CIA_ACTIONS_SYSTEM })).toBe('metadata-action');
    expect(actionProjectPropCarrier({ system: 'https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/actions' })).toBeNull();
    expect(actionProjectPropCarrier({ system: `${PROCESS_CIA_ACTIONS_SYSTEM}/` })).toBeNull();
    expect(actionProjectPropCarrier([])).toBeNull();
  });

  it('führt Pointer für Prozess- und Aktionspositionen', () => {
    const wrong = [prop('process-priority', '0')];
    expect(readProjectProps(wrong, { carrier: 'business-process', componentIndex: 2 }).diagnostics[0].path)
      .toBe('/system-security-plan/system-implementation/components/2/props');
    expect(readProjectProps(wrong, { carrier: 'metadata-action', actionIndex: 1 }).diagnostics[0].path)
      .toBe('/system-security-plan/metadata/actions/1/props');
    expect(readProjectProps(wrong, 'metadata-action').diagnostics[0].path).toBe('/project-props/metadata-action');
    expect(readProjectProps([], { carrier: 'metadata-action', actionIndex: -1 } as never).carrier).toBeNull();
  });

  it('lässt Zielobjektnamen am Geschäftsprozess zu und behält deren Vertrag', () => {
    const level = prop('protection-need-level', 'hoch', { remarks: 'Grund' });
    expect(readProjectProps([level], 'business-process').writeAllowed).toBe(true);
    expect(codesOf([prop('protection-need-level', 'hoch')], 'business-process')).toEqual([codes.REMARKS_REQUIRED]);
    expect(readProjectProps([prop('protection-need-coverage', 'complete')], 'business-process').writeAllowed).toBe(false);
    expect(PROJECT_PROP_REGISTRY['protection-need-level'].carriers).toEqual(['system-component', 'inventory-item', 'information-type']);
  });
});

describe('Prozessnamen: Träger', () => {
  const componentNames = [
    ['process-id', 'P-01'], ['process-application-uuid', UUID], ['process-priority', '1'],
    ['process-protection-integrity', 'hoch'],
  ] as const;
  it.each(componentNames)('%s ist an anderen Komponentenarten und Trägern ein Projektfehler', (name, value) => {
    const candidate = prop(name, value, { remarks: 'Grund' });
    expect(readProjectProps([candidate], 'business-process').writeAllowed).toBe(true);
    for (const carrier of ['system-component', 'inventory-item', 'information-type', 'metadata', 'metadata-action'] as const) {
      expect(codesOf([candidate], carrier)).toContain(codes.CARRIER_INVALID);
    }
  });

  it.each([
    ['process-category-label', 'Kritisch'], ['process-category-definition', 'Definition'], ['process-category-mapping', 'hoch'],
  ] as const)('%s gilt nur an Metadaten', (name, value) => {
    const candidate = prop(name, value, { group: 'cat-kritisch', remarks: 'Grund' });
    expect(readProjectProps([candidate], 'metadata').writeAllowed).toBe(true);
    expect(codesOf([candidate], 'business-process')).toContain(codes.CARRIER_INVALID);
    expect(codesOf([candidate], 'metadata-action')).toContain(codes.CARRIER_INVALID);
  });

  it.each([
    ['process-cia-process-uuid', UUID], ['process-cia-sequence', '1'], ['process-cia-content-hash', HASH], ['process-cia-withdraws', UUID],
  ] as const)('%s gilt nur an Prozessaktionen', (name, value) => {
    const candidate = prop(name, value);
    expect(readProjectProps([candidate], 'metadata-action').writeAllowed).toBe(true);
    expect(codesOf([candidate], 'metadata')).toContain(codes.CARRIER_INVALID);
    expect(codesOf([candidate], 'business-process')).toContain(codes.CARRIER_INVALID);
  });

  it('deutet gleichnamige Properties fremder Namespaces nicht', () => {
    const foreign = { ...prop('process-priority', 'nicht numerisch'), ns: 'https://example.invalid/props' };
    const result = readProjectProps([foreign], 'system-component');
    expect(result.writeAllowed).toBe(true);
    expect(result.foreignProps).toEqual([foreign]);
  });
});

describe('Prozessnamen: Werte', () => {
  it.each([
    ['process-id', 'P-01', true], ['process-id', ' ', false], ['process-id', '', false],
    ['process-application-uuid', UUID, true], ['process-application-uuid', UUID.toUpperCase(), true],
    ['process-application-uuid', 'kein-uuid', false], ['process-application-uuid', 'aaaaaaaa-0000-1000-8000-000000000003', false],
    ['process-priority', '1', true], ['process-priority', '9007199254740991', true],
    ['process-priority', '0', false], ['process-priority', '9007199254740992', false], ['process-priority', '01', false],
    ['process-priority', '-1', false], ['process-priority', '9'.repeat(1_000_000), false], ['process-priority', '00000000000000001', false], ['process-priority', '1.0', false], ['process-priority', '1e3', false], ['process-priority', '١', false],
  ] as const)('%s = %j ist gültig: %s', (name, value, valid) => {
    expect(readProjectProps([prop(name, value)], 'business-process').writeAllowed).toBe(valid);
  });

  it.each(['process-protection-confidentiality', 'process-protection-integrity', 'process-protection-availability'])(
    '%s verlangt normal/hoch mit Begründung', (name) => {
      expect(readProjectProps([prop(name, 'normal', { remarks: 'Grund' })], 'business-process').writeAllowed).toBe(true);
      expect(readProjectProps([prop(name, 'hoch', { remarks: 'Grund' })], 'business-process').writeAllowed).toBe(true);
      expect(codesOf([prop(name, 'sehr hoch', { remarks: 'Grund' })], 'business-process')).toEqual([codes.VALUE_INVALID]);
      expect(codesOf([prop(name, 'hoch', { remarks: '  ' })], 'business-process')).toEqual([codes.REMARKS_REQUIRED]);
      expect(codesOf([prop(name, 'hoch')], 'business-process')).toEqual([codes.REMARKS_REQUIRED]);
    },
  );

  it('verlangt beim Nullfall exakt true mit Begründung', () => {
    expect(readProjectProps([prop('process-applications-none', 'true', { remarks: 'Rein manuell' })], 'business-process').writeAllowed).toBe(true);
    expect(codesOf([prop('process-applications-none', 'TRUE', { remarks: 'Grund' })], 'business-process')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([prop('process-applications-none', 'true')], 'business-process')).toEqual([codes.REMARKS_REQUIRED]);
  });

  it('prüft die Kategorieverwendung je Schutzziel', () => {
    const use = (group: string | undefined, value = 'cat-kritisch') => prop('process-protection-category', value, group === undefined ? {} : { group });
    for (const group of ['confidentiality', 'integrity', 'availability']) {
      expect(readProjectProps([use(group)], 'business-process').writeAllowed).toBe(true);
    }
    expect(codesOf([use('vertraulichkeit')], 'business-process')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([use('integrity', 'kein token')], 'business-process')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([use(undefined)], 'business-process')).toContain(codes.GROUP_INVALID);
    expect(readProjectProps([use('integrity'), use('availability')], 'business-process').writeAllowed).toBe(true);
    expect(codesOf([use('integrity'), use('integrity', 'cat-normal')], 'business-process')).toEqual([codes.CARDINALITY_INVALID]);
  });

  it('prüft Kategoriedefinitionen in den Metadaten', () => {
    const category = (name: string, value: string, group = 'cat-kritisch', remarks?: string) =>
      prop(name, value, { group, ...(remarks === undefined ? {} : { remarks }) });
    expect(codesOf([category('process-category-label', ' ')], 'metadata')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([category('process-category-definition', '')], 'metadata')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([category('process-category-mapping', 'hoch')], 'metadata')).toEqual([codes.REMARKS_REQUIRED]);
    expect(codesOf([category('process-category-mapping', 'kritisch', 'cat-kritisch', 'Grund')], 'metadata')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([category('process-category-mapping', 'hoch', 'cat-kritisch', 'Grund'), category('process-category-mapping', 'normal', 'cat-kritisch', 'Grund')], 'metadata'))
      .toEqual([codes.CARDINALITY_INVALID]);
    expect(codesOf([category('process-category-label', 'Kritisch'), category('process-category-label', ' kritisch', 'cat-zwei')], 'metadata'))
      .toEqual([codes.DUPLICATE_VALUE]);
    expect(codesOf([category('process-category-label', 'Kritisch'), category('process-category-label', 'Kritisch')], 'metadata'))
      .toEqual(expect.arrayContaining([codes.DUPLICATE_VALUE, codes.CARDINALITY_INVALID]));
    expect(readProjectProps([category('process-category-label', 'Kritisch'), category('process-category-label', 'Normal', 'cat-normal')], 'metadata').writeAllowed).toBe(true);
    expect(codesOf([prop('process-category-label', 'Kritisch', { group: 'kein token' })], 'metadata')).toContain(codes.GROUP_INVALID);
  });

  it('prüft Aktionswerte', () => {
    expect(codesOf([prop('process-cia-content-hash', HASH.replace('process-cia/3', 'process-cia/2'))], 'metadata-action')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([prop('process-cia-content-hash', HASH.toUpperCase())], 'metadata-action')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([prop('process-cia-content-hash', HASH.slice(0, -1))], 'metadata-action')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([prop('process-cia-sequence', '0')], 'metadata-action')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([prop('process-cia-sequence', '9007199254740992')], 'metadata-action')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([prop('process-cia-process-uuid', 'P-01')], 'metadata-action')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([prop('process-cia-withdraws', '')], 'metadata-action')).toEqual([codes.VALUE_INVALID]);
    expect(codesOf([prop('process-cia-sequence', '1'), prop('process-cia-sequence', '2')], 'metadata-action')).toEqual([codes.CARDINALITY_INVALID]);
    expect(codesOf([prop('process-cia-content-hash', HASH), prop('process-cia-withdraws', UUID)], 'metadata-action')).toEqual([codes.VALUE_INVALID]);
  });

  it('verbietet group an ungruppierten Prozessnamen', () => {
    expect(codesOf([prop('process-id', 'P-01', { group: 'gspp' })], 'business-process')).toEqual([codes.GROUP_INVALID]);
    expect(codesOf([prop('process-cia-sequence', '1', { group: 'gspp' })], 'metadata-action')).toEqual([codes.GROUP_INVALID]);
  });
});

describe('Prozessnamen: Kardinalität und Eindeutigkeit je Träger', () => {
  it.each(['process-id', 'process-priority', 'process-applications-none', 'process-protection-availability'])('%s kommt höchstens einmal vor', (name) => {
    const value = name === 'process-priority' ? '1' : name === 'process-applications-none' ? 'true' : name === 'process-id' ? 'P-01' : 'normal';
    const candidate = prop(name, value, { remarks: 'Grund' });
    expect(codesOf([candidate, { ...candidate }], 'business-process')).toContain(codes.CARDINALITY_INVALID);
  });

  it('lässt mehrere verschiedene Anwendungen zu und weist Doppelungen ab', () => {
    const other = 'aaaaaaaa-0000-4000-8000-000000000004';
    expect(readProjectProps([prop('process-application-uuid', UUID), prop('process-application-uuid', other)], 'business-process').writeAllowed).toBe(true);
    expect(codesOf([prop('process-application-uuid', UUID), prop('process-application-uuid', UUID.toUpperCase())], 'business-process'))
      .toEqual([codes.DUPLICATE_VALUE]);
  });

  it('weist Anwendungen neben dem Nullfall als Widerspruch ab', () => {
    expect(codesOf([prop('process-application-uuid', UUID), prop('process-applications-none', 'true', { remarks: 'Grund' })], 'business-process'))
      .toEqual([codes.VALUE_INVALID]);
  });

  it('behandelt fehlende Pflichtangaben als offen, nicht als Fehler', () => {
    expect(readProjectProps(undefined, 'business-process').writeAllowed).toBe(true);
    expect(readProjectProps([prop('process-protection-integrity', 'hoch', { remarks: 'Grund' })], 'business-process').writeAllowed).toBe(true);
    expect(readProjectProps([prop('process-cia-sequence', '1')], 'metadata-action').writeAllowed).toBe(true);
    expect(readProjectProps([prop('process-category-label', 'Kritisch', { group: 'cat-kritisch' })], 'metadata').writeAllowed).toBe(true);
  });
});

describe('validateBusinessProcessProjectProps', () => {
  const process = (id?: string) => readProjectProps(id === undefined ? undefined : [prop('process-id', id)], 'business-process');

  it('erkennt doppelte fachliche Prozess-IDs nach NFC, Trim und Groß-/Kleinschreibung', () => {
    expect(validateBusinessProcessProjectProps([process('P-01'), process('P-02'), process()]).writeAllowed).toBe(true);
    for (const duplicate of ['p-01', ' P-01 ', 'P-01']) {
      const result = validateBusinessProcessProjectProps([process('P-01'), process(duplicate)]);
      expect(result.diagnostics.map(({ code, path }) => [code, path])).toEqual([
        [codes.DUPLICATE_VALUE, '/system-security-plan/system-implementation/components'],
      ]);
    }
    expect(validateBusinessProcessProjectProps([process('Ä-1'), process('Ä-1')]).writeAllowed).toBe(false);
    expect(JSON.stringify(validateBusinessProcessProjectProps([process('geheim'), process('GEHEIM')]))).not.toContain('geheim');
  });

  it('nimmt nur Geschäftsprozess-Lesungen an', () => {
    const result = validateBusinessProcessProjectProps([readProjectProps(undefined, 'system-component')]);
    expect(result.diagnostics[0].code).toBe(codes.CARRIER_INVALID);
  });
});

describe('createProjectProp für Prozessnamen', () => {
  it('erzeugt gültige Properties und verweigert ungültige', () => {
    const created = createProjectProp({ name: 'process-protection-category', value: 'cat-kritisch', group: 'integrity', carrier: 'business-process' });
    expect(created).toEqual({ ok: true, prop: { ns, name: 'process-protection-category', value: 'cat-kritisch', group: 'integrity' } });
    const missingGroup = createProjectProp({ name: 'process-category-label', value: 'Kritisch', carrier: 'metadata' });
    expect(missingGroup.ok ? undefined : missingGroup.diagnostic.code).toBe(codes.GROUP_INVALID);
    const wrongCarrier = createProjectProp({ name: 'process-cia-sequence', value: '1', carrier: 'metadata' });
    expect(wrongCarrier.ok ? undefined : wrongCarrier.diagnostic.code).toBe(codes.CARRIER_INVALID);
  });
});
