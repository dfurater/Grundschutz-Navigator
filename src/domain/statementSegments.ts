import type { ParamMeta } from '@/domain/models';

export type SentenceSegmentRole =
  | 'practice'
  | 'modalverb'
  | 'handlungswort'
  | 'ergebnis'
  | 'praezisierung'
  | 'param'
  | 'text';

export type SentenceClauseRole = 'ergebnis' | 'praezisierung';

export interface SentenceSegment {
  readonly role: SentenceSegmentRole;
  readonly text: string;
  readonly paramId?: string;
  /** Satzteil, in dem ein Platzhalter liegt (nur bei `role: 'param'`). */
  readonly partOf?: SentenceClauseRole;
}

export interface SegmentStatementInput {
  readonly statementRaw: string;
  readonly params: Record<string, ParamMeta>;
  /** Titel der Praktik (Practice.title); wird als Praefix-Anker gesucht. */
  readonly practiceTitle?: string;
  readonly modalverb?: string;
  readonly handlungsworte?: string;
  /** Bereits aufgeloester Ergebnis-Text (Control.statementProps.ergebnis). */
  readonly ergebnis?: string;
  /** Bereits aufgeloester Praezisierungs-Text (Control.statementProps.praezisierung). */
  readonly praezisierung?: string;
}

export interface SegmentStatementResult {
  readonly segments: SentenceSegment[];
  readonly missing: Array<'ergebnis' | 'praezisierung' | 'handlungsworte'>;
}

/**
 * Platzhalter-Muster, identisch zu `resolveParams` in `@/adapters/oscalAdapter`:
 * `{{ insert: param, <param-id> }}` (Whitespace-tolerant).
 */
const PLACEHOLDER_PATTERN =
  String.raw`\{\{\s*insert:\s*param,\s*([^}\s]+)\s*\}\}`;

interface TextAtom {
  readonly kind: 'text';
  readonly text: string;
  readonly resolvedStart: number;
  readonly resolvedEnd: number;
}

interface ParamAtom {
  readonly kind: 'param';
  readonly paramId: string;
  readonly value: string;
  readonly resolvedStart: number;
  readonly resolvedEnd: number;
}

type Atom = TextAtom | ParamAtom;

interface AnchorSpan {
  readonly role: SentenceSegmentRole;
  readonly start: number;
  readonly end: number;
}

interface Range {
  readonly start: number;
  readonly end: number;
  readonly role: SentenceSegmentRole;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

type MissingKey = SegmentStatementResult['missing'][number];

const MISSING_KEY_BY_ROLE: Partial<Record<SentenceSegmentRole, MissingKey>> = {
  ergebnis: 'ergebnis',
  praezisierung: 'praezisierung',
  handlungswort: 'handlungsworte',
};

const WORD_CHAR = 'A-Za-zÄÖÜäöüß0-9_';

/** Auswahlklammer-Muster, identisch zum zweiten Schritt von `resolveParams`. */
const CHOICE_BRACKET_PATTERN = /{{([^{}]+)}}/g;

/** Textstueck oder Platzhalter im Text mit eingesetzten Parametern. */
interface Piece {
  readonly paramId?: string;
  /** Definierter Parameter ohne gesetzten Wert: bleibt auch ohne Text ein Segment. */
  readonly unset?: boolean;
  readonly start: number;
  readonly end: number;
}

/**
 * Entfernt Auswahlklammern wie `resolveParams` (`{{text}}` → `text`) und
 * bildet jede Position des Eingangstexts auf ihre Position im Ergebnis ab.
 */
function stripChoiceBrackets(text: string): { stripped: string; offsets: number[] } {
  const removed = new Array<boolean>(text.length).fill(false);
  for (const match of text.matchAll(CHOICE_BRACKET_PATTERN)) {
    const end = match.index + match[0].length;
    for (const index of [match.index, match.index + 1, end - 2, end - 1]) {
      removed[index] = true;
    }
  }
  const offsets = [0];
  let stripped = '';
  for (let index = 0; index < text.length; index += 1) {
    if (!removed[index]) {
      stripped += text[index];
    }
    offsets.push(stripped.length);
  }
  return { stripped, offsets };
}

/**
 * Zerlegt den Raw-Text in Atome (Textlaeufe + Platzhalter) und baut dabei die
 * aufgeloeste Aussage mit Offset-Abbildung auf. Die Reihenfolge folgt
 * `resolveParams`: erst Parameter einsetzen, dann Auswahlklammern entfernen.
 * Eine Klammer kann einen Platzhalter umschliessen (`{{ vor {{ insert: param,
 * p }} nach }}`); stueckweise bereinigt blieben ihre Haelften sichtbar.
 */
function buildAtoms(
  statementRaw: string,
  params: Record<string, ParamMeta>,
): { atoms: Atom[]; resolved: string } {
  const pieces: Piece[] = [];
  let substituted = '';
  const appendPiece = (text: string, param?: { id: string; unset: boolean }): void => {
    pieces.push({
      ...(param === undefined ? {} : { paramId: param.id, unset: param.unset }),
      start: substituted.length,
      end: substituted.length + text.length,
    });
    substituted += text;
  };
  let rawCursor = 0;
  for (const match of statementRaw.matchAll(new RegExp(PLACEHOLDER_PATTERN, 'g'))) {
    if (match.index > rawCursor) {
      appendPiece(statementRaw.slice(rawCursor, match.index));
    }
    const paramId = match[1];
    // `Object.hasOwn`: Eine ID wie `toString` faende sonst die geerbte
    // Funktion des Objektprototyps statt „unbekannt“.
    const meta: ParamMeta | undefined = Object.hasOwn(params, paramId) ? params[paramId] : undefined;
    // Unbekannte IDs fallen wie in `resolveParams` auf `[id]` zurueck, damit
    // die aneinandergereihten Segmente der aufgeloesten Aussage entsprechen.
    appendPiece(meta ? meta.value : `[${paramId}]`, {
      id: paramId,
      unset: meta !== undefined && meta.hasValue !== true,
    });
    rawCursor = match.index + match[0].length;
  }
  if (rawCursor < statementRaw.length) {
    appendPiece(statementRaw.slice(rawCursor));
  }

  const { stripped: resolved, offsets } = stripChoiceBrackets(substituted);
  const atoms: Atom[] = [];
  for (const piece of pieces) {
    appendAtom(atoms, piece, resolved, offsets);
  }
  return { atoms, resolved };
}

/** Überträgt ein Stück auf die aufgelöste Aussage und hängt es als Atom an. */
function appendAtom(atoms: Atom[], piece: Piece, resolved: string, offsets: readonly number[]): void {
  const resolvedStart = offsets[piece.start];
  const resolvedEnd = offsets[piece.end];
  const text = resolved.slice(resolvedStart, resolvedEnd);
  // Ein Stueck ohne Text bleibt nur als nicht gesetzter Parameter (weder
  // Wert noch Label) ein Segment: Die Darstellung markiert ihn sichtbar und
  // erklaert ihn. Ein gesetzter leerer Wert wuerde sonst im Satzteil zum
  // leeren Begriffs-Trigger und damit zu einem unsichtbaren Fokusziel.
  if (text === '' && piece.unset !== true) {
    return;
  }
  if (piece.paramId !== undefined) {
    atoms.push({ kind: 'param', paramId: piece.paramId, value: text, resolvedStart, resolvedEnd });
    return;
  }
  // Fiel dazwischen ein gesetzter leerer Wert weg, bleibt der Text ein Stück:
  // `prü{{ insert: param, leer }}fen` ist ein Wort, kein geteiltes.
  const previous = atoms.at(-1);
  if (previous?.kind === 'text' && previous.resolvedEnd === resolvedStart) {
    atoms[atoms.length - 1] = { ...previous, text: previous.text + text, resolvedEnd };
    return;
  }
  atoms.push({ kind: 'text', text, resolvedStart, resolvedEnd });
}

function isClauseRole(role: SentenceSegmentRole): role is SentenceClauseRole {
  return role === 'ergebnis' || role === 'praezisierung';
}

/**
 * Stueck ganz im Bereich. Ein leeres Stueck zaehlt nur im Inneren: An der
 * Grenze eines Satzteils gehoert es nicht zu ihm.
 */
function liesWithin(atom: Atom, start: number, end: number): boolean {
  return start <= atom.resolvedStart && atom.resolvedEnd <= end
    && start < atom.resolvedEnd && atom.resolvedStart < end;
}

const WORD_CHAR_PATTERN = new RegExp(`[${WORD_CHAR}]`);

/** Eine Stueckgrenze im Inneren des Bereichs trennt zwei Wortzeichen. */
function splitsWord(resolved: string, atoms: readonly Atom[], span: AnchorSpan): boolean {
  return atoms.some((atom) => [atom.resolvedStart, atom.resolvedEnd].some(
    (edge) => span.start < edge && edge < span.end
      && WORD_CHAR_PATTERN.test(resolved[edge - 1])
      && WORD_CHAR_PATTERN.test(resolved[edge]),
  ));
}

/**
 * Ein Anker ist nur dort erreichbar, wo die Segmente ihn vollstaendig tragen:
 * Jedes Stueck, das er beruehrt, muss ein Textstueck sein oder, bei Ergebnis
 * und Praezisierung, ein Parameterwert ganz im Satzteil (`partOf`), und keine
 * Stueckgrenze darf ein Wort teilen. Liegt die Fundstelle im Wert eines
 * Platzhalters, truege kein Segment die Rolle; schneidet sie einen Wert an oder
 * teilt ein Wert ein Wort (`Risi{{ insert: param, p }}` mit `p = "ko"`), truege
 * nur ein Wortteil den Ausloeser. Weil der Anker als gefunden gaelte, fehlte in
 * beiden Faellen auch die Restzeile mit dem vollstaendigen Begriff.
 */
function isReachable(resolved: string, atoms: readonly Atom[], span: AnchorSpan): boolean {
  const touched = atoms.filter(
    (atom) => atom.resolvedStart < span.end && span.start < atom.resolvedEnd,
  );
  return touched.length > 0
    && touched.every((atom) => atom.kind === 'text'
      || (isClauseRole(span.role) && liesWithin(atom, span.start, span.end)))
    && !splitsWord(resolved, atoms, span);
}

/**
 * Sucht `word` nur als eigenstaendiges Wort: `indexOf` fände „Risiko“ auch in
 * „Risikoanalyse“ und verankerte die Erklaerung am falschen Wort. Unerreichbare
 * Fundstellen werden uebersprungen, damit eine spaetere im Text zaehlt.
 */
function findWord(
  resolved: string,
  atoms: readonly Atom[],
  word: string,
  from: number,
  role: SentenceSegmentRole,
): AnchorSpan | null {
  const wordRe = new RegExp(
    `(?<![${WORD_CHAR}])${escapeRegExp(word)}(?![${WORD_CHAR}])`,
    'g',
  );
  wordRe.lastIndex = from;
  for (let match = wordRe.exec(resolved); match !== null; match = wordRe.exec(resolved)) {
    const span = { role, start: match.index, end: match.index + match[0].length };
    if (isReachable(resolved, atoms, span)) {
      return span;
    }
  }
  return null;
}

/**
 * Sucht alle Satzteile unabhaengig: Ergebnis und Praezisierung koennen vor dem
 * Handlungswort stehen, aber nie im Praktik-Praefix. Die Praktik zaehlt nur am
 * Satzanfang, das Modalverb wird nach ihr gesucht. Alle Satzteile brauchen
 * Wortgrenzen und eine erreichbare Fundstelle.
 */
function findAnchors(
  input: SegmentStatementInput,
  resolved: string,
  atoms: readonly Atom[],
): { anchors: AnchorSpan[]; missing: MissingKey[] } {
  const anchors: AnchorSpan[] = [];
  const missing: MissingKey[] = [];
  let practiceEnd = 0;
  // Auch die Praktik nur als eigenstaendiges Wort: „Detektion“ darf nicht den
  // Anfang von „Detektionssysteme“ markieren.
  const practice = input.practiceTitle
    ? findWord(resolved, atoms, input.practiceTitle, 0, 'practice')
    : null;
  if (practice?.start === 0) {
    practiceEnd = practice.end;
    anchors.push(practice);
  }
  let modalverbEnd = practiceEnd;
  if (input.modalverb) {
    const modalverb = findWord(resolved, atoms, input.modalverb, practiceEnd, 'modalverb');
    if (modalverb !== null) {
      modalverbEnd = modalverb.end;
      anchors.push(modalverb);
    }
  }
  const word = input.handlungsworte
    ? findWord(resolved, atoms, input.handlungsworte, modalverbEnd, 'handlungswort')
    : null;
  if (word === null) {
    missing.push('handlungsworte');
  } else {
    anchors.push(word);
  }
  for (const role of ['ergebnis', 'praezisierung'] as const) {
    const text = input[role];
    const clause = text ? findWord(resolved, atoms, text, practiceEnd, role) : null;
    if (clause === null) {
      missing.push(role);
    } else {
      anchors.push(clause);
    }
  }
  return { anchors, missing };
}

/**
 * Luecken zwischen Ankern werden `text`. Ueberlappt ein Anker einen frueheren,
 * wird er verworfen und als fehlend gemeldet, damit die Restzeile erscheint.
 */
function buildRanges(
  anchors: readonly AnchorSpan[],
  length: number,
  missing: MissingKey[],
): Range[] {
  const ranges: Range[] = [];
  let cursor = 0;
  // Kopie statt `toSorted`: Vite ergänzt keine Polyfills für ES2023.
  const ordered = [...anchors];
  ordered.sort((a, b) => a.start - b.start);
  for (const anchor of ordered) {
    if (anchor.start < cursor) {
      const key = MISSING_KEY_BY_ROLE[anchor.role];
      if (key !== undefined) {
        missing.push(key);
      }
      continue;
    }
    if (anchor.start > cursor) {
      ranges.push({ start: cursor, end: anchor.start, role: 'text' });
    }
    ranges.push(anchor);
    cursor = anchor.end;
  }
  if (cursor < length) {
    ranges.push({ start: cursor, end: length, role: 'text' });
  }
  return ranges;
}

/**
 * Satzteil eines Platzhalters: nur, wenn der Wert ganz in einem Satzteil
 * liegt. Ein Satzteil im Wert oder einer, der einen Wert nur anschneidet, wird
 * gar nicht erst verankert (`isReachable`) und erscheint als Restzeile.
 */
function clauseRoleAt(
  ranges: readonly Range[],
  atom: Atom,
): SentenceClauseRole | undefined {
  const containing = ranges.find(
    (range) => isClauseRole(range.role) && liesWithin(atom, range.start, range.end),
  );
  return containing?.role as SentenceClauseRole | undefined;
}

/**
 * Segmentiert eine Kontroll-Aussage in Satzteile fuer die Detailansicht (T5).
 *
 * Reine Domain-Funktion: kein React, keine DOM-APIs. Die Segmente liegen in
 * Satzreihenfolge und sind lueckenlos — aneinandergereiht ergeben sie exakt
 * den Text von `resolveParams`: Platzhalter durch `params[id].value` (oder
 * `[id]`) ersetzt, danach Auswahlklammern entfernt. Jeder
 * Anker wird nur an seiner Fundstelle segmentiert (kein Global-Replace);
 * nicht gefundene oder verdeckte Satzteile landen in `missing`. Platzhalter
 * innerhalb von Ergebnis oder Praezisierung tragen den Satzteil in `partOf`.
 */
export function segmentStatement(
  input: SegmentStatementInput,
): SegmentStatementResult {
  const { atoms, resolved } = buildAtoms(input.statementRaw, input.params);
  const { anchors, missing } = findAnchors(input, resolved, atoms);
  const ranges = buildRanges(anchors, resolved.length, missing);

  const segments: SentenceSegment[] = [];
  for (const atom of atoms) {
    if (atom.kind === 'param') {
      const partOf = clauseRoleAt(ranges, atom);
      segments.push({
        role: 'param',
        text: atom.value,
        paramId: atom.paramId,
        ...(partOf === undefined ? {} : { partOf }),
      });
      continue;
    }
    for (const range of ranges) {
      const start = Math.max(atom.resolvedStart, range.start);
      const end = Math.min(atom.resolvedEnd, range.end);
      if (end > start) {
        segments.push({ role: range.role, text: resolved.slice(start, end) });
      }
    }
  }

  return { segments, missing };
}
