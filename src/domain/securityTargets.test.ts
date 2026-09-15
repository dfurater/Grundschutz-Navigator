import { describe, expect, it } from 'vitest';
import type { Control, PropValue } from './models';
import { SECURITY_TARGETS_NAMESPACE_URL } from './vocabularyNamespaces';
import { getSecurityTargetFilterLabel } from '@/features/vocabulary/display';
import {
  SECURITY_TARGET_DIMENSIONS,
  SECURITY_TARGET_FILTER_VALUES,
  SECURITY_TARGET_RELEVANCE_ORDER,
  classifySecurityTarget,
  getSecurityTargetRelevanceRank,
  isSecurityTargetFilterValue,
  matchesSecurityTargetFilterValue,
  passesSecurityTargetFilter,
  securityTargetFacetKeys,
  securityTargetSelectionState,
  sumSecurityTargetCounts,
  type SecurityTargetDimension,
} from './securityTargets';

type SecurityTargetControl = Pick<
  Control,
  | 'confidentiality'
  | 'integrity'
  | 'availability'
  | 'authenticity'
  | 'confidentialityProp'
  | 'integrityProp'
  | 'availabilityProp'
  | 'authenticityProp'
>;

function prop(value: string): PropValue {
  return { name: 'confidentiality', value, ns: SECURITY_TARGETS_NAMESPACE_URL };
}

/** Control mit genau einer bewerteten Dimension; alle übrigen bleiben unbewertet. */
function makeControl(
  dimension: SecurityTargetDimension,
  value: string | undefined,
): SecurityTargetControl {
  const meta = SECURITY_TARGET_DIMENSIONS.find(
    (entry) => entry.dimension === dimension,
  );
  if (!meta) throw new Error(`Unbekannte Dimension: ${dimension}`);

  const control: SecurityTargetControl = {};
  if (value !== undefined) {
    control[meta.propKey] = { ...prop(value), name: meta.propName };
  }
  return control;
}

describe('Relevanzordnung', () => {
  it('führt die Skala aufsteigend und nur mit den drei BSI-Werten', () => {
    expect(SECURITY_TARGET_RELEVANCE_ORDER).toEqual(['0', '1', '2']);
  });

  it('vergibt den Rang über einen Lookup in der Ordnung', () => {
    expect(getSecurityTargetRelevanceRank('0')).toBe(0);
    expect(getSecurityTargetRelevanceRank('1')).toBe(1);
    expect(getSecurityTargetRelevanceRank('2')).toBe(2);
  });

  it.each(['3', '10', 'hoch', '', ' 1', '1.0', '-1'])(
    'vergibt keinen Rang an den skalenfremden Wert %o',
    (value) => {
      expect(getSecurityTargetRelevanceRank(value)).toBeUndefined();
    },
  );

  it('rechnet einen numerisch parsbaren Fremdwert nicht in die Ordnung ein', () => {
    // Der Kern des Negativtests: parseInt('3') ergäbe 3 und damit still eine
    // höhere Relevanz als '2'. Der Lookup verweigert den Rang.
    expect(Number.parseInt('3', 10)).toBe(3);
    expect(getSecurityTargetRelevanceRank('3')).toBeUndefined();
  });

  it('vergibt keinen Rang ohne Wert', () => {
    expect(getSecurityTargetRelevanceRank(undefined)).toBeUndefined();
  });
});

describe('classifySecurityTarget', () => {
  it.each(SECURITY_TARGET_DIMENSIONS.map((entry) => entry.dimension))(
    'trennt Abwesenheit strikt vom Wert 0 — Dimension %s',
    (dimension) => {
      const ohneProp = classifySecurityTarget(makeControl(dimension, undefined), dimension);
      const mitNull = classifySecurityTarget(makeControl(dimension, '0'), dimension);

      expect(ohneProp).toEqual({ state: 'unrated' });
      expect(mitNull).toEqual({ state: 'rated', value: '0', rank: 0 });
      expect(ohneProp.state).not.toBe(mitNull.state);
    },
  );

  it('führt einen Wert außerhalb der Skala als unbekannt und erhält ihn verlustfrei', () => {
    const classification = classifySecurityTarget(
      makeControl('integrity', 'hoch'),
      'integrity',
    );

    expect(classification).toEqual({ state: 'unknown', value: 'hoch' });
    expect(classification.rank).toBeUndefined();
  });

  it('klassifiziert jede Dimension unabhängig von den übrigen', () => {
    const control = makeControl('availability', '2');

    expect(classifySecurityTarget(control, 'availability').state).toBe('rated');
    expect(classifySecurityTarget(control, 'confidentiality').state).toBe('unrated');
    expect(classifySecurityTarget(control, 'integrity').state).toBe('unrated');
    expect(classifySecurityTarget(control, 'authenticity').state).toBe('unrated');
  });
});

describe('Exakte Stufenauswahl', () => {
  it.each([
    ['1', ['1']],
    ['2', ['2']],
  ] as const)('trifft mit der Stufe %s ausschließlich diese Stufe', (gewaehlt, treffer) => {
    const ergebnisse = ['0', '1', '2'].filter((value) =>
      matchesSecurityTargetFilterValue(
        classifySecurityTarget(makeControl('confidentiality', value), 'confidentiality'),
        gewaehlt,
      ),
    );

    expect(ergebnisse).toEqual([...treffer]);
  });

  it('schließt die höhere Stufe nicht ein — Stufe 1 zeigt nicht Stufe 2', () => {
    const stufe2 = classifySecurityTarget(
      makeControl('confidentiality', '2'),
      'confidentiality',
    );

    expect(matchesSecurityTargetFilterValue(stufe2, '1')).toBe(false);
    expect(matchesSecurityTargetFilterValue(stufe2, '2')).toBe(true);
  });

  it('ordnet einen unbekannten Wert keiner Stufe zu', () => {
    const classification = classifySecurityTarget(
      makeControl('confidentiality', '3'),
      'confidentiality',
    );

    for (const stufe of SECURITY_TARGET_FILTER_VALUES) {
      expect(matchesSecurityTargetFilterValue(classification, stufe)).toBe(false);
    }
    // Der Zustand bleibt unterscheidbar, auch wenn er nicht auswählbar ist.
    expect(classification.state).toBe('unknown');
    expect(classification.value).toBe('3');
  });

  it.each(SECURITY_TARGET_DIMENSIONS.map((entry) => entry.dimension))(
    'macht ein mit 0 bewertetes Control über keine Auswahl erreichbar — %s',
    (dimension) => {
      const mitNull = makeControl(dimension, '0');

      for (const stufe of SECURITY_TARGET_FILTER_VALUES) {
        expect(passesSecurityTargetFilter(mitNull, dimension, [stufe])).toBe(false);
      }

      // Nicht auswählbar heißt nicht eingeebnet: Die Klassifikation führt den
      // Wert weiter und hält ihn von der Abwesenheit getrennt.
      expect(classifySecurityTarget(mitNull, dimension)).toEqual({
        state: 'rated',
        value: '0',
        rank: 0,
      });
      expect(classifySecurityTarget(makeControl(dimension, undefined), dimension)).toEqual({
        state: 'unrated',
      });
    },
  );

  it('blendet unbewertete Controls bei jeder aktiven Auswahl aus', () => {
    const ohneProp = makeControl('confidentiality', undefined);

    for (const stufe of SECURITY_TARGET_FILTER_VALUES) {
      expect(
        passesSecurityTargetFilter(ohneProp, 'confidentiality', [stufe]),
      ).toBe(false);
    }
    // Ohne Auswahl bleibt es sichtbar — die Facette versteckt nichts von selbst.
    expect(passesSecurityTargetFilter(ohneProp, 'confidentiality', [])).toBe(true);
  });
});

describe('securityTargetFacetKeys', () => {
  it.each(SECURITY_TARGET_FILTER_VALUES)(
    'zählt die Stufe %s in genau ihre eigene Facette',
    (value) => {
      const keys = securityTargetFacetKeys(
        classifySecurityTarget(makeControl('confidentiality', value), 'confidentiality'),
      );
      expect(keys).toEqual([value]);
    },
  );

  it('zählt die Stufe 0 in keine Facette, weil sie keine Auswahl ist', () => {
    const classification = classifySecurityTarget(
      makeControl('confidentiality', '0'),
      'confidentiality',
    );

    expect(securityTargetFacetKeys(classification)).toEqual([]);
    // Die Anforderung bleibt trotzdem als bewertet geführt.
    expect(classification.state).toBe('rated');
  });

  it('zählt weder Abwesenheit noch unbekannten Wert in eine Stufe', () => {
    expect(
      securityTargetFacetKeys(
        classifySecurityTarget(makeControl('authenticity', undefined), 'authenticity'),
      ),
    ).toEqual([]);
    expect(
      securityTargetFacetKeys(
        classifySecurityTarget(makeControl('authenticity', 'sehr hoch'), 'authenticity'),
      ),
    ).toEqual([]);
  });

  it('ordnet eine bewertete Anforderung höchstens einer Stufe zu', () => {
    for (const value of ['0', '1', '2']) {
      const keys = securityTargetFacetKeys(
        classifySecurityTarget(makeControl('availability', value), 'availability'),
      );
      expect(keys).toEqual(isSecurityTargetFilterValue(value) ? [value] : []);
    }
  });
});

describe('passesSecurityTargetFilter', () => {
  it('filtert nicht, solange nichts ausgewählt ist', () => {
    expect(
      passesSecurityTargetFilter(makeControl('confidentiality', '0'), 'confidentiality', []),
    ).toBe(true);
  });

  it('verknüpft mehrere Stufen einer Dimension mit ODER', () => {
    const ergebnisse = ['0', '1', '2'].map((value) =>
      passesSecurityTargetFilter(
        makeControl('confidentiality', value),
        'confidentiality',
        ['1', '2'],
      ),
    );

    expect(ergebnisse).toEqual([false, true, true]);
  });

  it('zeigt bei einer einzelnen Stufe nur diese Stufe', () => {
    const stufen = ['0', '1', '2'].map((value) =>
      passesSecurityTargetFilter(
        makeControl('confidentiality', value),
        'confidentiality',
        ['1'],
      ),
    );

    expect(stufen).toEqual([false, true, false]);
  });
});

describe('Facettenwerte', () => {
  it('führt genau die beiden Stufen, die ein Schutzziel betreffen', () => {
    expect(SECURITY_TARGET_FILTER_VALUES).toEqual(['1', '2']);

    for (const value of SECURITY_TARGET_FILTER_VALUES) {
      expect(isSecurityTargetFilterValue(value)).toBe(true);
    }
  });

  it('lässt die Skala der Ordnung dreistellig, obwohl die Auswahl enger ist', () => {
    // Die Ordnung bildet das Vokabular ab und speist die Relevanzskala der
    // Detailansicht (`RELEVANCE_SCALE_MAX`). Verengt ist allein die Auswahl.
    expect(SECURITY_TARGET_RELEVANCE_ORDER).toEqual(['0', '1', '2']);
    expect(SECURITY_TARGET_FILTER_VALUES.length).toBeLessThan(
      SECURITY_TARGET_RELEVANCE_ORDER.length,
    );
  });

  it('verwirft die Stufe 0 als Auswahl, obwohl sie zur Skala gehört', () => {
    // Eine Facette führt zu den Anforderungen, die ein Schutzziel betreffen.
    expect(getSecurityTargetRelevanceRank('0')).toBe(0);
    expect(isSecurityTargetFilterValue('0')).toBe(false);
  });

  it.each(['min1', '3', '-1', 'unrated', 'unknown', '', ' 1'])(
    'verwirft den Fremdwert %o',
    (value) => {
      expect(isSecurityTargetFilterValue(value)).toBe(false);
    },
  );

  it('beschreibt keine Abdeckung, Erfüllung oder Compliance', () => {
    const verbotenerWortschatz = [
      'abdeckung',
      'abgedeckt',
      'coverage',
      'compliance',
      'erfüllt',
      'erfüllung',
      'umgesetzt',
      'umsetzung',
      'konform',
    ];
    const texte = [
      ...SECURITY_TARGET_FILTER_VALUES.map(getSecurityTargetFilterLabel),
      ...SECURITY_TARGET_DIMENSIONS.map((entry) => entry.label),
    ].map((text) => text.toLowerCase());

    for (const text of texte) {
      for (const wort of verbotenerWortschatz) {
        expect(text).not.toContain(wort);
      }
    }
  });
});

describe('sumSecurityTargetCounts', () => {
  it('summiert die beiden auswählbaren Stufen', () => {
    expect(sumSecurityTargetCounts({ '1': 559, '2': 311 })).toBe(870);
  });

  it('lässt eine fehlende Stufe als 0 zählen', () => {
    expect(sumSecurityTargetCounts({ '1': 7 })).toBe(7);
    expect(sumSecurityTargetCounts({})).toBe(0);
  });

  it('zählt keinen Wert mit, der keine Auswahl ist', () => {
    // Die Zahl der Elternzeile ist die Menge der Anforderungen, die das
    // Schutzziel betreffen — nicht die Menge aller bewerteten.
    expect(sumSecurityTargetCounts({ '0': 609, '1': 265, '2': 26 })).toBe(291);
  });

  it('zählt jede Anforderung höchstens einmal, weil eine Dimension ein prop trägt', () => {
    const counts: Record<string, number> = {};
    const controls = [
      makeControl('confidentiality', '1'),
      makeControl('confidentiality', '2'),
      makeControl('confidentiality', '0'),
      makeControl('confidentiality', undefined),
      makeControl('confidentiality', 'hoch'),
    ];

    for (const control of controls) {
      for (const key of securityTargetFacetKeys(
        classifySecurityTarget(control, 'confidentiality'),
      )) {
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }

    expect(sumSecurityTargetCounts(counts)).toBe(2);
    expect(sumSecurityTargetCounts(counts)).toBeLessThanOrEqual(controls.length);
  });
});

describe('securityTargetSelectionState', () => {
  it('meldet eine leere Auswahl als none', () => {
    expect(securityTargetSelectionState([])).toBe('none');
  });

  it.each(SECURITY_TARGET_FILTER_VALUES)(
    'meldet die einzelne Stufe %s als partial',
    (stufe) => {
      expect(securityTargetSelectionState([stufe])).toBe('partial');
    },
  );

  it('meldet beide Stufen als all — unabhängig von der Reihenfolge', () => {
    expect(securityTargetSelectionState(['1', '2'])).toBe('all');
    expect(securityTargetSelectionState(['2', '1'])).toBe('all');
  });

  it('zählt einen doppelten Wert nicht als zweite Stufe', () => {
    expect(securityTargetSelectionState(['1', '1'])).toBe('partial');
  });
});
