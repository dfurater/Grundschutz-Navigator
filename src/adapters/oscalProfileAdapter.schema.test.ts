// =============================================================================
// Stufe 3 für Profile (GSPP-240)
//
// Der Adapter bringt keine eigene Schemaprüfung mit — er reicht die in Stufe 2
// gebundene Matrixzelle an `validateAgainstPinnedSchema()` weiter (GSPP-343).
// Der Nachweis hier ist deshalb ein Versionsnachweis, kein Validatornachweis.
//
// Beim Profile ist das nicht theoretisch, sondern am vendorierten Schema
// belegbar: `import` und `merge` sind unter 1.1.2/1.1.3 gewöhnliche Objekte mit
// optionalen Properties und ab 1.2.1 `anyOf`-Konstruktionen, die genau eine
// Variante verlangen. **Derselbe Knoten** ist damit unter 1.1.3 gültig und
// unter 1.2.2 ein Schemabefund — genau das kann ein Adapter mit einer globalen
// Modellversionskonstante nicht leisten.
// =============================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import { parseProfileDocument, validateProfileSchema } from './oscalProfileDocument';
import { OscalRootDispatchError } from './oscalRootDispatch';
import { resetCompiledSchemaCache } from '@/domain/oscalSchemaValidation';
import type { OscalDocumentContext } from '@/domain/models';
import { getSchemaPin, PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import type { OscalSchemaPin, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import {
  makeProfileSource,
  makeProfileWithBothSelections,
  makeProfileWithoutImportHref,
  makeProfileWithoutImports,
  makeProfileWithoutSelection,
  makeProfileWithoutVersion,
  makeProfileWithSchemaDirective,
  makeProfileWithUnpinnedVersion,
  PROFILE_ARTIFACT_SPECS,
} from '@/test/fixtures/profiles';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };

/** Versionen ohne `anyOf`-Schranke auf `import` und `merge`. */
const PERMISSIVE_VERSIONS = ['1.1.2', '1.1.3'] as const;
/** Versionen mit `anyOf`-Schranke auf `import` und `merge`. */
const CONSTRAINED_VERSIONS = ['1.2.1', '1.2.2'] as const;

beforeEach(() => {
  resetCompiledSchemaCache();
});

/**
 * Die Matrixzelle für `profile` × Version.
 *
 * Erwartungswerte werden **abgeleitet**, nicht zweitgepflegt: Eine hier
 * hartkodierte Schema-`$id` oder ein hartkodierter Vendor-Pfad würde bei einer
 * legitimen Pin-Aktualisierung in `oscalVersionMatrix.mjs` fälschlich rot —
 * oder, schlimmer, eine falsche Bindung verdecken, weil beide Seiten dieselbe
 * veraltete Konstante trügen. Geprüft wird deshalb die **Bindung**: dass das
 * Dokument genau die Zelle seiner deklarierten Version bekommt.
 */
function pinFor(version: PinnedOscalVersion): OscalSchemaPin {
  const pin = getSchemaPin('profile', version);
  if (!pin) throw new Error(`Die Versionsmatrix pinnt profile@${version} nicht`);
  return pin;
}

function dispatchErrorOf(makeSource: () => unknown): OscalRootDispatchError {
  let thrown: unknown;
  try {
    parseProfileDocument(makeSource(), context);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(OscalRootDispatchError);
  return thrown as OscalRootDispatchError;
}

describe('Versionsbindung der Schemaprüfung', () => {
  it('prüft jedes Profil gegen seine eigene deklarierte Version', async () => {
    for (const specification of PROFILE_ARTIFACT_SPECS) {
      const document = parseProfileDocument(makeProfileSource(specification), {
        ...context,
        upstreamPath: specification.upstreamPath,
      });

      expect(document.pin.rootKey).toBe('profile');
      expect(document.pin.oscalVersion).toBe(specification.oscalVersion);
      expect(document.pin).toEqual(pinFor(specification.oscalVersion));

      const result = await validateProfileSchema(document);
      expect(result.ok, specification.artifactKey).toBe(specification.schemaValid);
    }
  });

  it('pinnt profile über alle vier Versionen', () => {
    for (const version of PINNED_OSCAL_VERSIONS) {
      const document = parseProfileDocument(makeProfileWithoutSelection(version), context);

      expect(document.pin, version).toEqual(pinFor(version));
      expect(document.pin.oscalVersion, version).toBe(version);
    }
  });

  it('weist eine nicht gepinnte oscal-version fail-closed ab', () => {
    const { diagnostic } = dispatchErrorOf(() => makeProfileWithUnpinnedVersion());

    expect(diagnostic.code).toBe('OSCAL_ROOT_VERSION_UNSUPPORTED');
    // Kein Rückfall auf eine Nachbarversion: Der Dokumentwert erscheint nicht
    // als gepinnte Version im Artefaktkontext.
    expect(diagnostic.artifact.oscalVersion).toBeNull();
  });

  it('weist eine fehlende oscal-version fail-closed ab', () => {
    const { diagnostic } = dispatchErrorOf(() => makeProfileWithoutVersion());

    expect(diagnostic.code).toBe('OSCAL_VERSION_MISSING');
    expect(diagnostic.path).toBe('/profile/metadata/oscal-version');
  });

  it('wählt die Zelle nach metadata.oscal-version und nie nach $schema', () => {
    const declared = '1.2.2';
    const foreign = '1.1.3';

    const matching = parseProfileDocument(
      makeProfileWithSchemaDirective(declared, pinFor(declared).schemaId),
      context,
    );
    expect(matching.oscalVersion).toBe(declared);
    expect(matching.pin).toEqual(pinFor(declared));

    // `$schema` zeigt auf 1.1.3, `metadata.oscal-version` auf 1.2.2.
    const { diagnostic } = dispatchErrorOf(() =>
      makeProfileWithSchemaDirective(declared, pinFor(foreign).schemaId),
    );

    expect(diagnostic.code).toBe('OSCAL_SCHEMA_DIRECTIVE_CONFLICT');
    expect(diagnostic.path).toBe('/$schema');
    // Ausgewählt wurde die Zelle aus metadata.oscal-version — die Direktive
    // hat den Konflikt ausgelöst, aber nichts ausgewählt.
    expect(diagnostic.artifact.oscalVersion).toBe(declared);
    expect(diagnostic.params.expected).toBe(pinFor(declared).schemaId);
  });
});

describe('import — derselbe Knoten, zwei Ergebnisse', () => {
  it('akzeptiert beide Selektionsformen an einem import unter 1.1.2 und 1.1.3', async () => {
    for (const version of PERMISSIVE_VERSIONS) {
      const document = parseProfileDocument(makeProfileWithBothSelections(version), context);

      await expect(validateProfileSchema(document), version).resolves.toEqual({ ok: true });
    }
  });

  it('weist denselben import ab 1.2.1 als schemawidrig aus', async () => {
    for (const version of CONSTRAINED_VERSIONS) {
      const document = parseProfileDocument(makeProfileWithBothSelections(version), context);
      const result = await validateProfileSchema(document);

      expect(result.ok, version).toBe(false);
      if (result.ok) continue;
      expect(result.diagnostic.artifact.oscalVersion).toBe(version);
    }
  });

  it('akzeptiert einen import ohne Selektionsform unter 1.1.2 und 1.1.3', async () => {
    for (const version of PERMISSIVE_VERSIONS) {
      const document = parseProfileDocument(makeProfileWithoutSelection(version), context);

      await expect(validateProfileSchema(document), version).resolves.toEqual({ ok: true });
    }
  });

  it('weist einen import ohne Selektionsform ab 1.2.1 ab', async () => {
    for (const version of CONSTRAINED_VERSIONS) {
      const document = parseProfileDocument(makeProfileWithoutSelection(version), context);

      expect((await validateProfileSchema(document)).ok, version).toBe(false);
    }
  });

  it('verlangt href nur unter 1.1.2 und 1.1.3', async () => {
    for (const version of PERMISSIVE_VERSIONS) {
      const document = parseProfileDocument(makeProfileWithoutImportHref(version), context);

      expect((await validateProfileSchema(document)).ok, version).toBe(false);
    }
    for (const version of CONSTRAINED_VERSIONS) {
      const document = parseProfileDocument(makeProfileWithoutImportHref(version), context);

      await expect(validateProfileSchema(document), version).resolves.toEqual({ ok: true });
    }
  });

  it('behält den Knoten in der Projektion, unabhängig von der Schemavalidität', () => {
    for (const version of [...PERMISSIVE_VERSIONS, ...CONSTRAINED_VERSIONS]) {
      const { view } = parseProfileDocument(makeProfileWithBothSelections(version), context);

      // Verlustfreiheit gilt unabhängig von der Schemavalidität (ADR-2, ADR-7).
      const selection = view.imports[0]?.selection;
      expect(selection?.kind, version).toBe('ambiguous');
      if (selection?.kind !== 'ambiguous') continue;
      expect(selection.includeControls[0]?.withIds).toEqual(['GC.1.1']);
    }
  });
});

describe('Pflichtstruktur des Profilkörpers', () => {
  it('weist ein Profil ohne imports über alle vier Versionen als schemawidrig aus', async () => {
    for (const version of PINNED_OSCAL_VERSIONS) {
      const document = parseProfileDocument(makeProfileWithoutImports(version), context);

      expect((await validateProfileSchema(document)).ok, version).toBe(false);
    }
  });
});
