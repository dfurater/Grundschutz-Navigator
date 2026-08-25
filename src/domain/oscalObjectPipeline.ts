// =============================================================================
// Gemeinsame, objektorientierte Klasse-2-Prüfkette (ADR-8 Festlegung 1)
//
// Der Schnitt verläuft zwischen Stufe 1 (Bytes) und Stufe 2 (Objekt): Alles,
// was auf dem geparsten Objekt arbeitet — Ressourcenlimits, Strukturinvariante,
// Root-Dispatch und Schemastufe — gilt für jedes Dokument unabhängig von seiner
// Entstehung und läuft durch genau diese exportierte Einheit.
//
// Herkunftsnachweis (ADR-8 Festlegung 3): Die Herkunft ist an den
// Byte-Eintrittspunkt gebunden. parseClass2OscalInput() führt Stufe 1 aus,
// parst und registriert dann Wurzel samt jedes Containers des Parse-Produkts;
// es gibt keinen importierbaren Weg, einen Beleg zu erzeugen. Die Kette prüft
// die Herkunft der Wurzel UND aller Container, bevor sie irgendetwas davon
// beobachtet. Der Ableitungsweg tritt mit Commit B über ein eigenes, ebenso
// geschlossen verwaltetes Handle-Register hier ein.
// =============================================================================

import { dispatchOscalDocument, type OscalRootDispatchSuccess } from '@/adapters/oscalRootDispatch';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_VALIDATOR,
  createClass2ByteLimitDiagnostic,
} from '@/domain/oscalImportContract';
import { createClass2UnprovenancedDiagnostic } from '@/domain/oscalObjectProvenance';
import { isParserProducedRoot } from '@/domain/oscalImportProcessing';
import { isDerivedProducedContainer } from '@/domain/oscalDerivedGraph';
import { walkOwnContainers } from '@/domain/oscalObjectWalk';
import {
  createClass2ResourceLimitDiagnostic,
  enforceClass2ObjectGraphInvariants,
} from '@/domain/oscalObjectGraph';
import { validateAgainstPinnedSchema } from '@/domain/oscalSchemaValidation';
import type { OscalDocumentContext } from '@/domain/models';

/**
 * Kontext der gemeinsamen Kette: Die Vertrauensklasse ist auf Klasse 2
 * festgelegt und wird entgegengenommen, nie aus dem Dokument abgeleitet
 * (ADR-2 §10, ADR-8 Festlegung 5).
 */
export type Class2ObjectPipelineContext = Omit<OscalDocumentContext, 'trustClass'> & {
  readonly trustClass: 'class-2-local-user';
};

export interface Class2OscalValueDocument {
  readonly source: unknown;
  readonly context: Class2ObjectPipelineContext;
  readonly rootType: OscalRootDispatchSuccess['rootType'];
  readonly oscalVersion: OscalRootDispatchSuccess['oscalVersion'];
}

export type Class2OscalValueResult =
  | { readonly ok: true; readonly document: Class2OscalValueDocument }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

/**
 * Ergebnis des Belegdurchlaufs: ob jeder Container belegt ist und ob die
 * kumulierte Nutzlast innerhalb der Byte-Zulassungsgrenze bleibt.
 */
type ProvenanceVerdict = {
  readonly provenanced: boolean;
  readonly withinByteBudget: boolean;
  readonly withinNodeBudget: boolean;
};

/** UTF-8-Breite eines code points außerhalb der Escape-Fälle. */
function utf8Width(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Serialisierte UTF-8-Bytegröße eines Stringinhalts exakt nach den
 * Escape-Regeln von JSON.stringify: Anführungszeichen und Backslash doppelt,
 * die fünf kurzen Steuerzeichen escapes zweibyte, alle übrigen
 * Steuerzeichen und einzelne Surrogate als sechsbbyteiges `\uXXXX`, alles
 * Übrige in seiner UTF-8-Breite.
 */
function serializedStringBytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint === 0x22 || codePoint === 0x5c) bytes += 2;
    else if (codePoint < 0x20) {
      bytes += codePoint === 8 || codePoint === 9 || codePoint === 10 || codePoint === 12 || codePoint === 13 ? 2 : 6;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdfff) bytes += 6;
    else bytes += utf8Width(codePoint);
  }
  return bytes;
}

/** Serialisierter Wertbeitrag ohne umschließende Anführungszeichen. */
function serializedValueBytes(value: unknown): number {
  if (typeof value === 'string') return 2 + serializedStringBytes(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).length : 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (value === null) return 4;
  // Verschachtelte Container zählt der Lauf exakt einmal — bei ihrem eigenen
  // Besuch, mitsamt Klammen, Trennern und Mitgliedern.
  return 0;
}

/**
 * Prüft die Herkunft der Wurzel und aller Container in einem eigenen,
 * rein identitätsbasierten Durchlauf vor jeder Reflexion. Er läuft über
 * denselben gemeinsamen Helper wie die Registrierung am Byte-Eintrittspunkt
 * und kann sich von ihr deshalb nicht auseinanderleben; der frühe Abbruch
 * endet beim ersten Container ohne Beleg.
 *
 * Derselbe Lauf summiert die Bytegröße der Minifikatserialisierung —
 * JSON.stringify-äquivalent und ohne JSON.stringify als Prüfmittel:
 * Containerklammern, Trenner, Doppelpunkte, Schlüssel samt Anführungs-
 * zeichen sowie Werte in exakt ihrer serialisierten Gestalt einschließlich
 * Escape-Erweiterungen. Arraylöcher zählen als null, `undefined`-Mitglieder
 * entfallen wie in der Serialisierung; Symbol-Schlüssel erscheinen dort
 * nie und bleiben deshalb nichtssagend unberücksichtigt, Accessor-Werte
 * werden nie gelesen. Für Herkunft-gedeckte Graphen ist die Summe damit
 * exakt: Überschreitet sie die Byte-Zulassungsgrenze, scheitert dieselbe
 * Inhaltsgestalt auch am öffentlichen Byteeintritt; ein dort zulässiges
 * Dokument liegt mit seinem Minifikat stets darunter (Greptile-Befunde zu
 * 6f39e72, cb5f960 und 176307f).
 */
function verifyProvenance(root: unknown): ProvenanceVerdict {
  let provenanced = true;
  let payloadBytes = 0;
  let nodeFloor = 0;
  walkOwnContainers(root, (container) => {
    // Zwei geschlossene Herkunftsquellen: der Byte-Eintrittspunkt und der
    // kontrollierte Builder des Ableitungswegs; alles andere scheitert.
    // Der Lauf endet NUR bei fehlendem Beleg oder GARANTIERTER
    // Gesamtablehnung vorzeitig — Letzteres, sobald die Knotenuntergrenze
    // das Node-Limit reißt: Dann lehnt die Invariante ohnehin ab, und die
    // Per-Element-Buchhaltung eines übergroßen Arrays darf keinen
    // zusätzlichen Volllauf kosten (Greptile-Befund zu 0dd56ab).
    if (!isParserProducedRoot(container) && !isDerivedProducedContainer(container)) {
      provenanced = false;
      return false;
    }
    nodeFloor += 1;
    nodeFloor += Array.isArray(container)
      ? container.length
      : Reflect.ownKeys(container).length;
    if (nodeFloor > CLASS_2_IMPORT_LIMITS.maxNodes) {
      return false;
    }
    payloadBytes += Array.isArray(container)
      ? serializedArrayBytes(container)
      : serializedObjectBytes(container);
    return true;
  });
  return {
    provenanced,
    withinByteBudget: payloadBytes <= CLASS_2_IMPORT_LIMITS.maxBytes,
    withinNodeBudget: nodeFloor <= CLASS_2_IMPORT_LIMITS.maxNodes,
  };
}

/** Serialisierte Bytegröße eines dichten Arrays: Indizes exakt, Löcher unmöglich. */
function serializedDenseArrayBytes(container: readonly unknown[], length: number): number {
  let bytes = 2 + Math.max(length - 1, 0);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(container, index);
    const slotValue =
      descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
    bytes += slotValue === undefined ? 4 : serializedValueBytes(slotValue);
  }
  return bytes;
}

/**
 * Serialisierte Bytegröße eines nicht dichten Arrays: existierende Slots
 * exakt über ihre Schlüssel, jedes Loch arithmetisch als null — vollständig
 * richtungstreu, ohne die deklarierte Länge zu iterieren.
 */
function serializedSparseArrayBytes(container: readonly unknown[], length: number): number {
  let bytes = 2 + Math.max(length - 1, 0);
  let canonicalSlots = 0;
  for (const key of Reflect.ownKeys(container)) {
    if (typeof key !== 'string') continue;
    const index = Number(key);
    // Nur kanonische Indizes 0 <= i < length sind Arrayslots; "-1", "01"
    // oder außerhalb der Länge liegende Schlüssel erscheinen nicht in der
    // Serialisierung und dürfen Löcherzahl wie Wertbeitrag nicht berühren
    // (Greptile-Befund zu 43105b4).
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key
    ) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(container, index);
    const slotValue =
      descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
    bytes += slotValue === undefined ? 4 : serializedValueBytes(slotValue);
    canonicalSlots += 1;
  }
  const holes = Math.max(length - canonicalSlots, 0);
  return bytes + holes * 4;
}

/** Serialisierte Bytegröße eines Arrays samt Strukturzeichen; Löcher als null. */
function serializedArrayBytes(container: readonly unknown[]): number {
  const length = container.length;
  const dense = Reflect.ownKeys(container).length === length + 1;
  return dense
    ? serializedDenseArrayBytes(container, length)
    : serializedSparseArrayBytes(container, length);
}

/**
 * Serialisierte Bytegröße eines Objekts samt Strukturzeichen. Symbole
 * erscheinen nicht in der Serialisierung; ihre Diagnose überlässt die
 * Buchhaltung der Strukturinvariante. Accessor-Werte werden nie gelesen —
 * solche Einschübe scheitern ohnehin an der anschließenden
 * Invariantenprüfung. `undefined`-Mitglieder fallen wie serialisiert fort,
 * jedes verbleibende Mitglied trägt Schlüssel, Doppelpunkt und Wertbeitrag;
 * Container-Werte liefern beim Wert selbst 0 und zählen an ihrem Besuch.
 */
function serializedObjectBytes(container: object): number {
  let members = 0;
  let bytes = 2;
  for (const key of Reflect.ownKeys(container)) {
    if (typeof key !== 'string') continue;
    const descriptor = Object.getOwnPropertyDescriptor(container, key);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    if (descriptor.value === undefined) continue; // Serialisierung lässt es fort.

    members += 1;
    bytes += 2 + serializedStringBytes(key) + 1 + serializedValueBytes(descriptor.value);
  }
  return bytes + Math.max(members - 1, 0);
}

/**
 * Gemeinsame objektorientierte Prüfkette: Ein Wert mit belegter Herkunft plus
 * Kontext durchlaufen in dieser Reihenfolge Herkunftsprüfung (Wurzel und jeder
 * Container), Strukturinvariante samt Ressourcenlimits (ein Durchlauf),
 * `dispatchOscalDocument()` und die gepinnte Schemastufe. Es entsteht bewusst
 * keine zweite Root-, Versions-, Limit- oder Referenzlogik.
 *
 * `async`, weil die Schemastufe die Schema-Zelle als eigenen Chunk nachlädt.
 */
export async function processClass2OscalValue(
  source: unknown,
  context: Class2ObjectPipelineContext,
): Promise<Class2OscalValueResult> {
  if (context.trustClass !== 'class-2-local-user') {
    return {
      ok: false,
      diagnostic: createOscalDiagnostic({
        code: 'OSCAL_IMPORT_CONTEXT_INVALID',
        stage: 'domain',
        validator: CLASS_2_IMPORT_VALIDATOR,
        path: '/',
      }),
    };
  }

  // Herkunft vor Reflexion: Wurzel und jeder Container müssen belegt sein.
  // Rohobjekte, Proxy-Hüllen, eingetauschte Teilbäume und Accessor-Einschübe
  // scheitern hier bzw. an der anschließenden Invariantenprüfung. Die
  // Importgrößengrenze ist die Verfügbarkeitsgrenze der Klasse-2-Verarbeitung
  // insgesamt — sobald die Herkunft steht, gilt sie für den Wert unabhängig
  // davon, welcher der beiden geschlossenen Wege ihn hervorgebracht hat
  // (eine erneute Aufzählung der Quellen hier wäre ein Driftvektor,
  // Gitar-Hinweis zu b55404a).
  const admission = verifyProvenance(source);
  if (!admission.provenanced) {
    return { ok: false, diagnostic: createClass2UnprovenancedDiagnostic() };
  }
  if (
    typeof source === 'object' &&
    source !== null &&
    !admission.withinNodeBudget
  ) {
    return {
      ok: false,
      diagnostic: createClass2ResourceLimitDiagnostic('OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED', {
        limitNodes: CLASS_2_IMPORT_LIMITS.maxNodes,
      }),
    };
  }
  if (
    typeof source === 'object' &&
    source !== null &&
    !admission.withinByteBudget
  ) {
    return { ok: false, diagnostic: createClass2ByteLimitDiagnostic() };
  }

  const structuralFailure = enforceClass2ObjectGraphInvariants(source);
  if (structuralFailure !== null) {
    return { ok: false, diagnostic: structuralFailure };
  }

  const dispatch = dispatchOscalDocument(source, context);
  if (!dispatch.ok) return dispatch;

  const schema = await validateAgainstPinnedSchema(dispatch.source, dispatch.pin, {
    artifactKey: dispatch.artifactKey,
  });
  if (!schema.ok) return schema;

  return {
    ok: true,
    document: {
      source: dispatch.source,
      context,
      rootType: dispatch.rootType,
      oscalVersion: dispatch.oscalVersion,
    },
  };
}
