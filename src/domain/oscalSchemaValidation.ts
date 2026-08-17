// =============================================================================
// Stufe 3 des OSCAL-Validierungsvertrags — JSON-Schema-Prüfung (GSPP-343)
//
// Läuft ausschließlich im Modul-Worker und ausschließlich mit der von Stufe 2
// gelieferten Matrixzelle. Es gibt keinen Fallback auf eine Nachbarversion und
// keinen Bezug von einer fremden Origin: die Schemabytes kommen aus dem eigenen
// Bundle, dessen ausgewählter Chunk zur Laufzeit von derselben Origin geladen
// wird — siehe `oscalSchemaBundle.ts`.
//
// „Schema-valide" ist eine Strukturaussage, keine Vertrauensaussage. OSCAL
// erzeugt für jedes Feld mit `allow-other="yes"` das Muster
// `anyOf: [<Datatype>, enum]`; die Aufzählung bindet dann nicht. Stufe 4
// (Constraints) bleibt `not-checked` — siehe docs/OSCAL_VALIDATION.md.
//
// Diagnosen werden **konstruiert**, nicht gefiltert: Aus einem Ajv-Befund
// werden ausschließlich der Keyword-abgeleitete projekteigene Code und der
// redigierte `instancePath` übernommen. Ajvs `message` und `params` werden nie
// durchgereicht — `params.additionalProperty` trägt einen Dokumentschlüssel.
// =============================================================================

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { createOscalDiagnostic, type OscalDiagnostic, type OscalDiagnosticValidator } from '@/domain/oscalDiagnostics';
import { getOscalSchemaLoader, toSchemaCellKey } from '@/domain/oscalSchemaBundle';
import type { OscalSchemaPin } from '@/domain/oscalVersionMatrix';

/** Stufe dieses Prüfers im Validierungsvertrag. */
export const JSON_SCHEMA_STAGE = 'json-schema' as const;

/** Der Validatorpin. Er geht in jede Diagnosesignatur ein. */
export const JSON_SCHEMA_VALIDATOR: OscalDiagnosticValidator = Object.freeze({
  name: 'ajv',
  version: '8.20.0',
});

/**
 * Ersetzt jedes Pfadsegment, das weder ein Arrayindex noch ein im gewählten
 * Schema bekannter Property-Name ist. Ein unbekanntes Segment stammt aus dem
 * Dokument und darf die Diagnose nicht verlassen.
 */
export const REDACTED_PATH_SEGMENT = '*';

export const SCHEMA_VALIDATION_DIAGNOSTIC_CODES = Object.freeze({
  /** Zelle nicht im Bundle, Ladefehler oder Kompilierfehler — fail-closed. */
  SCHEMA_UNAVAILABLE: 'OSCAL_SCHEMA_UNAVAILABLE',
  /** Ajv-Befund ohne bekannten Keyword — nach Vertrag ein Werkzeugfehler. */
  VALIDATOR_OUTPUT_UNRECOGNIZED: 'OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED',
});

/**
 * Abbildung des Ajv-Keywords auf einen stabilen projekteigenen Code. Die
 * Tabelle ist die Positivliste: Ein hier nicht geführtes Keyword erzeugt
 * `OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED` statt einer geratenen Diagnose.
 *
 * `format` fehlt bewusst — die Formatprüfung ist abgeschaltet (draft-07 führt
 * `format` als Annotation, nicht als Assertion).
 */
const KEYWORD_DIAGNOSTIC_CODES: Readonly<Record<string, string>> = Object.freeze({
  required: 'OSCAL_SCHEMA_REQUIRED_PROPERTY_MISSING',
  additionalProperties: 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY',
  propertyNames: 'OSCAL_SCHEMA_PROPERTY_NAME_INVALID',
  type: 'OSCAL_SCHEMA_TYPE_MISMATCH',
  enum: 'OSCAL_SCHEMA_ENUM_MISMATCH',
  const: 'OSCAL_SCHEMA_CONST_MISMATCH',
  pattern: 'OSCAL_SCHEMA_PATTERN_MISMATCH',
  minLength: 'OSCAL_SCHEMA_LENGTH_OUT_OF_RANGE',
  maxLength: 'OSCAL_SCHEMA_LENGTH_OUT_OF_RANGE',
  minItems: 'OSCAL_SCHEMA_ITEM_COUNT_OUT_OF_RANGE',
  maxItems: 'OSCAL_SCHEMA_ITEM_COUNT_OUT_OF_RANGE',
  minProperties: 'OSCAL_SCHEMA_PROPERTY_COUNT_OUT_OF_RANGE',
  maxProperties: 'OSCAL_SCHEMA_PROPERTY_COUNT_OUT_OF_RANGE',
  minimum: 'OSCAL_SCHEMA_NUMBER_OUT_OF_RANGE',
  maximum: 'OSCAL_SCHEMA_NUMBER_OUT_OF_RANGE',
  exclusiveMinimum: 'OSCAL_SCHEMA_NUMBER_OUT_OF_RANGE',
  exclusiveMaximum: 'OSCAL_SCHEMA_NUMBER_OUT_OF_RANGE',
  multipleOf: 'OSCAL_SCHEMA_NUMBER_OUT_OF_RANGE',
  uniqueItems: 'OSCAL_SCHEMA_DUPLICATE_ITEM',
  contains: 'OSCAL_SCHEMA_CONTAINS_UNSATISFIED',
  items: 'OSCAL_SCHEMA_ITEM_INVALID',
  additionalItems: 'OSCAL_SCHEMA_ITEM_INVALID',
  dependencies: 'OSCAL_SCHEMA_DEPENDENCY_UNSATISFIED',
  dependentRequired: 'OSCAL_SCHEMA_DEPENDENCY_UNSATISFIED',
  dependentSchemas: 'OSCAL_SCHEMA_DEPENDENCY_UNSATISFIED',
  anyOf: 'OSCAL_SCHEMA_COMBINATOR_MISMATCH',
  oneOf: 'OSCAL_SCHEMA_COMBINATOR_MISMATCH',
  allOf: 'OSCAL_SCHEMA_COMBINATOR_MISMATCH',
  not: 'OSCAL_SCHEMA_COMBINATOR_MISMATCH',
  if: 'OSCAL_SCHEMA_COMBINATOR_MISMATCH',
  // Ajv 8.20.0 schreibt dieses Keyword mit Leerzeichen, nicht als
  // `false_schema` — nachgeprüft am Befund `{"keyword":"false schema"}` für ein
  // Teilschema `false`. Defensiv: Die gepinnten Schemas setzen `false`
  // ausschließlich an `additionalProperties` und können den Befund nicht
  // erzeugen; ein künftiges Schema mit echtem Teilschema `false` soll dennoch
  // als Schemabefund und nicht als Werkzeugfehler enden.
  'false schema': 'OSCAL_SCHEMA_COMBINATOR_MISMATCH',
});

export interface OscalSchemaValidationSuccess {
  readonly ok: true;
}

export interface OscalSchemaValidationFailure {
  readonly ok: false;
  readonly diagnostic: OscalDiagnostic;
}

export type OscalSchemaValidationResult =
  | OscalSchemaValidationSuccess
  | OscalSchemaValidationFailure;

interface CompiledSchemaCell {
  readonly validate: ValidateFunction;
  /** Alle im Schema deklarierten Property-Namen — die Positivliste der Redaction. */
  readonly knownPropertyNames: ReadonlySet<string>;
}

/**
 * Je Zelle einmal kompiliert. Der Schlüsselraum ist mit 30 Zellen geschlossen,
 * der Cache kann also nicht unbeschränkt wachsen.
 */
const compiledCells = new Map<string, CompiledSchemaCell>();

/**
 * Ajv-Konfiguration der Stufe 3.
 *
 * - Standardeinstieg (draft-07) — alle 30 gepinnten Schemas deklarieren
 *   draft-07 und sind selbstenthalten; kein `loadSchema`, kein `addSchema`.
 * - `validateFormats: false`: In draft-07 ist `format` eine Annotation, keine
 *   Assertion. Eine Formatprüfung bräuchte `ajv-formats` als zweite
 *   Lieferkettenabhängigkeit, ohne eine Vertrauensaussage zu begründen.
 * - `allErrors: false`: Die erste Verletzung genügt und verkleinert die
 *   Leckfläche.
 * - `unicodeRegExp` bleibt auf der Vorgabe `true`. Ohne das `u`-Flag liest eine
 *   JavaScript-Regex das `\p{L}` in OSCALs `TokenDatatype` als `p` und **jedes**
 *   OSCAL-Dokument fiele durch. Der Wert wird deshalb nicht gesetzt, damit er
 *   auch nicht versehentlich abgeschaltet werden kann.
 * - `strictTypes: false`: NISTs `DecimalDatatype` und `percentage` setzen
 *   `pattern` ohne begleitendes `type`. Das ist ein Autorenhinweis über das
 *   Schema, keine Abschwächung der Prüfung — `pattern` greift für Strings so
 *   oder so und ist für Nicht-Strings definitionsgemäß wirkungslos. Ohne diese
 *   Zeile schreibt Ajv den Hinweis bei jedem Import in die Konsole.
 */
function createAjv(): Ajv {
  return new Ajv({ validateFormats: false, allErrors: false, strictTypes: false });
}

/** Sammelt jeden unter `properties`/`patternProperties` deklarierten Namen. */
function collectSchemaPropertyNames(schema: unknown): ReadonlySet<string> {
  const names = new Set<string>();
  const stack: unknown[] = [schema];

  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (typeof node !== 'object' || node === null) continue;

    const record = node as Record<string, unknown>;
    const properties = record.properties;
    if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
      for (const name of Object.keys(properties)) names.add(name);
    }
    stack.push(...Object.values(record));
  }

  return names;
}

async function getCompiledCell(pin: OscalSchemaPin): Promise<CompiledSchemaCell | null> {
  const cellKey = toSchemaCellKey(pin.rootKey, pin.oscalVersion);
  const cached = compiledCells.get(cellKey);
  if (cached) return cached;

  const loader = getOscalSchemaLoader(pin);
  if (loader === null) return null;

  try {
    const schema = (await loader()).default;
    const cell: CompiledSchemaCell = {
      validate: createAjv().compile(schema as object),
      knownPropertyNames: collectSchemaPropertyNames(schema),
    };
    compiledCells.set(cellKey, cell);
    return cell;
  } catch {
    // Ladefehler und Kompilierfehler sind beide „technisch nicht verfügbar".
    // Die Ursache bleibt bewusst ungenannt: Sie kann einen lokalen Pfad oder
    // einen Ausschnitt der Eingabe tragen.
    return null;
  }
}

/** Ein JSON-Pointer-Segment zurück in seinen logischen Namen. */
function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Redigiert einen Ajv-`instancePath`. Übernommen wird ein Segment nur, wenn es
 * ein numerischer Arrayindex oder ein im gewählten Schema bekannter
 * Property-Name ist; jedes andere Segment wird zum festen Platzhalter.
 */
export function redactInstancePath(
  instancePath: string,
  knownPropertyNames: ReadonlySet<string>,
): string {
  if (instancePath === '') return '/';

  return instancePath
    .split('/')
    .slice(1)
    .map((segment) => {
      if (/^(0|[1-9]\d*)$/.test(segment)) return segment;
      return knownPropertyNames.has(unescapePointerSegment(segment))
        ? segment
        : REDACTED_PATH_SEGMENT;
    })
    .map((segment) => `/${segment}`)
    .join('');
}

function toDiagnosticPath(error: ErrorObject, knownPropertyNames: ReadonlySet<string>): string {
  const base = redactInstancePath(error.instancePath, knownPropertyNames);

  // Bei `additionalProperties` zeigt Ajv auf das **Elternobjekt**; der
  // beanstandete Name steckt allein in `params.additionalProperty` und ist
  // Dokumentinhalt. Der Platzhalter benennt die Stelle, ohne den Namen zu
  // verraten.
  if (error.keyword !== 'additionalProperties') return base;
  return base === '/' ? `/${REDACTED_PATH_SEGMENT}` : `${base}/${REDACTED_PATH_SEGMENT}`;
}

function createSchemaDiagnostic(
  code: string,
  path: string,
  pin: OscalSchemaPin,
  artifactKey: string | null,
): OscalDiagnostic {
  return createOscalDiagnostic({
    code,
    stage: JSON_SCHEMA_STAGE,
    validator: JSON_SCHEMA_VALIDATOR,
    path,
    artifact: { key: artifactKey, rootType: pin.rootKey, oscalVersion: pin.oscalVersion },
  });
}

/**
 * Prüft ein Dokument gegen das gepinnte Schema seiner Matrixzelle.
 *
 * Fail-closed: Ist die Zelle nicht im Bundle oder lässt sich ihr Validator
 * nicht bauen, endet der Import mit `OSCAL_SCHEMA_UNAVAILABLE`. Stufe 3 wird
 * dann weder übersprungen noch als bestanden ausgewiesen.
 *
 * @param source Das unveränderte Gesamtdokument aus Stufe 1
 * @param pin Die in Stufe 2 ausgewählte Zelle — nie aus Dokumentinhalt gebaut
 */
export async function validateAgainstPinnedSchema(
  source: unknown,
  pin: OscalSchemaPin,
  { artifactKey = null }: { artifactKey?: string | null } = {},
): Promise<OscalSchemaValidationResult> {
  const codes = SCHEMA_VALIDATION_DIAGNOSTIC_CODES;
  const cell = await getCompiledCell(pin);

  if (cell === null) {
    return { ok: false, diagnostic: createSchemaDiagnostic(codes.SCHEMA_UNAVAILABLE, '/', pin, artifactKey) };
  }

  if (cell.validate(source)) return { ok: true };

  const error = cell.validate.errors?.[0];
  const code = error === undefined ? undefined : KEYWORD_DIAGNOSTIC_CODES[error.keyword];

  if (error === undefined || code === undefined) {
    // Ein nicht normalisierbarer Werkzeugbefund ist nach Vertrag ein
    // Werkzeugfehler, kein Schemabefund — und bleibt fail-closed.
    return {
      ok: false,
      diagnostic: createSchemaDiagnostic(codes.VALIDATOR_OUTPUT_UNRECOGNIZED, '/', pin, artifactKey),
    };
  }

  return {
    ok: false,
    diagnostic: createSchemaDiagnostic(
      code,
      toDiagnosticPath(error, cell.knownPropertyNames),
      pin,
      artifactKey,
    ),
  };
}

/** Nur für Tests: leert den Validator-Cache. */
export function resetCompiledSchemaCache(): void {
  compiledCells.clear();
}
