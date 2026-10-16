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
// Modelliert sind der Katalogkörper (GSPP-285), der Körper einer Component
// Definition (GSPP-248), der Profilkörper (GSPP-240), der Körper einer Mapping
// Collection (GSPP-245) und der SSP-Körper (GSPP-293). Die übrigen drei Roots
// tragen den gemeinsamen Anteil, bis ihr jeweiliger Adapter kommt; eine
// unionsweite Struktur mit optionalen Feldern aller acht Modelle entsteht
// bewusst nicht.
// =============================================================================

import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { RawOscalCatalog, RawOscalMetadata } from '@/domain/models';
import type { RawOscalComponentDefinition } from '@/domain/oscalComponentDefinition';
import type { RawOscalMappingCollection } from '@/domain/oscalMapping';
import type { RawOscalProfile } from '@/domain/oscalProfile';
import type { RawOscalSystemSecurityPlan } from '@/domain/oscalSystemSecurityPlan';

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
 * Die Projektion dieses gemeinsamen `metadata`-Anteils, die Component
 * Definition, Profil und Mapping Collection in ihrer Sicht führen. Ein Feld ist
 * gesetzt, wenn das Dokument dort einen String deklariert.
 */
export interface OscalRootMetadataView {
  readonly title?: string;
  readonly lastModified?: string;
  readonly version?: string;
  /** Die deklarierte `oscal-version` — die alleinige Versionsautorität. */
  readonly oscalVersion?: string;
}

/* ------------------------------------------------------------------ */
/*  Gemeinsame Elementprojektionen                                     */
/* ------------------------------------------------------------------ */

/**
 * Namespace eines `prop` ohne `ns` laut OSCAL-Metadata-Metaschema (Default
 * des Flags `ns` in allen gepinnten Versionen). Verglichen wird exakt.
 */
export const OSCAL_PROPERTY_NAMESPACE = 'http://csrc.nist.gov/ns/oscal' as const;

/**
 * Projektion eines `prop`. Dieselbe Form führen Component Definition, Profil,
 * Mapping Collection und SSP; gelesen wird sie in `src/adapters/oscalReaders.ts`.
 */
export interface OscalPropView {
  readonly name: string;
  readonly value: string;
  readonly ns?: string;
  readonly class?: string;
}

/** Projektion eines `link` mit allen Nebenfeldern, die das Modell deklariert. */
export interface OscalLinkView {
  readonly href: string;
  readonly rel?: string;
  readonly mediaType?: string;
  readonly resourceFragment?: string;
  readonly text?: string;
}

/** Projektion eines `set-parameter`. */
export interface OscalSetParameterView {
  readonly paramId: string;
  readonly values: readonly string[];
  readonly remarks?: string;
}

/**
 * Projektion einer `responsible-role` (auch `responsible-party` hat diese Form).
 * `props` und `links` der Zuweisung bleiben im Quellgraphen.
 */
export interface OscalResponsibleRoleView {
  readonly roleId: string;
  readonly partyUuids: readonly string[];
  readonly remarks?: string;
}

/**
 * Der Modellkörper eines Root-Keys. Ein neues Modell ergänzt hier genau einen
 * Zweig; bestehende Zweige bleiben unberührt.
 */
export type RawOscalRootBodyFor<K extends OscalRootKey> = K extends 'catalog'
  ? RawOscalCatalog
  : K extends 'component-definition'
    ? RawOscalComponentDefinition
    : K extends 'profile'
      ? RawOscalProfile
      : K extends 'mapping-collection'
        ? RawOscalMappingCollection
        : K extends 'system-security-plan'
          ? RawOscalSystemSecurityPlan
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
export type RawOscalProfileDocument = RawOscalDocumentFor<'profile'>;
export type RawOscalMappingCollectionDocument = RawOscalDocumentFor<'mapping-collection'>;
export type RawOscalSystemSecurityPlanDocument = RawOscalDocumentFor<'system-security-plan'>;
