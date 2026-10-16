// =============================================================================
// Strukturleser der OSCAL-Adapter
//
// Ein **vorhandener** Wert der falschen Form wird diagnostiziert, statt still
// zu `[]` zu werden — sonst verschwände eine Kardinalitätsverletzung spurlos
// aus der Projektion. Normalisiert wird nichts: Aus einem Einzelobjekt wird
// kein Array, und der Quellgraph bleibt, wie er ist (ADR-2).
//
// Jeder Adapter bindet die Leser an seine eigene Diagnosefunktion; Code,
// Stufe, Validator und Root-Typ der Diagnose kommen damit aus dem Adapter.
// `createElementReaders` baut darauf die Leser der Elemente, die mehrere
// Modelle in derselben Form führen (`props`, `links`, `set-parameters`,
// `responsible-roles`).
// =============================================================================

import { isJsonObject, readString, type JsonObject } from '@/domain/jsonGuards';
import type {
  OscalLinkView,
  OscalPropView,
  OscalResponsibleRoleView,
  OscalSetParameterView,
} from '@/domain/oscalRootDocument';

export interface StructureReaders<TState> {
  /** Liest ein Arrayfeld; `undefined` und `null` gelten als abwesend. */
  readArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly unknown[];
  /** Wie `readArrayField`, liefert aber nur die Objekteinträge und diagnostiziert den Rest. */
  readObjectArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly { readonly node: JsonObject; readonly path: string }[];
  /** Wie `readArrayField`, liefert aber nur die String-Einträge und diagnostiziert den Rest. */
  readStringArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly string[];
}

/**
 * Erzeugt die Strukturleser eines Adapters. `diagnoseUnexpected` meldet einen
 * Knoten unerwarteter Form am übergebenen JSON-Pointer-Pfad.
 */
export function createStructureReaders<TState>(
  diagnoseUnexpected: (state: TState, path: string) => void,
): StructureReaders<TState> {
  function readArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly unknown[] {
    const value = node[key];
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value;

    diagnoseUnexpected(state, `${path}/${key}`);
    return [];
  }

  function readObjectArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly { readonly node: JsonObject; readonly path: string }[] {
    return readArrayField(node, key, path, state).flatMap((entry, index) => {
      const entryPath = `${path}/${key}/${index}`;
      if (!isJsonObject(entry)) {
        diagnoseUnexpected(state, entryPath);
        return [];
      }
      return [{ node: entry, path: entryPath }];
    });
  }

  function readStringArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly string[] {
    return readArrayField(node, key, path, state).flatMap((entry, index) => {
      if (typeof entry !== 'string') {
        diagnoseUnexpected(state, `${path}/${key}/${index}`);
        return [];
      }
      return [entry];
    });
  }

  return { readArrayField, readObjectArrayField, readStringArrayField };
}

export interface ElementReaders<TState> {
  readProps(node: JsonObject, path: string, state: TState): readonly OscalPropView[];
  readLinks(node: JsonObject, path: string, state: TState): readonly OscalLinkView[];
  readSetParameters(node: JsonObject, path: string, state: TState): readonly OscalSetParameterView[];
  readResponsibleRoles(
    node: JsonObject,
    path: string,
    state: TState,
  ): readonly OscalResponsibleRoleView[];
  /** `responsible-parties` haben die Form einer `responsible-role`. */
  readResponsibleParties(
    node: JsonObject,
    path: string,
    state: TState,
  ): readonly OscalResponsibleRoleView[];
}

/**
 * Erzeugt die Leser der Elemente, die mehrere OSCAL-Modelle in derselben Form
 * führen. Ein Eintrag ohne sein Pflichtfeld (`name`/`value`, `href`,
 * `param-id`, `role-id`) wird an seinem Pfad diagnostiziert und fällt aus der
 * Projektion; der Quellgraph behält ihn.
 */
export function createElementReaders<TState>(
  { readObjectArrayField, readStringArrayField }: StructureReaders<TState>,
  diagnoseUnexpected: (state: TState, path: string) => void,
): ElementReaders<TState> {
  function readProps(node: JsonObject, path: string, state: TState): readonly OscalPropView[] {
    return readObjectArrayField(node, 'props', path, state).flatMap(({ node: prop, path: propPath }) => {
      const name = readString(prop.name);
      const value = readString(prop.value);
      if (name === undefined || value === undefined) {
        diagnoseUnexpected(state, propPath);
        return [];
      }
      return [{ name, value, ns: readString(prop.ns), class: readString(prop.class) }];
    });
  }

  function readLinks(node: JsonObject, path: string, state: TState): readonly OscalLinkView[] {
    return readObjectArrayField(node, 'links', path, state).flatMap(({ node: link, path: linkPath }) => {
      const href = readString(link.href);
      if (href === undefined) {
        diagnoseUnexpected(state, linkPath);
        return [];
      }
      return [{
        href,
        rel: readString(link.rel),
        mediaType: readString(link['media-type']),
        resourceFragment: readString(link['resource-fragment']),
        text: readString(link.text),
      }];
    });
  }

  function readSetParameters(
    node: JsonObject,
    path: string,
    state: TState,
  ): readonly OscalSetParameterView[] {
    return readObjectArrayField(node, 'set-parameters', path, state).flatMap(
      ({ node: parameter, path: parameterPath }) => {
        const paramId = readString(parameter['param-id']);
        if (paramId === undefined) {
          diagnoseUnexpected(state, parameterPath);
          return [];
        }
        return [{
          paramId,
          values: readStringArrayField(parameter, 'values', parameterPath, state),
          remarks: readString(parameter.remarks),
        }];
      },
    );
  }

  function readRoleAssignments(
    node: JsonObject,
    key: 'responsible-roles' | 'responsible-parties',
    path: string,
    state: TState,
  ): readonly OscalResponsibleRoleView[] {
    return readObjectArrayField(node, key, path, state).flatMap(
      ({ node: role, path: rolePath }) => {
        const roleId = readString(role['role-id']);
        if (roleId === undefined) {
          diagnoseUnexpected(state, rolePath);
          return [];
        }
        return [{
          roleId,
          partyUuids: readStringArrayField(role, 'party-uuids', rolePath, state),
          remarks: readString(role.remarks),
        }];
      },
    );
  }

  return {
    readProps,
    readLinks,
    readSetParameters,
    readResponsibleRoles: (node, path, state) =>
      readRoleAssignments(node, 'responsible-roles', path, state),
    readResponsibleParties: (node, path, state) =>
      readRoleAssignments(node, 'responsible-parties', path, state),
  };
}
