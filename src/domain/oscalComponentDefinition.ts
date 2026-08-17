// =============================================================================
// Raw-Typen des OSCAL-Root-Modells `component-definition` (GSPP-248)
//
// Der Implementation Layer bringt eine Eigenheit mit, die der Control Layer
// nicht hatte: Die sechs registrierten BSI-Definitionen deklarieren **drei**
// verschiedene OSCAL-Versionen (1.1.2, 1.1.3, 1.2.2). Eine einheitliche
// „Component-Definitions sind OSCAL x.y.z"-Annahme wäre am Bestand belegbar
// falsch. Die Raw-Typen sind deshalb über `PinnedOscalVersion`
// **parametrisiert**: Ein Feld, das eine Version nicht kennt, ist dort
// `never` — nicht optional.
//
// Die Versionsliteralen unten sind kein globaler Modellversionsschalter,
// sondern Feldprädikate, die am vendorierten Schema erhoben wurden. Gegen ein
// stilles Abdriften schützt `oscalComponentDefinition.versionDrift.test.ts`:
// Der Test liest alle vier gepinnten `oscal_component_schema.json` und weist
// exakt diese Feldunterschiede nach. Kommt upstream ein weiterer dazu, wird er
// dort rot, bevor er hier vergessen wird.
//
// Verlustfreiheit (ADR-2) liegt nicht an diesen Typen: Die Wahrheit ist der
// unveränderte `source`. Die Typen beschreiben, was die Projektion lesen darf.
// =============================================================================

import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { RawOscalMetadata, RawOscalProp } from '@/domain/models';

/**
 * Versionen, in denen `import-component-definition` ein `remarks` deklariert.
 *
 * In 1.1.2 und 1.1.3 verletzt dasselbe Feld `additionalProperties: false` —
 * genau der Befund, der `component-ga-lotse-grundmodul` nach
 * [ADR-7](https://linear.app/grundschutz-plus-plus/issue/ADR-7) sperrt
 * ([BSI #70](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/70)).
 */
export type OscalVersionsWithImportRemarks = '1.2.1' | '1.2.2';

/** Versionen, in denen `port-range` ein `remarks` deklariert. */
export type OscalVersionsWithPortRangeRemarks = '1.2.1' | '1.2.2';

/** Die einzige Version, in der `protocol.name` Pflichtfeld ist. */
export type OscalVersionsWithRequiredProtocolName = '1.1.2';

/**
 * Ein Feld, das die Version `V` nicht kennt. `never` statt `undefined`:
 * Schreibt jemand es doch, ist das ein Typfehler und keine stille Annahme.
 */
type VersionGated<V extends PinnedOscalVersion, Supported extends PinnedOscalVersion, T> =
  V extends Supported ? { remarks?: T } : { remarks?: never };

/** Ein Link, wie ihn das Component-Modell führt — inklusive `resource-fragment`. */
export interface RawOscalComponentLink {
  href: string;
  rel?: string;
  'media-type'?: string;
  'resource-fragment'?: string;
  text?: string;
}

export interface RawOscalSetParameter {
  'param-id': string;
  values: string[];
  remarks?: string;
}

export interface RawOscalResponsibleRole {
  'role-id': string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'party-uuids'?: string[];
  remarks?: string;
}

export interface RawOscalPortRangeBase {
  start?: number;
  end?: number;
  transport?: string;
}

export type RawOscalPortRange<V extends PinnedOscalVersion = PinnedOscalVersion> =
  RawOscalPortRangeBase & VersionGated<V, OscalVersionsWithPortRangeRemarks, string>;

export type RawOscalProtocol<V extends PinnedOscalVersion = PinnedOscalVersion> = {
  uuid?: string;
  title?: string;
  'port-ranges'?: RawOscalPortRange<V>[];
} & (V extends OscalVersionsWithRequiredProtocolName ? { name: string } : { name?: string });

export type RawOscalImportComponentDefinition<
  V extends PinnedOscalVersion = PinnedOscalVersion,
> = { href: string } & VersionGated<V, OscalVersionsWithImportRemarks, string>;

export interface RawOscalImplementedStatement {
  'statement-id': string;
  uuid: string;
  description: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'responsible-roles'?: RawOscalResponsibleRole[];
  remarks?: string;
}

export interface RawOscalImplementedRequirement {
  uuid: string;
  'control-id': string;
  description: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'set-parameters'?: RawOscalSetParameter[];
  'responsible-roles'?: RawOscalResponsibleRole[];
  statements?: RawOscalImplementedStatement[];
  remarks?: string;
}

/**
 * `source` ist Pflichtfeld und verweist auf einen Katalog oder ein Profil —
 * die Kante des Implementation Layers hinunter in den Control Layer. Ohne sie
 * ist ein `control-id` nicht interpretierbar.
 */
export interface RawOscalControlImplementation {
  uuid: string;
  source: string;
  description: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'set-parameters'?: RawOscalSetParameter[];
  'implemented-requirements': RawOscalImplementedRequirement[];
}

export interface RawOscalDefinedComponent<V extends PinnedOscalVersion = PinnedOscalVersion> {
  uuid: string;
  type: string;
  title: string;
  description: string;
  purpose?: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'responsible-roles'?: RawOscalResponsibleRole[];
  protocols?: RawOscalProtocol<V>[];
  'control-implementations'?: RawOscalControlImplementation[];
  remarks?: string;
}

/**
 * Eine Capability kann **eigene** `control-implementations` tragen. Im Bestand
 * nutzt das genau eine Definition (`component-aws-security-hub`); ein Adapter,
 * der Implementierungen nur unter `components` sucht, verliert sie still.
 */
export interface RawOscalCapability {
  uuid: string;
  name: string;
  description: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'incorporates-components'?: Array<{ 'component-uuid': string; description: string }>;
  'control-implementations'?: RawOscalControlImplementation[];
  remarks?: string;
}

export interface RawOscalComponentBackMatter {
  resources?: Array<{
    uuid: string;
    title?: string;
    description?: string;
    citation?: { text: string };
    rlinks?: Array<{ href: string; 'media-type'?: string; hashes?: Array<{ algorithm: string; value: string }> }>;
  }>;
}

/**
 * Der Definitionskörper. Pflicht sind ausschließlich `uuid` und `metadata` —
 * `components`, `capabilities`, `import-component-definitions` und
 * `back-matter` sind schemaseitig **alle** optional. Eine Definition ohne
 * Komponenten ist gültig; die GA-Lotse-Definition ohne implemented
 * requirements und die Keycloak-Definition ohne Capabilities sind deshalb
 * keine Datenfehler.
 */
export interface RawOscalComponentDefinition<V extends PinnedOscalVersion = PinnedOscalVersion> {
  uuid: string;
  metadata: RawOscalMetadata;
  'import-component-definitions'?: RawOscalImportComponentDefinition<V>[];
  components?: RawOscalDefinedComponent<V>[];
  capabilities?: RawOscalCapability[];
  'back-matter'?: RawOscalComponentBackMatter;
}
