# Filter-System — Grundschutz++ Navigator

Multi-Facet-Filterung des Grundschutz-Katalogs mit URL-Parameter-Synchronisation.

## Überblick

Filter und Sortierung werden bidirektional mit URL-Suchparametern synchronisiert (`src/hooks/useFilterParams.ts` auf Basis von React Routers `useSearchParams`):

- Filter-Zustand steht in der URL und ist per URL teilbar.
- Die URL ist die einzige Quelle der Wahrheit: Filter und Sortierung werden bei jedem Render aus ihr abgeleitet.

Practice- und Topic-Auswahl laufen nicht über Query-Parameter, sondern über die kataloggescopte Route (`/katalog/:catalogKey/:groupId`, Muster in `src/app/routes.ts`). Control-Details verwenden `/katalog/:catalogKey/kontrolle/:altIdentifier`. Der `CatalogBrowser` (`src/features/catalog/CatalogBrowser.tsx`) schränkt über die Gruppenauswahl die Eingabemenge des Hooks ein (`scopedControls`); erst darauf greifen die Query-Parameter-Filter. `practiceIds`/`groupIds` in `ControlFilters` sind unabhängige Filterdimensionen des Hooks (`src/hooks/useFilteredControls.ts`).

## Filter-Dimensionen

| Dimension | URL-Parameter | Mögliche Werte | Typ |
|-----------|--------------|---------------|-----|
| Sicherheitsniveau | `sl` | `normal-SdT`, `erhöht` | Mehrfachauswahl |
| Aufwandsstufe | `el` | `0`, `1`, `2`, `3`, `4`, `5` | Mehrfachauswahl |
| Verpflichtungsgrad | `mv` | `MUSS`, `SOLLTE`, `KANN` | Mehrfachauswahl |
| Tags | `tags` | Beliebige Tags | Mehrfachauswahl |
| Zielobjekt-Kategorien | `zk` | Kategorien (z.B. `Server`, `Client`) | Mehrfachauswahl |
| Handlungswort | `hw` | Handlungswörter | Mehrfachauswahl |
| Dokumentationstyp | `dt` | Dokumentationstypen | Mehrfachauswahl |
| Link-Beziehung | `lr` | `related`, `required` | Mehrfachauswahl |
| Schutzziel Vertraulichkeit | `stc` | `1`, `2` | Mehrfachauswahl |
| Schutzziel Integrität | `sti` | `1`, `2` | Mehrfachauswahl |
| Schutzziel Verfügbarkeit | `stav` | `1`, `2` | Mehrfachauswahl |
| Schutzziel Authentizität | `stau` | `1`, `2` | Mehrfachauswahl |
| Sortierung | `sort` | `<feld>:<richtung>[,…]` | Einzelwert |

Der Linkfilter projiziert auf `related` und `required` (`toFilterableLinkRelation` in `src/domain/controlRelationships.ts`). Andere `rel`-Werte (`reference`, offene OSCAL-Tokens, fehlendes `rel`) werden nicht umgedeutet und erzeugen keine Filtersemantik; sie bleiben in Detailansicht, Suche und der allgemeinen Linkspalte des CSV-Exports (`links` in `src/features/export/csvExport.ts`) sichtbar.

### Schutzziel-Facetten (CIA + Authentizität)

Die vier Schutzziele sind vier eigenständige Facetten, nicht eine gemeinsame: ODER innerhalb einer Dimension, UND über die Dimensionen — dieselbe Konvention wie bei allen übrigen Facetten. Die gesamte Logik liegt in `src/domain/securityTargets.ts`.

Im Filterpanel stehen die vier Dimensionen in einer Sektion `Schutzziele` (`src/features/catalog/SecurityTargetFilterSection.tsx`). Die Zeile eines Schutzziels trägt die Trefferzahl über beide Stufen und wählt mit einem Haken beide; erst dann erscheinen die Stufen einzeln darunter und lassen sich abwählen. Ist genau eine Stufe gewählt, steht die Elternzeile im dritten Kontrollzustand (`HTMLInputElement.indeterminate`). Am URL-Parameter ändert das nichts: Die Stufenzeilen sind genau die kommaseparierten Werte, der Elternhaken ist die Abkürzung für beide.

Auswählbar sind die beiden Stufen, die ein Schutzziel betreffen (`1` und `2`), und sie sind exakt, keine Schwellen: `stc=1` trifft genau die Anforderungen der Stufe `1`; mehrere Stufen ergeben die Obermenge über das ODER (`stc=1,2`).

Die Beschriftungen zeigen den Katalogwert, keine app-eigene Stufenbezeichnung (`Stufe 1`, `Stufe 2` in `getSecurityTargetFilterLabel`, `src/features/vocabulary/display.ts`): Das Vokabular `security_targets_levels.csv` kennt zu `0`–`2` keine Bezeichnung, nur eine Definition. Die Definitionen stehen gekürzt in einer Legende über den Optionen und wörtlich im Tooltip (`getSecurityTargetFilterTooltip`); die Legende steht einmal je Sektion, weil ein `title`-Tooltip auf Touch nicht erreichbar ist.

Die Stufe `0`, unbewertete Anforderungen und skalenfremde Werte sind keine Auswahl und fallen bei aktiver Facette heraus. Ausblenden heißt nicht einebnen: `classifySecurityTarget` führt sie weiter als eigene Zustände (`rated` mit dem Wert `0`, `unrated`, `unknown`), der Rohwert bleibt in der `PropValue`-Provenienz erhalten, und die Detailansicht zeigt ihn unverändert.

Verengt ist allein die Auswahlmenge der Facette (`SECURITY_TARGET_FILTER_VALUES`). Die Ordnung `SECURITY_TARGET_RELEVANCE_ORDER` bleibt dreistellig, weil sie die Skala des Vokabulars abbildet und über `RELEVANCE_SCALE_MAX` (`src/components/StatusMeta.tsx`) die Relevanzskala der Detailansicht speist. Ein Schutzziel-Parameter mit dem Wert `0` wird beim Deserialisieren verworfen, ohne die übrigen Werte desselben Parameters zu entwerten: `stc=0,2` ergibt `['2']` (`isSecurityTargetFilterValue` in `src/hooks/useFilterParams.ts`).

Drei Constraints sind dabei bindend:

**Die Skala ist eine Projektentscheidung, keine OSCAL-Vorgabe.** OSCAL definiert für `prop.value` keinen Wertebereich: `schemas/oscal/v1.1.3/oscal_catalog_schema.json` führt das Feld unter `oscal-catalog-oscal-metadata:property` als `$ref` auf `StringDatatype`, und `StringDatatype` ist dort ein nicht leerer String ohne Randwhitespace, ohne Enum, ohne Zahlentyp und ohne Ordnung. Die Schemata sind SHA-256-gepinnt und offline prüfbar (`npm run verify-oscal-schemas`); der Versionsbezug steht in `src/domain/oscalVersionMatrix.mjs`.

Dass `0`, `1` und `2` die gültigen Werte sind und `2` mehr Relevanz bedeutet als `1`, stammt aus dem BSI-Vokabular `security_targets_levels.csv`. Über `prop.ns` ist diese Datei nicht erreichbar: Der `ns` der vier Schutzziel-Props zeigt auf `security_targets.csv`, das nach Schutzziel-Namen indiziert ist und die Stufen nicht kennt. Die beiden Stellen, die die Stufenbedeutung brauchen, wählen die Datei selbst aus (`resolveSecurityTargetLevel` in `src/domain/vocabulary.ts`, `getSecurityTargetFilterTooltip` in `src/features/vocabulary/display.ts`). Skala und Ordnung stehen an genau einer Stelle (`SECURITY_TARGET_RELEVANCE_ORDER`) und werden über einen Lookup ausgewertet, nicht über `parseInt`: Ein schema-valider Fremdwert wie `'3'` landet in `unknown` statt in einer Stufe.

**Ein fehlendes `prop` ist nicht der Wert `0`.** `props` ist auf `control` optional — das gepinnte Schema führt für `oscal-catalog-oscal-catalog:control` nur `["id", "title"]` als `required`. Abwesenheit bedeutet „keine Aussage", `0` bedeutet „ausgewertet, nicht relevant". `classifySecurityTarget` liefert für ein Control mit dem Wert `0` weiterhin `rated` samt Rang und für eines ohne `prop` `unrated`.

**Die Facette trifft keine Compliance-Aussage.** Eine Schutzziel-Relevanz beschreibt, worauf ein Control einzahlt — nicht, ob es umgesetzt oder wirksam ist. Umsetzungsstatus existiert in OSCAL ausschließlich im SSP auf `by-component`; im gepinnten `schemas/oscal/v1.1.3/oscal_ssp_schema.json` trägt genau eine Definition das Feld `implementation-status`, nämlich `oscal-ssp-oscal-ssp:by-component`.

Alle drei Belege werden in `src/domain/securityTargets.catalog.node.test.ts` gegen die gepinnten Schemata geprüft. Die Trefferzahlen sind deshalb keine Abdeckung: Sie zählen je Dimension die bewerteten Anforderungen auf, und ihre Summe liegt unter der Gesamtzahl, weil die unbewerteten in keine Stufe fallen.

Der Filterzustand betrifft ausschließlich Klasse-1-Daten aus dem verifizierten BSI-Bestand. Der URL-Sync ist hier richtig und erwünscht — er ist ausdrücklich kein Muster für Klasse-2-Ansichten (Kommentar in `src/hooks/useFilterParams.ts`).

Mehrfachwerte werden kommasepariert in einem Parameter kodiert (z.B. `mv=MUSS,SOLLTE`). Die Volltextsuche ist davon getrennt und läuft ausschließlich über `/suche?q=…`. Ein `q`-Parameter auf einer Katalogroute ist kein Katalogfilter und wird ignoriert (`useFilterParams` liest `q` nie).

## Kennungssuche

Eine Suchanfrage, die exakt dem in OSCAL 1.1.3 gepinnten `UUIDDatatype` (UUID v4/v5) entspricht, wird nicht als Volltext behandelt, sondern über einen eigenen Kennungsindex aufgelöst (`classifyQuery` in `src/domain/identifierQuery.ts`, Auflösung in `src/features/search/useSearch.ts`). Der Index liegt im kataloggescopten Suchcache und erbt damit Katalogtrennung und Invalidierung der Volltextindizes.

| Eingabe | Treffer |
| --- | --- |
| Control-`alt-identifier` | genau dieses Control, an erster Stelle |
| Praktik-Kennung | alle Controls dieser Praktik |
| Themen-Kennung | alle Controls aller Gruppen mit dieser Kennung |
| Vokabular-Kennung (Gefährdung, Zielobjektkategorie, Handlungswort, Modalverb, …) | alle Controls, die den zugehörigen Wert führen |
| Dokumentkennungen (`catalog.uuid`, `document-id`, `parties.uuid`, `resources.uuid`) | keine Treffer |
| Kennung aus einem anderen Katalog | keine Treffer |

Ein `ChildOfUUID`-Wert verweist auf einen anderen Vokabular-Eintrag. Die Controls des verweisenden Eintrags werden der Elternkennung nicht zugeschlagen; aufgelöst wird ausschließlich über die eigene Kennung eines Eintrags (`collectControlVocabularyIdentifiers` in `src/domain/vocabulary.ts` wertet nur `identifierColumns` aus, keine Verweisspalten).

Eine unvollständige oder syntaktisch abweichende Kennung liefert kein Ergebnis und fällt nicht auf die Volltextsuche zurück. Als Kennung gilt eine Eingabe dafür bereits an ihrer Form, und zwar über zwei Anker: Sie beginnt mit acht Hexziffern und einem Bindestrich, gefolgt von beliebigen Zeichen ohne Leerraum — oder sie füllt das Segmentraster 8-4-4-4-12 vollständig aus. Geprüft wird ausschließlich die Form, nie der Zeichenvorrat; Leerraum grenzt ab, weil er aus der Eingabe eine Wortfolge macht. Ein Fachbegriff wie `Taxonomy-L4` erfüllt keinen der beiden Anker und wird weiterhin über den Volltext gesucht. Kennungsspalten sind aus dem Volltextindex ausgenommen — FlexSearch zerlegt sie an den Bindestrichen, und Einträge mit gemeinsamen Teiltokens würden sich sonst gegenseitig treffen. Welche Spalten das sind, entscheidet das Build-Skript am CSV-Header (Spaltenname endet ohne Rücksicht auf Groß-/Kleinschreibung auf `uuid`, Wert- und Definitionsspalte ausgenommen) und schreibt es als `identifierColumns` beziehungsweise `identifierReferenceColumns` in `vocabularies.json` (`inferIdentifierColumns` in `scripts/vocabulary-utils.mjs`).

Die WLAN-Props `Taxonomy-L1` bis `Taxonomy-L4` sind keine zusätzliche Filterdimension (`ControlFilters` enthält sie nicht). Ihre exakten Namen und Werte fließen in den Volltextindex ein (`metadataText` in `src/features/search/useSearch.ts`) und bleiben dadurch über `/suche?q=…` auffindbar. Der CSV-Export führt je Ebene eine Wert- und eine optionale Namespace-Spalte (`taxonomy_l1[_ns]` bis `taxonomy_l4[_ns]`, `taxonomyCSVFields` in `src/features/export/csvExport.ts`).

## Filter-Zustand

Der Filter-Zustand ist in `src/hooks/useFilteredControls.ts` definiert:

```typescript
export interface ControlFilters {
  practiceIds: string[];
  groupIds: string[];
  securityLevels: SecurityLevel[];
  effortLevels: EffortLevel[];
  modalverben: Modalverb[];
  tags: string[];
  zielobjektKategorien: string[];
  handlungsworte: string[];
  dokumentationstypen: string[];
  linkRelationen: LinkRelation[];
  /** Auswahl je Schutzziel — vier eigenständige Facetten */
  securityTargets: Record<SecurityTargetDimension, SecurityTargetFilterValue[]>;
}

export const emptyFilters: ControlFilters = {
  practiceIds: [],
  groupIds: [],
  securityLevels: [],
  effortLevels: [],
  modalverben: [],
  tags: [],
  zielobjektKategorien: [],
  handlungsworte: [],
  dokumentationstypen: [],
  linkRelationen: [],
  securityTargets: emptySecurityTargetFilters(),
};
```

## Filter-Logik

Die Filter-Funktion in `src/hooks/useFilteredControls.ts` prüft jede Dimension:

```typescript
function matchesFilter(
  control: Control,
  filters: ControlFilters,
): boolean {
  // Practice filter
  if (filters.practiceIds.length > 0 &&
      !filters.practiceIds.includes(control.practiceId)) {
    return false;
  }

  // Group/Topic filter
  if (filters.groupIds.length > 0 &&
      !filters.groupIds.includes(control.groupId)) {
    return false;
  }

  // ... weitere Dimensionen

  return true;
}
```

### Logische Verknüpfung

- **Innerhalb einer Dimension**: ODER-Verknüpfung (Control muss mind. einen ausgewählten Wert haben)
- **Zwischen Dimensionen**: UND-Verknüpfung (alle aktiven Dimensionen müssen erfüllt sein)

Beispiel:
- `sl=normal-SdT,erhöht` → Normal ODER Erhöht
- `sl=normal-SdT&mv=MUSS` → Normal UND MUSS
- `stc=1&sti=2` → Vertraulichkeit genau 1 UND Integrität genau 2
- `stc=1,2` → Vertraulichkeit 1 ODER 2

## URL-Parameter-Sync

Die Synchronisation mit URL-Parametern erfolgt über `src/hooks/useFilterParams.ts` auf Basis von React Routers `useSearchParams`. Die URL ist die einzige Quelle der Wahrheit — Filter und Sortierung werden bei jedem Render aus ihr abgeleitet.

### Lesen aus URL (Deserialisierung)

Kommaseparierte Werte werden gesplittet und gegen Validator-Sets geprüft; unbekannte Werte werden verworfen statt übernommen:

```typescript
const VALID_MODAL: Set<string> = new Set<Modalverb>(['MUSS', 'SOLLTE', 'KANN']);

function deserializeFilters(params: URLSearchParams): ControlFilters {
  return {
    ...emptyFilters,
    modalverben: splitParam(params, 'mv').filter((v) => VALID_MODAL.has(v)) as Modalverb[],
    // ... analog für sl, el, tags, zk, hw, dt, lr
  };
}
```

### Schreiben in URL (Serialisierung)

Aktive Filter werden kommasepariert gesetzt, leere Dimensionen entfernt und sofort synchronisiert. Der Sync läuft über `setSearchParams(params, { replace: true })`, sodass Filter-Änderungen keine History-Einträge erzeugen.

```typescript
function setOrDelete(params: URLSearchParams, key: string, values: string[]) {
  if (values.length > 0) {
    params.set(key, values.join(','));
  } else {
    params.delete(key);
  }
}
```

Die Default-Sortierung (`id:asc`) wird nicht in die URL geschrieben (`isDefaultSort` in `src/hooks/useFilterParams.ts`).

## Facet-Zählung

Für jede Dimension werden die verfügbaren Werte mit ihrer Häufigkeit gezählt:

```typescript
export interface FacetCounts {
  securityLevels: Record<string, number>;
  effortLevels: Record<string, number>;
  modalverben: Record<string, number>;
  tags: Record<string, number>;
  zielobjektKategorien: Record<string, number>;
  handlungsworte: Record<string, number>;
  dokumentationstypen: Record<string, number>;
  linkRelationen: Record<string, number>;
  /** Treffer je Schutzziel-Dimension und Facettenwert */
  securityTargets: Record<SecurityTargetDimension, Record<string, number>>;
}
```

Die Schutzziel-Zähler folgen derselben Einfrier-Regel wie die übrigen Dimensionen, und zwar je Dimension (`resolveCounts` in `src/features/catalog/SecurityTargetFilterSection.tsx`). Eine Anforderung zählt je Dimension in höchstens einen Wert: Ohne Angabe, außerhalb der Skala und mit der Stufe `0` zählt sie in keinen. Die Zahl der Elternzeile ist die Summe über beide Stufen (`sumSecurityTargetCounts`); sie zählt jede Anforderung höchstens einmal, weil das Domänenmodell je Dimension genau ein Prop-Feld hält.

### Two-Sets-Ansatz

- **Facets vom Gesamtkatalog** (`facetCounts`): Ungefilterte Anzahl — gilt für jede aktiv gefilterte Dimension
- **Facets vom gefilterten Set** (`filteredFacetCounts`): Gefilterte Anzahl — gilt für jede inaktive Dimension

Daraus folgt das Sichtbarkeitsverhalten: Eine Sektion ohne Optionen und ohne Auswahl wird ausgeblendet; ein gewählter Wert ohne Treffer bleibt mit Zähler `0` sichtbar (`isSectionVisible` und `visibleEntries` in `src/features/catalog/FilterPanel.tsx`).

## Sortierung

Sortierung ist als mehrstufiges Array definiert:

```typescript
export type SortField = 'id' | 'title' | 'modalverb' | 'securityLevel' | 'effortLevel';
export type SortDirection = 'asc' | 'desc';

export interface SortEntry {
  field: SortField;
  direction: SortDirection;
}

export type SortConfig = SortEntry[];  // Erster Eintrag ist primäre Sortierung
```

### URL-Format

Sortierung in URL: `sort=id:asc` oder `sort=modalverb:asc,securityLevel:desc`

### Sort-Logik

```typescript
const modalverbOrder: Record<string, number> = { KANN: 0, SOLLTE: 1, MUSS: 2 };

function compareByField(a: Control, b: Control, field: SortField): number {
  switch (field) {
    case 'id':
      return a.id.localeCompare(b.id, 'de', { numeric: true });
    case 'title':
      return a.title.localeCompare(b.title, 'de');
    case 'modalverb': {
      const aVal = modalverbOrder[a.modalverb ?? ''] ?? 3;
      const bVal = modalverbOrder[b.modalverb ?? ''] ?? 3;
      return aVal - bVal;
    }
    case 'securityLevel':
      return (a.securityLevel ?? '').localeCompare(b.securityLevel ?? '');
    case 'effortLevel':
      return Number(a.effortLevel ?? 99) - Number(b.effortLevel ?? 99);
  }
}
```

## useFilteredControls Hook

Der Haupt-Hook kombiniert Facettenzählung, Filterung und Sortierung. Die globale Volltextsuche verwendet stattdessen den separaten Hook `useSearch` (`src/features/search/useSearch.ts`):

```typescript
export function useFilteredControls(
  controls: Control[],
  filters: ControlFilters,
  sort: SortConfig = [{ field: 'id', direction: 'asc' }],
): UseFilteredControlsResult {
  const facetCounts = useMemo(() => computeFacetCounts(controls), [controls]);
  // hasActiveFilters aus allen Dimensionen ableiten
  // filtered = matchesFilter + compareControls
  // filteredFacetCounts = computeFacetCounts(filtered)

  return {
    filtered,
    totalCount: controls.length,
    facetCounts,
    filteredFacetCounts,
    hasActiveFilters,
  };
}
```

## FilterPanel-Komponente

Die UI-Komponente in `src/features/catalog/FilterPanel.tsx` zeigt Facet-Sektionen mit Checkboxen und Zählern (`FilterSection`, `CheckboxLabel`), die Ergebnisanzahl (`N Kontrollen` bzw. `N von M Kontrollen`, `aria-live`) und — nur bei aktiven Filtern — die Schaltfläche `Zurücksetzen`. Mobil steckt dasselbe Panel in `src/features/catalog/CatalogMobileFilterSheet.tsx` (Bottom-Sheet, Auslöser `Filter anzeigen`); eine separate Bestätigung gibt es nicht, die Auswahl schreibt sofort in die URL.

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- `src/hooks/useFilteredControls.ts` — Filter-Implementierung
- `src/hooks/useFilterParams.ts` — URL-Sync-Implementierung
- `src/features/catalog/FilterPanel.tsx` — Filter-UI
