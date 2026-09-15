import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Control, PropValue } from '@/domain/models';
import { SECURITY_TARGETS_NAMESPACE_URL } from '@/domain/vocabularyNamespaces';
import {
  SECURITY_TARGET_FILTER_VALUES,
  sumSecurityTargetCounts,
  type SecurityTargetDimension,
  type SecurityTargetFilterValue,
} from '@/domain/securityTargets';
import { emptyFilters, useFilteredControls, type ControlFilters } from './useFilteredControls';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Governance MUSS verankert werden.',
    statementRaw: 'Governance MUSS verankert werden.',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
      ...overrides.statementProps,
    },
    links: [],
    params: {},
    ...overrides,
  };
}

/** Schutzziel-Prop mit der Provenienz des Katalogs, so wie der Adapter ihn liefert. */
function targetProp(name: string, value: string): PropValue {
  return { name, value, ns: SECURITY_TARGETS_NAMESPACE_URL };
}

function withSecurityTarget(
  id: string,
  dimension: SecurityTargetDimension,
  value: string | undefined,
): Control {
  if (value === undefined) return makeControl({ id });
  const propKey = `${dimension}Prop` as const;
  return makeControl({
    id,
    [dimension]: value === '0' || value === '1' || value === '2' ? value : undefined,
    [propKey]: targetProp(dimension, value),
  } as Partial<Control>);
}

function securityTargetFilters(
  selection: Partial<Record<SecurityTargetDimension, SecurityTargetFilterValue[]>>,
): ControlFilters {
  return {
    ...emptyFilters,
    securityTargets: { ...emptyFilters.securityTargets, ...selection },
  };
}

describe('Schutzziel-Facetten', () => {
  it('filtert nach der exakten Stufe und schließt die höhere nicht ein', () => {
    const controls = [
      withSecurityTarget('GC.1.0', 'confidentiality', '0'),
      withSecurityTarget('GC.1.1', 'confidentiality', '1'),
      withSecurityTarget('GC.1.2', 'confidentiality', '2'),
    ];

    const stufe1 = renderHook(() =>
      useFilteredControls(controls, securityTargetFilters({ confidentiality: ['1'] })),
    );
    expect(stufe1.result.current.filtered.map((c) => c.id)).toEqual(['GC.1.1']);

    const stufe2 = renderHook(() =>
      useFilteredControls(controls, securityTargetFilters({ confidentiality: ['2'] })),
    );
    expect(stufe2.result.current.filtered.map((c) => c.id)).toEqual(['GC.1.2']);

    // Mehrere Stufen zusammen ergeben die gewünschte Obermenge — über ODER,
    // nicht über eine eingebaute Schwelle.
    const beide = renderHook(() =>
      useFilteredControls(controls, securityTargetFilters({ confidentiality: ['1', '2'] })),
    );
    expect(beide.result.current.filtered.map((c) => c.id)).toEqual(['GC.1.1', 'GC.1.2']);
  });

  it.each(['confidentiality', 'integrity', 'availability', 'authenticity'] as const)(
    'holt über keine Stufe ein Control ohne prop oder mit der Bewertung 0 — %s',
    (dimension) => {
      const ohneProp = withSecurityTarget('OHNE.1', dimension, undefined);
      const mitNull = withSecurityTarget('NULL.1', dimension, '0');
      const controls = [ohneProp, mitNull];

      for (const stufe of SECURITY_TARGET_FILTER_VALUES) {
        const { result } = renderHook(() =>
          useFilteredControls(controls, securityTargetFilters({ [dimension]: [stufe] })),
        );
        expect(result.current.filtered).toHaveLength(0);
      }

      // Die beiden bleiben trotzdem unterscheidbar: Der Rohwert steht am
      // Control, und ohne Auswahl sind beide sichtbar.
      expect(mitNull[`${dimension}Prop`]?.value).toBe('0');
      expect(ohneProp[`${dimension}Prop`]).toBeUndefined();

      const ungefiltert = renderHook(() => useFilteredControls(controls, emptyFilters));
      expect(ungefiltert.result.current.filtered).toHaveLength(2);
    },
  );

  it('verknüpft die vier Dimensionen mit UND', () => {
    const beides = makeControl({
      id: 'BEIDE.1',
      confidentiality: '2',
      confidentialityProp: targetProp('confidentiality', '2'),
      integrity: '2',
      integrityProp: targetProp('integrity', '2'),
    });
    const nurVertraulichkeit = withSecurityTarget('NUR.1', 'confidentiality', '2');

    const { result } = renderHook(() =>
      useFilteredControls(
        [beides, nurVertraulichkeit],
        securityTargetFilters({ confidentiality: ['2'], integrity: ['2'] }),
      ),
    );

    expect(result.current.filtered.map((c) => c.id)).toEqual(['BEIDE.1']);
  });

  it('verknüpft mehrere Stufen einer Dimension mit ODER', () => {
    const controls = [
      withSecurityTarget('A.1', 'availability', '2'),
      withSecurityTarget('A.2', 'availability', undefined),
      withSecurityTarget('A.3', 'availability', '0'),
      withSecurityTarget('A.4', 'availability', '1'),
    ];

    const { result } = renderHook(() =>
      useFilteredControls(controls, securityTargetFilters({ availability: ['1', '2'] })),
    );

    // Beide Stufen zusammen — das ist genau die Menge hinter der Elternzeile.
    expect(result.current.filtered.map((c) => c.id)).toEqual(['A.1', 'A.4']);
  });

  it('blendet unbewertete Anforderungen bei aktiver Facette aus', () => {
    const controls = [
      withSecurityTarget('B.1', 'availability', '1'),
      withSecurityTarget('B.2', 'availability', undefined),
    ];

    const gefiltert = renderHook(() =>
      useFilteredControls(controls, securityTargetFilters({ availability: ['1'] })),
    );
    expect(gefiltert.result.current.filtered.map((c) => c.id)).toEqual(['B.1']);

    // Ohne Auswahl bleiben beide sichtbar.
    const ungefiltert = renderHook(() => useFilteredControls(controls, emptyFilters));
    expect(ungefiltert.result.current.filtered).toHaveLength(2);
  });

  it('ordnet einen Wert außerhalb der Skala keiner Stufe zu', () => {
    const controls = [
      withSecurityTarget('U.1', 'integrity', '3'),
      withSecurityTarget('U.2', 'integrity', '2'),
    ];

    const stufe2 = renderHook(() =>
      useFilteredControls(controls, securityTargetFilters({ integrity: ['2'] })),
    );
    expect(stufe2.result.current.filtered.map((c) => c.id)).toEqual(['U.2']);

    // Der Rohwert bleibt am Control erhalten, auch wenn keine Facette ihn zeigt.
    expect(controls[0].integrityProp?.value).toBe('3');
  });

  it('meldet eine Schutzziel-Auswahl als aktiven Filter', () => {
    const { result } = renderHook(() =>
      useFilteredControls(
        [withSecurityTarget('GC.1.1', 'confidentiality', '1')],
        securityTargetFilters({ confidentiality: ['1'] }),
      ),
    );

    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('zählt nur die Anforderungen, die das Schutzziel betreffen', () => {
    const controls = [
      withSecurityTarget('C.0', 'confidentiality', '0'),
      withSecurityTarget('C.1', 'confidentiality', '1'),
      withSecurityTarget('C.2', 'confidentiality', '2'),
      withSecurityTarget('C.X', 'confidentiality', undefined),
      withSecurityTarget('C.F', 'confidentiality', 'hoch'),
    ];

    const { result } = renderHook(() => useFilteredControls(controls, emptyFilters));
    const counts = result.current.facetCounts.securityTargets.confidentiality;

    // Nur die beiden auswählbaren Stufen tragen einen Zähler: die Stufe 0, das
    // unbewertete und das skalenfremde Control zählen in keinen.
    expect(counts).toEqual({ '1': 1, '2': 1 });

    // Die Zahl der Elternzeile ist genau diese Summe — nicht die Gesamtzahl.
    expect(sumSecurityTargetCounts(counts)).toBe(2);
  });

  it('führt gleichlautende Control-ids aus zwei Katalogen getrennt', () => {
    // GSPP-284 lädt zwei Kataloge parallel; `control/@id` ist nur lokal
    // eindeutig. Die Facette darf zwei gleichnamige Controls weder
    // zusammenführen noch eines von ihnen verlieren.
    const ausKatalogA = withSecurityTarget('GC.1.1', 'confidentiality', '2');
    const ausKatalogB = {
      ...withSecurityTarget('GC.1.1', 'confidentiality', '2'),
      title: 'Gleiche Kennung, anderer Katalog',
    };

    const { result } = renderHook(() =>
      useFilteredControls(
        [ausKatalogA, ausKatalogB],
        securityTargetFilters({ confidentiality: ['2'] }),
      ),
    );

    expect(result.current.filtered).toHaveLength(2);
    expect(result.current.filtered.map((c) => c.title)).toEqual([
      ausKatalogA.title,
      'Gleiche Kennung, anderer Katalog',
    ]);
    expect(result.current.facetCounts.securityTargets.confidentiality['2']).toBe(2);
  });
});
