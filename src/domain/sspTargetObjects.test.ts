import { describe, expect, it } from 'vitest';
import { readProjectProps, PROJECT_PROPS_NAMESPACE as ns } from '@/domain/projectProps';
import { bindSspCategories, prepareSspTargets, setTargetProtection, validateSspTargets, targetCoverage, type TargetCategoryContext } from '@/domain/sspTargetObjects';
import { makeFullSsp, withSspBody } from '@/test/fixtures/systemSecurityPlans';
import { readSspValue } from '@/domain/sspAuthoring';
import type { VocabularyNamespaceData } from '@/domain/models';

const category = 'aaaaaaaa-0000-4000-8000-000000000001';
const context: TargetCategoryContext = { commit: 'a'.repeat(40), namespace: { entries: [{ value: 'Beispiel', columns: { UUID: category, ChildOfUUID: '', Typ: '' } }] } as unknown as VocabularyNamespaceData };
const componentPath = ['system-implementation', 'components', 0];

describe('Zielobjekt-Properties', () => {
  const uuid = 'aaaaaaaa-0000-4000-8000-000000000001';
  it.each(['target-object-category', 'effective-target-object-category'])('%s registriert UUIDs je Träger und Gruppe eindeutig', (name) => {
    const prop = { ns, name, value: uuid, group: 'gspp' };
    expect(readProjectProps([prop], 'system-component').writeAllowed).toBe(true);
    expect(readProjectProps([prop, prop], 'system-component').writeAllowed).toBe(false);
    expect(readProjectProps([{ ...prop, group: 'other' }], 'system-component').writeAllowed).toBe(false);
    expect(readProjectProps([{ ...prop, value: uuid.toUpperCase() }], 'system-component').writeAllowed).toBe(false);
    expect(readProjectProps([prop], 'metadata').writeAllowed).toBe(false);
  });
  it('registriert Abdeckung ausschließlich auf Metadaten', () => {
    const prop = { ns, name: 'protection-need-coverage', value: 'incomplete' };
    expect(readProjectProps([prop], 'metadata').writeAllowed).toBe(true);
    expect(readProjectProps([prop, prop], 'metadata').writeAllowed).toBe(false);
    expect(readProjectProps([{ ...prop, value: 'complete' }], 'metadata').writeAllowed).toBe(true);
    expect(readProjectProps([{ ...prop, value: 'pending' }], 'metadata').writeAllowed).toBe(false);
    expect(readProjectProps([prop], 'system-component').writeAllowed).toBe(false);
  });
});

describe('SSP-Zielobjektvertrag', () => {
  it('trennt offene Bewertung und technische Quelle, schreibt Coverage beim expliziten Speichern', () => {
    const original = makeFullSsp();
    expect(targetCoverage(original)).toEqual({ assessed: 0, total: 4, value: 'incomplete' });
    const next = setTargetProtection(original, componentPath, 'hoch', 'Synthetische Begründung');
    expect(targetCoverage(next)).toEqual({ assessed: 1, total: 4, value: 'incomplete' });
    const prepared = prepareSspTargets(next);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(readSspValue(prepared.source, ['metadata', 'props'])).toContainEqual({ ns, name: 'protection-need-coverage', value: 'incomplete' });
    expect(validateSspTargets(prepared.source)).toBeUndefined();
    expect(targetCoverage(setTargetProtection(prepared.source, componentPath, undefined))).toMatchObject({ assessed: 0 });
    expect(original).toEqual(makeFullSsp());
  });
  it('weist ungültige Werte und leere Begründungen ab, keine CIA- oder Identitätsänderung', () => {
    const original = makeFullSsp();
    expect(() => setTargetProtection(original, componentPath, 'hoch', ' ')).toThrow();
    expect(() => setTargetProtection(original, componentPath, '1' as never, 'x')).toThrow();
    const changed = setTargetProtection(original, componentPath, 'normal', 'x');
    expect(readSspValue(changed, ['system-characteristics'])).toEqual(readSspValue(original, ['system-characteristics']));
    expect(readSspValue(changed, [...componentPath, 'uuid'])).toEqual(readSspValue(original, [...componentPath, 'uuid']));
  });
  it('prüft Coverage gegen den tatsächlichen Bestand, ohne Marker zu ergänzen', () => {
    const original = withSspBody(makeFullSsp(), body => { body.metadata.props = [{ ns, name: 'protection-need-coverage', value: 'complete' }]; });
    expect(validateSspTargets(original)).toMatchObject({ code: 'SSP_COVERAGE_MISMATCH' });
    expect(validateSspTargets(makeFullSsp())).toBeUndefined();
    const empty = { 'system-security-plan': { metadata: {} } };
    expect(targetCoverage(empty)).toEqual({ assessed: 0, total: 0, value: 'incomplete' });
  });
  it('bindet das Paar atomar, prüft Kategorien und erhält fremde Props bei Ableitung', () => {
    const bound = bindSspCategories(makeFullSsp(), context);
    const selected = withSspBody(bound as Record<string, unknown>, body => {
      body['system-implementation'].components[0].props = [{ ns, name: 'target-object-category', value: category, group: 'gspp' }, { ns: 'urn:foreign', name: 'preserve', value: 'x' }];
    });
    expect(validateSspTargets(selected, context)).toMatchObject({ code: 'SSP_CATEGORY_MISMATCH' });
    const prepared = prepareSspTargets(selected, context);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(validateSspTargets(prepared.source, context)).toBeUndefined();
    expect(readSspValue(prepared.source, [...componentPath, 'props'])).toContainEqual({ ns: 'urn:foreign', name: 'preserve', value: 'x' });
    expect(validateSspTargets(prepared.source)).toMatchObject({ code: 'SSP_CATEGORY_CONTEXT_UNAVAILABLE' });
    expect(validateSspTargets(prepared.source, { ...context, commit: 'b'.repeat(40) })).toMatchObject({ code: 'SSP_CATEGORY_CONTEXT_UNAVAILABLE' });
    expect(() => bindSspCategories(prepared.source, { ...context, commit: 'b'.repeat(40) })).toThrow();
  });
  it('verweigert unbekannte Projektnamen und doppelte Schutzbedarfswerte verlustfrei', () => {
    for (const props of [[{ ns, name: 'future', value: 'sentinel' }], [{ ns, name: 'protection-need-level', value: 'normal', remarks: 'x' }, { ns, name: 'protection-need-level', value: 'hoch', remarks: 'y' }]]) {
      const source = withSspBody(makeFullSsp(), body => { body['system-implementation'].components[0].props = props; });
      expect(validateSspTargets(source)).toBeDefined();
      expect(prepareSspTargets(source).ok).toBe(false);
    }
  });
  it('sperrt Projektsemantik auf falschen SSP-Trägern und unbekannte Props in unberührten Strukturen', () => {
    for (const name of ['target-object-category', 'protection-need-coverage', 'future']) {
      const source = withSspBody(makeFullSsp(), body => { body['system-characteristics'].props = [{ ns, name, value: category, group: 'gspp' }]; });
      expect(validateSspTargets(source)).toBeDefined();
    }
  });
});
