// =============================================================================
// Schema-Bundle — der einzige Zugriffsweg auf die gepinnten NIST-Schemas
// (GSPP-343)
//
// Die Tabelle bildet jede existierende Matrixzelle auf **einen festen**
// dynamischen Import ab. Sie ist absichtlich ausgeschrieben und nicht aus
// `vendorPath` zusammengesetzt: Ein aus Daten gebauter Importpfad wäre zur
// Bauzeit nicht analysierbar, und ein aus Dokumentinhalt gebauter wäre eine
// Pfadinjektion. Der Schlüssel stammt ausschließlich aus dem bereits
// validierten Schema-Pin der Stufe 2.
//
// Der dynamische Import lädt genau die ausgewählte Zelle; die übrigen 29
// Schemas bleiben in eigenen Chunks und werden nie angefasst. Dieser eine
// Modulabruf geht zur Laufzeit an **dieselbe Origin** wie die Anwendung — die
// Bytes stammen aus dem eigenen Bundle. Ein Bezug von einer fremden Origin
// findet nicht statt, insbesondere nicht von `github.com` (Release-Asset) oder
// `csrc.nist.gov` (die `$id` der Schemas).
//
// Die Schemapfade sind als **einzige** Ausnahme relativ und nicht über `@/`
// geschrieben: Der Alias ist auf `./src/` abgebildet (vite.config.ts,
// vitest.browser.config.ts, tsconfig.app.json), und `schemas/oscal/` liegt
// bewusst außerhalb von `src/` — es sind vendorte NIST-Artefakte, die ein
// eigenes Bauzeit-Gate (`npm run verify-oscal-schemas`) bewacht, kein
// Anwendungsquellcode. Ein Alias kann diese Pfade also gar nicht ausdrücken.
// Gegen ein Abdriften von der Matrix schützt statt eines Alias ein Test:
// `oscalSchemaBundle.node.test.ts` bindet jedes Literal an den `vendorPath`
// seiner Zelle, und `oscalSchemaValidation.test.ts` prüft je Zelle die geladene
// `$id` gegen den Pin.
// =============================================================================

import type {
  OscalRootKey,
  OscalSchemaPin,
  PinnedOscalVersion,
} from '@/domain/oscalVersionMatrix';

/** Ein geladenes Schemamodul; der Inhalt bleibt bewusst `unknown`. */
export interface OscalSchemaModule {
  readonly default: unknown;
}

export type OscalSchemaLoader = () => Promise<OscalSchemaModule>;

/** Der Zellenschlüssel `<root>@<version>` — Root und Version je aus fester Menge. */
export function toSchemaCellKey(rootKey: OscalRootKey, version: PinnedOscalVersion): string {
  return `${rootKey}@${version}`;
}

const SCHEMA_LOADERS: Readonly<Record<string, OscalSchemaLoader>> = Object.freeze({
  'catalog@1.1.2': () => import('../../schemas/oscal/v1.1.2/oscal_catalog_schema.json'),
  'catalog@1.1.3': () => import('../../schemas/oscal/v1.1.3/oscal_catalog_schema.json'),
  'catalog@1.2.1': () => import('../../schemas/oscal/v1.2.1/oscal_catalog_schema.json'),
  'catalog@1.2.2': () => import('../../schemas/oscal/v1.2.2/oscal_catalog_schema.json'),
  'profile@1.1.2': () => import('../../schemas/oscal/v1.1.2/oscal_profile_schema.json'),
  'profile@1.1.3': () => import('../../schemas/oscal/v1.1.3/oscal_profile_schema.json'),
  'profile@1.2.1': () => import('../../schemas/oscal/v1.2.1/oscal_profile_schema.json'),
  'profile@1.2.2': () => import('../../schemas/oscal/v1.2.2/oscal_profile_schema.json'),
  'mapping-collection@1.2.1': () => import('../../schemas/oscal/v1.2.1/oscal_mapping_schema.json'),
  'mapping-collection@1.2.2': () => import('../../schemas/oscal/v1.2.2/oscal_mapping_schema.json'),
  'component-definition@1.1.2': () => import('../../schemas/oscal/v1.1.2/oscal_component_schema.json'),
  'component-definition@1.1.3': () => import('../../schemas/oscal/v1.1.3/oscal_component_schema.json'),
  'component-definition@1.2.1': () => import('../../schemas/oscal/v1.2.1/oscal_component_schema.json'),
  'component-definition@1.2.2': () => import('../../schemas/oscal/v1.2.2/oscal_component_schema.json'),
  'system-security-plan@1.1.2': () => import('../../schemas/oscal/v1.1.2/oscal_ssp_schema.json'),
  'system-security-plan@1.1.3': () => import('../../schemas/oscal/v1.1.3/oscal_ssp_schema.json'),
  'system-security-plan@1.2.1': () => import('../../schemas/oscal/v1.2.1/oscal_ssp_schema.json'),
  'system-security-plan@1.2.2': () => import('../../schemas/oscal/v1.2.2/oscal_ssp_schema.json'),
  'assessment-plan@1.1.2': () => import('../../schemas/oscal/v1.1.2/oscal_assessment-plan_schema.json'),
  'assessment-plan@1.1.3': () => import('../../schemas/oscal/v1.1.3/oscal_assessment-plan_schema.json'),
  'assessment-plan@1.2.1': () => import('../../schemas/oscal/v1.2.1/oscal_assessment-plan_schema.json'),
  'assessment-plan@1.2.2': () => import('../../schemas/oscal/v1.2.2/oscal_assessment-plan_schema.json'),
  'assessment-results@1.1.2': () => import('../../schemas/oscal/v1.1.2/oscal_assessment-results_schema.json'),
  'assessment-results@1.1.3': () => import('../../schemas/oscal/v1.1.3/oscal_assessment-results_schema.json'),
  'assessment-results@1.2.1': () => import('../../schemas/oscal/v1.2.1/oscal_assessment-results_schema.json'),
  'assessment-results@1.2.2': () => import('../../schemas/oscal/v1.2.2/oscal_assessment-results_schema.json'),
  'plan-of-action-and-milestones@1.1.2': () => import('../../schemas/oscal/v1.1.2/oscal_poam_schema.json'),
  'plan-of-action-and-milestones@1.1.3': () => import('../../schemas/oscal/v1.1.3/oscal_poam_schema.json'),
  'plan-of-action-and-milestones@1.2.1': () => import('../../schemas/oscal/v1.2.1/oscal_poam_schema.json'),
  'plan-of-action-and-milestones@1.2.2': () => import('../../schemas/oscal/v1.2.2/oscal_poam_schema.json'),
});

/**
 * Der Loader der gewählten Zelle oder `null`, wenn das Bundle sie nicht führt.
 * `null` ist fail-closed zu behandeln: Stufe 3 gilt dann als technisch nicht
 * verfügbar, nicht als bestanden.
 */
export function getOscalSchemaLoader(pin: OscalSchemaPin): OscalSchemaLoader | null {
  return SCHEMA_LOADERS[toSchemaCellKey(pin.rootKey, pin.oscalVersion)] ?? null;
}

/** Alle im Bundle geführten Zellenschlüssel — Grundlage des Vollständigkeitstests. */
export function listOscalSchemaCellKeys(): readonly string[] {
  return Object.keys(SCHEMA_LOADERS);
}
