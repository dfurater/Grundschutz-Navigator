// =============================================================================
// Knotenleser und Diagnosesammler des Profile-Adapters (GSPP-240)
//
// Wie im Component-Adapter (GSPP-248) gilt hier die Regel, die einen Leser von
// einem naiven `?? []` unterscheidet: Ein **vorhandener** Wert der falschen
// Form wird diagnostiziert, statt still zu verschwinden. Normalisiert wird
// nichts — aus einem Einzelobjekt wird kein Array, und der Quellgraph bleibt,
// wie er ist (ADR-2).
//
// Gemeinsam mit den anderen Adaptern sind nur die Strukturleser aus
// `oscalReaders.ts`; dieses Modul bindet sie an seine Diagnosefunktion. Die
// modellspezifischen Leser — Selektoren, `alters`, rekursive `parts` — stehen
// hier.
// =============================================================================

import { createStructureReaders } from '@/adapters/oscalReaders';
import { readString, type JsonObject } from '@/domain/jsonGuards';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDiagnostic, OscalDiagnosticValidator } from '@/domain/oscalDiagnostics';
import type { ReferenceDocument } from '@/domain/referenceResolution';
import { PROFILE_ROOT_TYPE } from '@/domain/profileModel';
import type {
  ProfileLink,
  ProfileParam,
  ProfilePart,
  ProfileProp,
} from '@/domain/profileModel';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

/** Stufe der modellinternen Befunde dieses Adapters. */
export const PROFILE_ADAPTER_STAGE = 'domain' as const;

/**
 * Vertragsversion des Adapters; sie geht in jede Diagnosesignatur ein und wird
 * erhöht, wenn sich Codes, Pfade oder Parameter einer bestehenden Diagnose
 * ändern.
 */
export const PROFILE_ADAPTER_VALIDATOR: OscalDiagnosticValidator = Object.freeze({
  name: 'gspp-profile-adapter',
  version: '1',
});

export const PROFILE_ADAPTER_DIAGNOSTIC_CODES = Object.freeze({
  /** `imports` fehlt oder ist leer — schemaseitig sind 1..n verlangt. */
  IMPORTS_MISSING: 'OSCAL_PROFILE_IMPORTS_MISSING',
  /** `import` ohne `href`: Die zu tailorende Quelle ist nicht benannt. */
  IMPORT_HREF_MISSING: 'OSCAL_PROFILE_IMPORT_HREF_MISSING',
  /** `include-all` **und** `include-controls` am selben Knoten. */
  SELECTION_AMBIGUOUS: 'OSCAL_PROFILE_SELECTION_AMBIGUOUS',
  /** Weder `include-all` noch `include-controls` am selben Knoten. */
  SELECTION_MISSING: 'OSCAL_PROFILE_SELECTION_MISSING',
  /** Mehr als eine Strukturdirektive in `merge`. */
  MERGE_STRUCTURE_AMBIGUOUS: 'OSCAL_PROFILE_MERGE_STRUCTURE_AMBIGUOUS',
  /** `merge` ohne `flat`, `as-is` oder `custom`. */
  MERGE_STRUCTURE_MISSING: 'OSCAL_PROFILE_MERGE_STRUCTURE_MISSING',
  /** `alter` ohne `control-id` — das Änderungsziel fehlt. */
  ALTER_CONTROL_ID_MISSING: 'OSCAL_PROFILE_ALTER_CONTROL_ID_MISSING',
  /** Knoten hat nicht die vom Modell erwartete Form (z. B. Objekt statt Array). */
  STRUCTURE_UNEXPECTED: 'OSCAL_PROFILE_STRUCTURE_UNEXPECTED',
});

export type { JsonObject } from '@/domain/jsonGuards';

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export interface DeriveState {
  readonly diagnostics: OscalDiagnostic[];
  readonly artifactKey: string | null;
  readonly oscalVersion: PinnedOscalVersion | null;
  readonly referenceDocument: ReferenceDocument;
}

export function diagnose(state: DeriveState, code: string, path: string): OscalDiagnostic {
  const diagnostic = createOscalDiagnostic({
    code,
    stage: PROFILE_ADAPTER_STAGE,
    validator: PROFILE_ADAPTER_VALIDATOR,
    path,
    artifact: {
      key: state.artifactKey,
      rootType: PROFILE_ROOT_TYPE,
      oscalVersion: state.oscalVersion,
    },
  });
  state.diagnostics.push(diagnostic);
  return diagnostic;
}

const structureReaders = createStructureReaders<DeriveState>((state, path) => {
  diagnose(state, PROFILE_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, path);
});

export const { readArrayField, readObjectArrayField, readStringArrayField } = structureReaders;

export function readProps(
  node: JsonObject,
  path: string,
  state: DeriveState,
): readonly ProfileProp[] {
  return readObjectArrayField(node, 'props', path, state).flatMap(
    ({ node: prop, path: propPath }) => {
      const name = readString(prop.name);
      const value = readString(prop.value);
      if (name === undefined || value === undefined) {
        diagnose(state, PROFILE_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, propPath);
        return [];
      }
      return [{ name, value, ns: readString(prop.ns), class: readString(prop.class) }];
    },
  );
}

export function readLinks(
  node: JsonObject,
  path: string,
  state: DeriveState,
): readonly ProfileLink[] {
  return readObjectArrayField(node, 'links', path, state).flatMap(
    ({ node: link, path: linkPath }) => {
      const href = readString(link.href);
      if (href === undefined) {
        diagnose(state, PROFILE_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, linkPath);
        return [];
      }
      return [{ href, rel: readString(link.rel), text: readString(link.text) }];
    },
  );
}

/**
 * Liest `parts` rekursiv. Die Verschachtelung ist im OSCAL-Modell unbegrenzt;
 * eine Abflachung würde die Gliederung eines ergänzten Textbausteins
 * verlieren.
 */
export function readParts(
  node: JsonObject,
  path: string,
  state: DeriveState,
): readonly ProfilePart[] {
  return readObjectArrayField(node, 'parts', path, state).map(
    ({ node: part, path: partPath }) => ({
      id: readString(part.id),
      name: readString(part.name),
      ns: readString(part.ns),
      class: readString(part.class),
      title: readString(part.title),
      // Markup bleibt Text; gerendert wird es nie als HTML.
      prose: readString(part.prose),
      props: readProps(part, partPath, state),
      links: readLinks(part, partPath, state),
      parts: readParts(part, partPath, state),
    }),
  );
}

export function readParams(
  node: JsonObject,
  path: string,
  state: DeriveState,
): readonly ProfileParam[] {
  return readObjectArrayField(node, 'params', path, state).map(
    ({ node: param, path: paramPath }) => ({
      id: readString(param.id),
      class: readString(param.class),
      label: readString(param.label),
      usage: readString(param.usage),
      values: readStringArrayField(param, 'values', paramPath, state),
      props: readProps(param, paramPath, state),
      links: readLinks(param, paramPath, state),
    }),
  );
}
