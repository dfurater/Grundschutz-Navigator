// =============================================================================
// Raw-Typen des OSCAL-Root-Modells `profile` (GSPP-240)
//
// Ein Profile ist keine Kopie eines Catalog, sondern eine Auswahl-, Merge- und
// Änderungsanweisung. Die Raw-Typen bilden genau diese Anweisung ab — nicht ihr
// Ergebnis. Aufgelöst wird hier nichts (das ist GSPP-291).
//
// Wie beim Component-Modell sind die Typen über `PinnedOscalVersion`
// **parametrisiert**, und aus demselben belegten Grund: Das Profile-Schema hat
// zwischen 1.1.3 und 1.2.1 seine Struktur geändert. Die drei registrierten
// BSI-Profile deklarieren zwar alle 1.1.3, aber eine Modellkonstante „Profile
// sind OSCAL 1.1.3" wäre trotzdem falsch — der Gesamtbestand des Projekts
// umfasst vier Versionen (GSPP-283), und derselbe Root wird in jeder von ihnen
// gegen eine andere Zelle geprüft.
//
// Die Versionsliterale unten sind deshalb Feldprädikate, die am vendorierten
// Schema erhoben wurden, und kein globaler Modellversionsschalter. Gegen ein
// stilles Abdriften schützt `oscalProfile.versionDrift.test.ts`: Der Test liest
// alle vier gepinnten `oscal_profile_schema.json` und weist exakt diese
// Strukturunterschiede nach.
//
// Verlustfreiheit (ADR-2) liegt nicht an diesen Typen: Die Wahrheit ist der
// unveränderte `source`. Die Typen beschreiben, was die Projektion lesen darf.
// =============================================================================

import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { RawOscalLink, RawOscalMetadata, RawOscalParam, RawOscalPart, RawOscalProp } from '@/domain/models';

/**
 * Versionen, in denen `import` per `anyOf` **genau eine** der beiden
 * Selektionsformen verlangt.
 *
 * In 1.1.2 und 1.1.3 gibt es diese Schranke nicht: Dort ist `import` ein
 * gewöhnliches Objekt mit vier optionalen Properties, und ein `import` mit
 * beiden oder mit keiner Selektionsform ist schemavalide. Derselbe Knoten ist
 * damit unter 1.1.3 gültig und ab 1.2.1 ein Schemabefund — dieselbe Lage wie
 * bei `import-component-definition.remarks` in GSPP-248.
 */
export type OscalVersionsWithImportSelectionConstraint = '1.2.1' | '1.2.2';

/**
 * Versionen, in denen `import.href` Pflichtfeld ist.
 *
 * Ab 1.2.1 führen beide `anyOf`-Zweige `href` nur noch als optionale Property.
 * Ein `import` ohne `href` ist deshalb unter 1.1.3 schemawidrig und ab 1.2.1
 * zulässig — die Projektion muss ihn in beiden Fällen tragen können.
 */
export type OscalVersionsWithRequiredImportHref = '1.1.2' | '1.1.3';

/**
 * Versionen, in denen `merge` per `anyOf` **genau eine** Strukturdirektive
 * verlangt (`flat`, `as-is` oder `custom`), jeweils optional mit `combine`.
 *
 * Unter 1.1.2 und 1.1.3 sind alle vier Properties optional und dürfen
 * koexistieren.
 */
export type OscalVersionsWithMergeVariantConstraint = '1.2.1' | '1.2.2';

/** Versionen, in denen `matching` ein `remarks` deklariert. */
export type OscalVersionsWithMatchingRemarks = '1.2.1' | '1.2.2';

/**
 * Versionen, in denen `insert-controls` per `anyOf` genau eine der beiden
 * Selektionsformen verlangt.
 */
export type OscalVersionsWithInsertControlsConstraint = '1.2.1' | '1.2.2';

/**
 * `include-all` ist ein bedeutungstragendes **leeres** Objekt: Es sagt „alle
 * Controls der importierten Quelle", ohne ein einziges Feld zu führen. Ein
 * Adapter, der leere Objekte wegwirft, verliert genau diese Aussage.
 */
export type RawOscalIncludeAll = Record<string, never>;

/** `flat` ist ebenfalls ein leeres Markerobjekt. */
export type RawOscalMergeFlat = Record<string, never>;

export type RawOscalMatching<V extends PinnedOscalVersion = PinnedOscalVersion> = {
  pattern?: string;
} & (V extends OscalVersionsWithMatchingRemarks ? { remarks?: string } : { remarks?: never });

/**
 * Selektion aus einer importierten Quelle. `with-ids` und `matching` sind
 * **zwei** Wege: explizite ID-Liste und Glob-Muster. Sie schließen sich
 * schemaseitig nicht aus und dürfen im Modell nicht zu einer Liste
 * verschmelzen — sonst wäre nach dem Parsen nicht mehr erkennbar, ob eine
 * Auswahl aufgezählt oder gemustert war.
 */
export interface RawOscalSelectControlById<V extends PinnedOscalVersion = PinnedOscalVersion> {
  'with-child-controls'?: 'yes' | 'no';
  'with-ids'?: string[];
  matching?: RawOscalMatching<V>[];
}

type RawOscalImportHref<V extends PinnedOscalVersion> =
  V extends OscalVersionsWithRequiredImportHref ? { href: string } : { href?: string };

type RawOscalImportSelection<V extends PinnedOscalVersion> =
  V extends OscalVersionsWithImportSelectionConstraint
    ? { 'include-all': RawOscalIncludeAll; 'include-controls'?: never }
    | { 'include-all'?: never; 'include-controls': RawOscalSelectControlById<V>[] }
    : { 'include-all'?: RawOscalIncludeAll; 'include-controls'?: RawOscalSelectControlById<V>[] };

/**
 * Ein Import verweist auf einen Catalog **oder ein weiteres Profile** —
 * Profilketten sind ausdrücklich zulässig. Im BSI-Bestand ist jedes `href` ein
 * dokumentinternes `#uuid`-Fragment auf eine `back-matter`-Ressource; der
 * relative Pfad liegt eine Kante weiter in `rlinks[].href`.
 */
export type RawOscalProfileImport<V extends PinnedOscalVersion = PinnedOscalVersion> = {
  'exclude-controls'?: RawOscalSelectControlById<V>[];
} & RawOscalImportHref<V> & RawOscalImportSelection<V>;

export interface RawOscalMergeCombine {
  method?: 'use-first' | 'merge' | 'keep';
}

type RawOscalInsertControlsSelection<V extends PinnedOscalVersion> =
  V extends OscalVersionsWithInsertControlsConstraint
    ? { 'include-all': RawOscalIncludeAll; 'include-controls'?: never }
    | { 'include-all'?: never; 'include-controls': RawOscalSelectControlById<V>[] }
    : { 'include-all'?: RawOscalIncludeAll; 'include-controls'?: RawOscalSelectControlById<V>[] };

export type RawOscalInsertControls<V extends PinnedOscalVersion = PinnedOscalVersion> = {
  order?: 'keep' | 'ascending' | 'descending';
  'exclude-controls'?: RawOscalSelectControlById<V>[];
} & RawOscalInsertControlsSelection<V>;

export interface RawOscalProfileGroup<V extends PinnedOscalVersion = PinnedOscalVersion> {
  id?: string;
  class?: string;
  title: string;
  params?: RawOscalParam[];
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  parts?: RawOscalPart[];
  groups?: RawOscalProfileGroup<V>[];
  'insert-controls'?: RawOscalInsertControls<V>[];
}

export interface RawOscalMergeCustom<V extends PinnedOscalVersion = PinnedOscalVersion> {
  groups?: RawOscalProfileGroup<V>[];
  'insert-controls'?: RawOscalInsertControls<V>[];
}

type RawOscalMergeStructure<V extends PinnedOscalVersion> =
  V extends OscalVersionsWithMergeVariantConstraint
    ? { flat: RawOscalMergeFlat; 'as-is'?: never; custom?: never }
    | { flat?: never; 'as-is': boolean; custom?: never }
    | { flat?: never; 'as-is'?: never; custom: RawOscalMergeCustom<V> }
    : { flat?: RawOscalMergeFlat; 'as-is'?: boolean; custom?: RawOscalMergeCustom<V> };

export type RawOscalProfileMerge<V extends PinnedOscalVersion = PinnedOscalVersion> = {
  combine?: RawOscalMergeCombine;
} & RawOscalMergeStructure<V>;

/** Die vier Positionen, an denen eine Ergänzung ansetzen kann. */
export type RawOscalAddPosition = 'before' | 'after' | 'starting' | 'ending';

export interface RawOscalAdd {
  position?: RawOscalAddPosition;
  'by-id'?: string;
  title?: string;
  params?: RawOscalParam[];
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  parts?: RawOscalPart[];
}

export interface RawOscalRemove {
  'by-name'?: string;
  'by-class'?: string;
  'by-id'?: string;
  'by-item-name'?: 'param' | 'prop' | 'link' | 'part' | 'mapping' | 'map';
  'by-ns'?: string;
}

/**
 * Eine Änderungsanweisung an genau einer Control der importierten Quelle.
 *
 * **Mehrere `alter`-Einträge dürfen dieselbe `control-id` adressieren.** Das
 * ist keine Randbedingung, sondern der reale Bestand: Das WLAN-Profil trägt am
 * Snapshot 290 `alters` über 58 eindeutige `control-id`, bis zu fünf Einträge
 * je Control. Eine Ablage, die über `control-id` schlüsselt und dabei
 * überschreibt, verliert dort 232 Anweisungen.
 */
export interface RawOscalAlter {
  'control-id': string;
  removes?: RawOscalRemove[];
  adds?: RawOscalAdd[];
}

export interface RawOscalProfileSetParameter {
  'param-id': string;
  class?: string;
  'depends-on'?: string;
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  label?: string;
  usage?: string;
  values?: string[];
}

/**
 * `modify` ist über alle vier gepinnten Versionen strukturgleich und deshalb
 * bewusst **nicht** versionsparametrisiert — ein Typparameter ohne
 * Feldunterschied wäre eine Behauptung ohne Beleg.
 */
export interface RawOscalModify {
  'set-parameters'?: RawOscalProfileSetParameter[];
  alters?: RawOscalAlter[];
}

export interface RawOscalProfileBackMatter {
  resources?: Array<{
    uuid: string;
    title?: string;
    description?: string;
    citation?: { text: string };
    rlinks?: Array<{
      href: string;
      'media-type'?: string;
      hashes?: Array<{ algorithm: string; value: string }>;
    }>;
  }>;
}

/**
 * Der Profilkörper. Pflicht sind `uuid`, `metadata` und `imports` (mindestens
 * ein Eintrag) — über alle vier gepinnten Versionen unverändert. `merge`,
 * `modify` und `back-matter` sind optional.
 */
export interface RawOscalProfile<V extends PinnedOscalVersion = PinnedOscalVersion> {
  uuid: string;
  metadata: RawOscalMetadata;
  imports: RawOscalProfileImport<V>[];
  merge?: RawOscalProfileMerge<V>;
  modify?: RawOscalModify;
  'back-matter'?: RawOscalProfileBackMatter;
}
