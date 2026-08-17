// =============================================================================
// OSCAL-Root-Envelope — Typebene des generischen Root-Dispatch (GSPP-285)
//
// Vorher war die Typebene fest verdrahtet: `RawOscalDocument { catalog }`. Ein
// Profil, eine Mapping Collection oder eine Component Definition hatte auf der
// Typebene keinen Platz — und der Adapter deutete sie zur Laufzeit stillschweigend
// als Katalog.
//
// Hier steht stattdessen der Envelope: genau **ein** Root-Key aus den acht
// bekannten, dazu die nach NIST zulässige Schema-Direktive `$schema`. Die
// Root-Key-Menge wird aus `OscalRootKey` (GSPP-283) abgeleitet und nicht
// dupliziert — eine zweite Liste könnte von der Versionsmatrix abdriften.
//
// Modelliert sind heute der Katalogkörper (GSPP-285) und der Körper einer
// Component Definition (GSPP-248). Die übrigen sechs Roots tragen den
// gemeinsamen Anteil, bis ihr jeweiliger Adapter kommt; eine unionsweite
// Struktur mit optionalen Feldern aller acht Modelle entsteht bewusst nicht.
// =============================================================================

import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { RawOscalCatalog, RawOscalMetadata } from '@/domain/models';
import type { RawOscalComponentDefinition } from '@/domain/oscalComponentDefinition';

/**
 * Top-Level-Property der Schema-Direktive. Sie ist in allen acht NIST-Schemas
 * ausdrücklich in den Root-`properties` deklariert und fällt damit nicht unter
 * `additionalProperties: false`. Sie ist aber **niemals** Versionsautorität —
 * das ist allein `metadata.oscal-version` (docs/OSCAL_VALIDATION.md).
 */
export const OSCAL_SCHEMA_DIRECTIVE_KEY = '$schema';

/**
 * Der gemeinsame Anteil aller acht OSCAL-Root-Objekte: `metadata` ist in jedem
 * von ihnen Pflichtfeld und verlangt seinerseits `oscal-version`. Genau deshalb
 * kann der Dispatch Root-Erkennung und Versionsermittlung in einem Schritt
 * erledigen.
 */
export interface RawOscalRootBody {
  metadata: RawOscalMetadata;
}

/**
 * Der Modellkörper eines Root-Keys. Ein neues Modell ergänzt hier genau einen
 * Zweig; bestehende Zweige bleiben unberührt.
 */
export type RawOscalRootBodyFor<K extends OscalRootKey> = K extends 'catalog'
  ? RawOscalCatalog
  : K extends 'component-definition'
    ? RawOscalComponentDefinition
    : RawOscalRootBody;

/**
 * Ein OSCAL-Dokument mit genau dem Root-Key `K`.
 *
 * Die strukturelle Regel dahinter stammt aus allen acht Schemas: `required`
 * enthält genau den Root-Key, `additionalProperties` ist `false`, und die
 * Top-Level-`properties` sind exakt `["$schema", "<root-key>"]`.
 */
export type RawOscalDocumentFor<K extends OscalRootKey> = {
  [OSCAL_SCHEMA_DIRECTIVE_KEY]?: string;
} & { [P in K]: RawOscalRootBodyFor<K> };

/**
 * Diskriminierte Union über alle acht Root-Keys — der Root-Key ist das
 * unterscheidende Merkmal. Abgeleitet aus `OscalRootKey`, damit ein neuer
 * Root-Typ im Standard hier nicht vergessen werden kann.
 */
export type RawOscalDocument = {
  [K in OscalRootKey]: RawOscalDocumentFor<K>;
}[OscalRootKey];

/** Bequeme Aliase für die modellierten Roots. */
export type RawOscalCatalogDocument = RawOscalDocumentFor<'catalog'>;
export type RawOscalComponentDefinitionDocument = RawOscalDocumentFor<'component-definition'>;
