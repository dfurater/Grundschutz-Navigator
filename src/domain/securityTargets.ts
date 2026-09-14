/**
 * Schutzziel-Relevanz (CIA + Authentizität) — Skala, Ordnung, Klassifikation
 * und Facettenauswahl. Ausführliche Herleitung: `docs/FILTERING.md`.
 *
 * OSCAL definiert für `prop.value` keinen Wertebereich. Beleg im gepinnten
 * Bestand: `schemas/oscal/v1.1.3/oscal_catalog_schema.json` führt unter
 * `oscal-catalog-oscal-metadata:property` das Feld `value` als `$ref` auf
 * `StringDatatype`, und `StringDatatype` ist dort `{"type": "string",
 * "pattern": "^\\S(.*\\S)?$"}` — ohne Enum, ohne Zahlentyp und **ohne
 * Ordnung**. Die Schemata sind SHA-256-gepinnt und offline prüfbar
 * (`npm run verify-oscal-schemas`), Herkunft NIST-Release v1.1.3; der
 * Versionsbezug steht in `src/domain/oscalVersionMatrix.mjs`.
 *
 * Die Skala `'0' | '1' | '2'` stammt deshalb ausschließlich aus dem
 * BSI-Vokabular `security_targets_levels.csv`. Das ist **nicht** das über
 * `prop.ns` referenzierte Vokabular: Der `ns` der vier Schutzziel-Props zeigt
 * auf `security_targets.csv`, das nach Schutzziel-Namen indiziert ist und die
 * Werte `0`–`2` nicht kennt. Die Stufendatei ist über `prop.ns` nicht
 * erreichbar und wird deshalb explizit ausgewählt (`resolveSecurityTargetLevel`
 * in `domain/vocabulary.ts`). Diese Datei hier ist die **einzige** Stelle, an
 * der Skala und Ordnung ausgesprochen werden (GSPP-226), damit eine spätere
 * Vokabularänderung genau einen Ort hat.
 *
 * Zwei Unterscheidungen sind normativ bindend und dürfen nicht eingeebnet
 * werden:
 *
 * 1. **Abwesenheit ist keine Null.** Ein Control ohne das jeweilige `prop`
 *    trifft keine Aussage; `'0'` sagt „ausgewertet, nicht relevant". Im
 *    ausgelieferten Katalog betrifft das je Schutzziel 99 bis 100 Controls.
 * 2. **Ein Wert außerhalb der Skala ist schema-valide.** Er wird verlustfrei
 *    erhalten und als unbekannt geführt statt einer Stufe zugeschlagen. Ein
 *    Vergleich über `parseInt` ist deshalb unzulässig.
 *
 * Eine Schutzziel-Relevanz beschreibt, worauf ein Control einzahlt — nicht, ob
 * es umgesetzt oder wirksam ist. Umsetzungsstatus existiert in OSCAL nur im
 * SSP: Im gepinnten `schemas/oscal/v1.1.3/oscal_ssp_schema.json` trägt genau
 * eine Definition das Feld `implementation-status`, nämlich
 * `oscal-ssp-oscal-ssp:by-component`. Aus einer Facettenauswahl darf deshalb an
 * keiner Stelle eine Abdeckungs- oder Compliance-Aussage werden.
 */

import type { Control, PropValue, SecurityTargetRelevance } from './models';

/* ------------------------------------------------------------------ */
/*  Dimensionen                                                        */
/* ------------------------------------------------------------------ */

/** Die vier Schutzziele, jeweils als eigene Filterdimension. */
export type SecurityTargetDimension =
  | 'confidentiality'
  | 'integrity'
  | 'availability'
  | 'authenticity';

interface SecurityTargetDimensionMeta {
  readonly dimension: SecurityTargetDimension;
  /** Anzeigename der Facette */
  readonly label: string;
  /** `prop.name` im OSCAL-Katalog */
  readonly propName: string;
  /** Feld der Prop-Provenienz auf `Control` */
  readonly propKey:
    | 'confidentialityProp'
    | 'integrityProp'
    | 'availabilityProp'
    | 'authenticityProp';
}

export const SECURITY_TARGET_DIMENSIONS: readonly SecurityTargetDimensionMeta[] = [
  {
    dimension: 'confidentiality',
    label: 'Vertraulichkeit',
    propName: 'confidentiality',
    propKey: 'confidentialityProp',
  },
  {
    dimension: 'integrity',
    label: 'Integrität',
    propName: 'integrity',
    propKey: 'integrityProp',
  },
  {
    dimension: 'availability',
    label: 'Verfügbarkeit',
    propName: 'availability',
    propKey: 'availabilityProp',
  },
  {
    dimension: 'authenticity',
    label: 'Authentizität',
    propName: 'authenticity',
    propKey: 'authenticityProp',
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Ordnung — Projektentscheidung auf Basis des BSI-Vokabulars         */
/* ------------------------------------------------------------------ */

/**
 * Die Relevanzskala in aufsteigender Ordnung.
 *
 * **Diese Reihenfolge ist eine Projektentscheidung, keine OSCAL-Vorgabe.** Sie
 * folgt dem BSI-Vokabular `security_targets_levels.csv`, dessen Definitionen
 * eine aufsteigende Wirkung beschreiben: `'0'` „wirkt nicht oder
 * vernachlässigbar gering", `'1'` „wirkt auf dieses Schutzziel hin", `'2'`
 * „wirkt in besonderem Maße". Bezeichnungen vergibt das Vokabular dazu nicht,
 * und über `prop.ns` ist es nicht erreichbar — der `ns` der Props zeigt auf
 * `security_targets.csv`. OSCAL selbst kennt für `prop.value` weder
 * Wertebereich noch Ordnung.
 *
 * Der Index in dieser Liste ist der Rang. Ein Wert, der hier nicht vorkommt,
 * hat keinen Rang und nimmt an keinem Größenvergleich teil.
 */
export const SECURITY_TARGET_RELEVANCE_ORDER: readonly SecurityTargetRelevance[] = [
  '0',
  '1',
  '2',
] as const;

/**
 * Rang eines Relevanzwerts in der Ordnung, oder `undefined` für jeden Wert
 * außerhalb der Skala.
 *
 * Bewusst ein Lookup und kein `parseInt`: Ein schema-valider Wert wie `'3'`
 * oder `'hoch'` darf keinen Rang bekommen, und `parseInt('3')` würde ihm
 * stillschweigend einen geben.
 */
export function getSecurityTargetRelevanceRank(
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const rank = SECURITY_TARGET_RELEVANCE_ORDER.indexOf(
    value as SecurityTargetRelevance,
  );
  return rank === -1 ? undefined : rank;
}

/* ------------------------------------------------------------------ */
/*  Klassifikation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Die drei unterscheidbaren Zustände je Dimension.
 *
 * - `rated` — `prop` vorhanden, Wert liegt in der Skala
 * - `unrated` — kein `prop`: das Dokument trifft keine Aussage
 * - `unknown` — `prop` vorhanden, Wert außerhalb der Skala
 */
export type SecurityTargetRelevanceState = 'rated' | 'unrated' | 'unknown';

export interface SecurityTargetClassification {
  readonly state: SecurityTargetRelevanceState;
  /** Rohwert aus dem Dokument; auch bei `unknown` verlustfrei erhalten. */
  readonly value?: string;
  /** Rang in der Ordnung; ausschließlich bei `rated` gesetzt. */
  readonly rank?: number;
}

const UNRATED: SecurityTargetClassification = { state: 'unrated' };

/**
 * Klassifiziert eine Dimension eines Controls.
 *
 * Maßgeblich ist die Prop-Provenienz, nicht das getypte Feld: nur so bleibt der
 * Unterschied zwischen „kein prop" und „prop mit unbekanntem Wert" sichtbar.
 * Der Adapter übernimmt ein Schutzziel-`prop` nur, wenn `name` **und** `ns`
 * dem BSI-Vokabular entsprechen — ein gleichnamiges `prop` aus einem fremden
 * Namensraum erreicht diese Klassifikation gar nicht erst.
 */
export function classifySecurityTarget(
  control: Pick<Control, SecurityTargetDimension | SecurityTargetDimensionMeta['propKey']>,
  dimension: SecurityTargetDimension,
): SecurityTargetClassification {
  const meta = SECURITY_TARGET_DIMENSIONS.find(
    (entry) => entry.dimension === dimension,
  );
  if (!meta) return UNRATED;

  const prop: PropValue | undefined = control[meta.propKey];
  if (!prop) return UNRATED;

  const rank = getSecurityTargetRelevanceRank(prop.value);
  if (rank === undefined) {
    return { state: 'unknown', value: prop.value };
  }

  return { state: 'rated', value: prop.value, rank };
}

/* ------------------------------------------------------------------ */
/*  Filterwerte                                                        */
/* ------------------------------------------------------------------ */

/**
 * Auswählbare Werte einer Schutzziel-Facette: genau die drei Stufen der Skala.
 *
 * Die Stufen sind **exakt**, keine Schwellen: Wer `1` wählt, sieht genau die
 * Anforderungen der Stufe `1` — `2` ist darin nicht enthalten. Das folgt der
 * Konvention aller übrigen Facetten (Aufwandsstufe, Sicherheitsniveau). Wer
 * mehrere Stufen sehen will, wählt sie zusammen aus; das ODER innerhalb der
 * Facette leistet das.
 *
 * **Unbewertete Anforderungen und skalenfremde Werte sind keine Auswahl.** Eine
 * Facette ist ein Weg zu den Anforderungen, die ein Schutzziel betreffen; über
 * sie zu denen zu navigieren, die es nicht betreffen, hat keinen Nutzen. Beide
 * Zustände fallen bei aktiver Facette heraus — das ist die in GSPP-226 offen
 * gelassene Entscheidung „bei aktivem Filter ausblenden".
 *
 * Ausblenden heißt nicht einebnen: `classifySecurityTarget` führt `unrated` und
 * `unknown` weiter als eigene Zustände, der Rohwert bleibt in der
 * `PropValue`-Provenienz erhalten, und die Stufe `0` trifft ausschließlich
 * Anforderungen, die tatsächlich mit `0` bewertet sind — nie solche ohne
 * Angabe.
 */
export type SecurityTargetFilterValue = SecurityTargetRelevance;

export const SECURITY_TARGET_FILTER_VALUES: readonly SecurityTargetFilterValue[] =
  SECURITY_TARGET_RELEVANCE_ORDER;

const VALID_FILTER_VALUES: ReadonlySet<string> = new Set(
  SECURITY_TARGET_FILTER_VALUES,
);

export function isSecurityTargetFilterValue(
  value: string,
): value is SecurityTargetFilterValue {
  return VALID_FILTER_VALUES.has(value);
}

/**
 * Trifft ein einzelner Facettenwert auf diese Klassifikation zu?
 *
 * Nur ein `rated`-Zustand kann treffen: `unrated` (keine Angabe) und `unknown`
 * (Wert außerhalb der Skala) bleiben ohne Treffer, statt einer Stufe
 * zugeschlagen zu werden.
 */
export function matchesSecurityTargetFilterValue(
  classification: SecurityTargetClassification,
  filterValue: SecurityTargetFilterValue,
): boolean {
  return classification.state === 'rated' && classification.value === filterValue;
}

/**
 * Der Facettenwert, den eine Klassifikation bedient — genau einer bei einer
 * bewerteten Anforderung, keiner bei `unrated` oder `unknown`.
 *
 * Die Zähler einer Dimension summieren sich deshalb auf die Zahl der
 * **bewerteten** Anforderungen, nicht auf die Gesamtzahl.
 */
export function securityTargetFacetKeys(
  classification: SecurityTargetClassification,
): SecurityTargetFilterValue[] {
  return SECURITY_TARGET_FILTER_VALUES.filter((filterValue) =>
    matchesSecurityTargetFilterValue(classification, filterValue),
  );
}

/**
 * ODER innerhalb der Facette: Ein Control passt, wenn es mindestens einen der
 * gewählten Werte erfüllt. Eine leere Auswahl filtert nicht.
 *
 * Die UND-Verknüpfung **über** die vier Dimensionen entsteht in `matchesFilter`
 * dadurch, dass jede Dimension eine eigene Facette ist — konsistent mit allen
 * bestehenden Facetten.
 */
export function passesSecurityTargetFilter(
  control: Pick<Control, SecurityTargetDimension | SecurityTargetDimensionMeta['propKey']>,
  dimension: SecurityTargetDimension,
  selected: readonly SecurityTargetFilterValue[],
): boolean {
  if (selected.length === 0) return true;
  const classification = classifySecurityTarget(control, dimension);
  return selected.some((filterValue) =>
    matchesSecurityTargetFilterValue(classification, filterValue),
  );
}

/* ------------------------------------------------------------------ */
/*  Filterzustand                                                      */
/* ------------------------------------------------------------------ */

/**
 * Auswahl je Schutzziel-Dimension.
 *
 * Liegt hier und nicht im Filter-Hook, damit alles Schutzziel-Wissen — Skala,
 * Ordnung, Klassifikation, Facettenwerte und Auswahlform — eine Quelle hat.
 */
export type SecurityTargetFilters = Record<
  SecurityTargetDimension,
  SecurityTargetFilterValue[]
>;

/** Leere Auswahl für alle vier Schutzziele. */
export function emptySecurityTargetFilters(): SecurityTargetFilters {
  return {
    confidentiality: [],
    integrity: [],
    availability: [],
    authenticity: [],
  };
}

/** Leere Trefferzählung für alle vier Schutzziele. */
export function emptySecurityTargetCounts(): Record<
  SecurityTargetDimension,
  Record<string, number>
> {
  return {
    confidentiality: {},
    integrity: {},
    availability: {},
    authenticity: {},
  };
}

/** Trifft die Auswahl aller vier Dimensionen zu? UND über die Dimensionen. */
export function passesAllSecurityTargetFilters(
  control: Pick<Control, SecurityTargetDimension | SecurityTargetDimensionMeta['propKey']>,
  selection: SecurityTargetFilters,
): boolean {
  return SECURITY_TARGET_DIMENSIONS.every(({ dimension }) =>
    passesSecurityTargetFilter(control, dimension, selection[dimension]),
  );
}

/** Trägt mindestens eine Dimension eine Auswahl? */
export function hasSecurityTargetSelection(selection: SecurityTargetFilters): boolean {
  return SECURITY_TARGET_DIMENSIONS.some(
    ({ dimension }) => selection[dimension].length > 0,
  );
}

/** Zählt ein Control in die Facetten aller vier Dimensionen. */
export function countSecurityTargetFacets(
  control: Pick<Control, SecurityTargetDimension | SecurityTargetDimensionMeta['propKey']>,
  counts: Record<SecurityTargetDimension, Record<string, number>>,
): void {
  for (const { dimension } of SECURITY_TARGET_DIMENSIONS) {
    for (const key of securityTargetFacetKeys(
      classifySecurityTarget(control, dimension),
    )) {
      counts[dimension][key] = (counts[dimension][key] ?? 0) + 1;
    }
  }
}
