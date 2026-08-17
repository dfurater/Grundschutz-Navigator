// @vitest-environment node
// =============================================================================
// Versionsdrift des Profile-Modells (GSPP-240)
//
// Die Raw-Typen in `oscalProfile.ts` tragen vier Versionsprädikate. Sie sind
// Feldprädikate, keine Modellversionskonstante — und genau deshalb müssen sie
// am Schema hängen und nicht am Gedächtnis. Dieser Test liest alle vier
// gepinnten `oscal_profile_schema.json` und weist die **vollständige** Menge
// der Definitionsunterschiede nach.
//
// Die Drift ist beim Profile größer als beim Component-Modell: Zwischen 1.1.3
// und 1.2.1 sind `import`, `merge`, `insert-controls` und `group` von
// gewöhnlichen Objekten zu `anyOf`-Konstruktionen umgebaut worden. Eine
// Signatur, die nur `properties` und `required` vergleicht, würde das
// übersehen — deshalb erfasst `shapeOf()` hier auch die `anyOf`-Zweige.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSchemaPin, PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type {
  OscalVersionsWithImportSelectionConstraint,
  OscalVersionsWithInsertControlsConstraint,
  OscalVersionsWithMatchingRemarks,
  OscalVersionsWithMergeVariantConstraint,
  OscalVersionsWithRequiredImportHref,
} from '@/domain/oscalProfile';

interface SchemaNode {
  properties?: Record<string, unknown>;
  required?: string[];
  anyOf?: SchemaNode[];
}

interface DefinitionShape {
  readonly props: readonly string[];
  readonly required: readonly string[];
  /** Je `anyOf`-Zweig seine `required`-Liste; leer, wenn es keine gibt. */
  readonly variants: readonly (readonly string[])[];
}

/**
 * Liest das für `profile` × `version` gepinnte Schema.
 *
 * Der Pfad kommt aus der Versionsmatrix und wird hier nicht zweitgepflegt: Ein
 * eigenes Pfadmuster würde nach einer Pin-Aktualisierung entweder rot oder,
 * schlimmer, weiter das alte Asset lesen. Repo-relativ; das Arbeitsverzeichnis
 * des Testlaufs ist die Projektwurzel.
 */
function readProfileSchema(version: PinnedOscalVersion): { definitions: Record<string, SchemaNode> } {
  const pin = getSchemaPin('profile', version);
  if (!pin) throw new Error(`Die Versionsmatrix pinnt profile@${version} nicht`);

  return JSON.parse(readFileSync(pin.vendorPath, 'utf8')) as {
    definitions: Record<string, SchemaNode>;
  };
}

/**
 * Reduziert ein Schema auf `<Assembly-Name> → { props, required, variants }`.
 * Der Namensraumpräfix vor dem Doppelpunkt wandert zwischen den Versionen
 * (`oscal-profile:` → `oscal-control-common:`) und ist deshalb abgeschnitten.
 */
function shapeOf(version: PinnedOscalVersion): ReadonlyMap<string, DefinitionShape> {
  return new Map(
    Object.entries(readProfileSchema(version).definitions).map(([key, definition]) => [
      key.split(':').pop() ?? key,
      {
        props: Object.keys(definition.properties ?? {}).sort(),
        required: [...(definition.required ?? [])].sort(),
        variants: (definition.anyOf ?? []).map((branch) => [...(branch.required ?? [])].sort()),
      },
    ]),
  );
}

const shapes = new Map(
  PINNED_OSCAL_VERSIONS.map((version) => [version, shapeOf(version)] as const),
);

function signature(version: PinnedOscalVersion, name: string): string {
  const shape = shapes.get(version)?.get(name);
  return shape === undefined ? 'ABSENT' : JSON.stringify(shape);
}

function propsOf(version: PinnedOscalVersion, name: string): readonly string[] {
  return shapes.get(version)?.get(name)?.props ?? [];
}

function requiredOf(version: PinnedOscalVersion, name: string): readonly string[] {
  return shapes.get(version)?.get(name)?.required ?? [];
}

function variantsOf(
  version: PinnedOscalVersion,
  name: string,
): readonly (readonly string[])[] {
  return shapes.get(version)?.get(name)?.variants ?? [];
}

/* ------------------------------------------------------------------ */
/*  Bindung der Feldprädikate an die gemessene Partition                */
/* ------------------------------------------------------------------ */

/**
 * Die Partition „welche Versionen kennen dieses Konstrukt" ist eine Aussage
 * über das **Schema**, nicht über die Versionsmatrix: Die Matrix pinnt Root ×
 * Version auf ein Schema-Asset und führt keine modellinternen Strukturfakten.
 * Ableitbar ist die Partition deshalb nur aus den vendorierten Schemas selbst.
 *
 * Was sie braucht, ist trotzdem eine Bindung an `PINNED_OSCAL_VERSIONS` —
 * sonst fiele eine fünfte gepinnte Version stillschweigend in den jeweils
 * permissiven Zweig. Die Tupel unten schließen diese Lücke doppelt:
 *
 *  * **zur Laufzeit** gegen die am Schema gemessene Menge über *alle* gepinnten
 *    Versionen, und
 *  * **zur Übersetzungszeit** gegen das Typprädikat in `oscalProfile.ts` — die
 *    `AssertTrue`-Aliase unten kompilieren nur, wenn Tupel und Union dieselbe
 *    Menge bezeichnen.
 *
 * Eine neue gepinnte Version macht damit zuerst den Laufzeitvergleich rot; wer
 * daraufhin nur das Tupel nachzieht, bekommt den Übersetzungsfehler.
 */
const IMPORT_SELECTION_CONSTRAINED = ['1.2.1', '1.2.2'] as const;
const REQUIRED_IMPORT_HREF = ['1.1.2', '1.1.3'] as const;
const MERGE_VARIANT_CONSTRAINED = ['1.2.1', '1.2.2'] as const;
const INSERT_CONTROLS_CONSTRAINED = ['1.2.1', '1.2.2'] as const;
const MATCHING_REMARKS = ['1.2.1', '1.2.2'] as const;

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

export type ImportSelectionPartitionBound = AssertTrue<
  Equals<OscalVersionsWithImportSelectionConstraint, typeof IMPORT_SELECTION_CONSTRAINED[number]>
>;
export type RequiredImportHrefPartitionBound = AssertTrue<
  Equals<OscalVersionsWithRequiredImportHref, typeof REQUIRED_IMPORT_HREF[number]>
>;
export type MergeVariantPartitionBound = AssertTrue<
  Equals<OscalVersionsWithMergeVariantConstraint, typeof MERGE_VARIANT_CONSTRAINED[number]>
>;
export type InsertControlsPartitionBound = AssertTrue<
  Equals<OscalVersionsWithInsertControlsConstraint, typeof INSERT_CONTROLS_CONSTRAINED[number]>
>;
export type MatchingRemarksPartitionBound = AssertTrue<
  Equals<OscalVersionsWithMatchingRemarks, typeof MATCHING_REMARKS[number]>
>;

describe('Feldprädikate decken alle gepinnten Versionen ab', () => {
  it('misst jede Partition über PINNED_OSCAL_VERSIONS statt sie zu behaupten', () => {
    const withVariants = (name: string) =>
      PINNED_OSCAL_VERSIONS.filter((version) => variantsOf(version, name).length > 0);

    expect(withVariants('import')).toEqual([...IMPORT_SELECTION_CONSTRAINED]);
    expect(withVariants('merge')).toEqual([...MERGE_VARIANT_CONSTRAINED]);
    expect(withVariants('insert-controls')).toEqual([...INSERT_CONTROLS_CONSTRAINED]);

    expect(
      PINNED_OSCAL_VERSIONS.filter((version) => requiredOf(version, 'import').includes('href')),
    ).toEqual([...REQUIRED_IMPORT_HREF]);
    expect(
      PINNED_OSCAL_VERSIONS.filter((version) => propsOf(version, 'matching').includes('remarks')),
    ).toEqual([...MATCHING_REMARKS]);
  });

  it('lässt keine gepinnte Version ohne Zuordnung', () => {
    // Gegenprobe zur Filterlogik: Jede gepinnte Version gehört bei `import`
    // entweder zur eingeschränkten oder zur permissiven Seite — eine Version
    // ohne vendoriertes Schema fiele schon beim Lesen auf.
    const partitioned = new Set([
      ...IMPORT_SELECTION_CONSTRAINED,
      ...REQUIRED_IMPORT_HREF,
    ]);

    expect([...partitioned].sort()).toEqual([...PINNED_OSCAL_VERSIONS].sort());
  });
});

describe('oscal_profile_schema — Unterschiede über die vier gepinnten Versionen', () => {
  it('führt genau die bekannten abweichenden Definitionen', () => {
    const names = new Set(
      PINNED_OSCAL_VERSIONS.flatMap((version) => [...(shapes.get(version)?.keys() ?? [])]),
    );
    const differing = [...names]
      .filter((name) => new Set(
        PINNED_OSCAL_VERSIONS.map((version) => signature(version, name)),
      ).size > 1)
      .sort();

    // Erhoben am vendorierten Bestand. `import`, `merge` und `matching` sind
    // parserrelevant und in `oscalProfile.ts` als Feldprädikate abgebildet;
    // `insert-controls` und `group` sind derselbe `anyOf`-Umbau eine Ebene
    // tiefer. `MarkupLineDatatype`, `MarkupMultilineDatatype` und `parameter`
    // sind Umbauten der Datentyp- und Parameterdefinitionen.
    expect(differing).toEqual([
      'MarkupLineDatatype',
      'MarkupMultilineDatatype',
      'group',
      'import',
      'insert-controls',
      'matching',
      'merge',
      'parameter',
    ]);
  });

  it('verlangt import.href nur unter 1.1.2 und 1.1.3', () => {
    expect(requiredOf('1.1.2', 'import')).toEqual(['href']);
    expect(requiredOf('1.1.3', 'import')).toEqual(['href']);
    // Ab 1.2.1 führt `href` nur noch als optionale Property beider Zweige.
    expect(requiredOf('1.2.1', 'import')).toEqual([]);
    expect(requiredOf('1.2.2', 'import')).toEqual([]);
  });

  it('schränkt die import-Selektion erst ab 1.2.1 auf genau eine Form ein', () => {
    expect(variantsOf('1.1.2', 'import')).toEqual([]);
    expect(variantsOf('1.1.3', 'import')).toEqual([]);
    expect(propsOf('1.1.3', 'import')).toEqual([
      'exclude-controls',
      'href',
      'include-all',
      'include-controls',
    ]);

    for (const version of ['1.2.1', '1.2.2'] as const) {
      expect(variantsOf(version, 'import'), version).toEqual([
        ['include-all'],
        ['include-controls'],
      ]);
    }
  });

  it('schränkt die merge-Struktur erst ab 1.2.1 auf genau eine Direktive ein', () => {
    for (const version of ['1.1.2', '1.1.3'] as const) {
      expect(variantsOf(version, 'merge'), version).toEqual([]);
      // Alle vier Properties koexistieren dort schemaseitig.
      expect(propsOf(version, 'merge'), version).toEqual(['as-is', 'combine', 'custom', 'flat']);
    }
    for (const version of ['1.2.1', '1.2.2'] as const) {
      expect(variantsOf(version, 'merge'), version).toEqual([
        ['flat'],
        ['as-is'],
        ['custom'],
      ]);
    }
  });

  it('schränkt insert-controls ab 1.2.1 auf dieselbe Weise ein wie import', () => {
    expect(variantsOf('1.1.3', 'insert-controls')).toEqual([]);
    expect(variantsOf('1.2.2', 'insert-controls')).toEqual([
      ['include-all'],
      ['include-controls'],
    ]);
  });

  it('deklariert matching.remarks erst ab 1.2.1', () => {
    expect(propsOf('1.1.2', 'matching')).toEqual(['pattern']);
    expect(propsOf('1.1.3', 'matching')).toEqual(['pattern']);
    expect(propsOf('1.2.1', 'matching')).toEqual(['pattern', 'remarks']);
    expect(propsOf('1.2.2', 'matching')).toEqual(['pattern', 'remarks']);
  });

  it('hält select-control-by-id über alle vier Versionen konstant', () => {
    // Der Namensraum wandert von `oscal-profile:` nach `oscal-control-common:`,
    // die Struktur nicht. `matching` ist damit in **jeder** gepinnten Version
    // ein zulässiger zweiter Selektionsweg neben `with-ids`.
    for (const version of PINNED_OSCAL_VERSIONS) {
      expect(propsOf(version, 'select-control-by-id'), version).toEqual([
        'matching',
        'with-child-controls',
        'with-ids',
      ]);
    }
  });

  it('hält die Pflichtfelder des Profilkörpers über alle vier Versionen konstant', () => {
    for (const version of PINNED_OSCAL_VERSIONS) {
      expect(requiredOf(version, 'profile'), version).toEqual(['imports', 'metadata', 'uuid']);
      expect(propsOf(version, 'profile'), version).toEqual([
        'back-matter',
        'imports',
        'merge',
        'metadata',
        'modify',
        'uuid',
      ]);
      // `modify` ist strukturgleich und deshalb in `oscalProfile.ts` bewusst
      // **nicht** versionsparametrisiert.
      expect(signature(version, 'modify'), version).toBe(signature('1.1.2', 'modify'));
    }
  });
});
