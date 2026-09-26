import type { ParamMeta } from '@/domain/models';

export type SentenceSegmentRole =
  | 'practice'
  | 'modalverb'
  | 'handlungswort'
  | 'ergebnis'
  | 'praezisierung'
  | 'param'
  | 'text';

export interface SentenceSegment {
  readonly role: SentenceSegmentRole;
  readonly text: string;
  readonly paramId?: string;
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
  '\\{\\{\\s*insert:\\s*param,\\s*([^}\\s]+)\\s*\\}\\}';

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
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Segmentiert eine Kontroll-Aussage in Satzteile fuer die Detailansicht (T5).
 *
 * Reine Domain-Funktion: kein React, keine DOM-APIs. Die Segmente liegen in
 * Satzreihenfolge und sind lueckenlos — aneinandergereiht ergeben sie exakt
 * `statementRaw` mit Platzhaltern durch `params[id].value` ersetzt. Jeder
 * Anker wird nur an seiner Fundstelle segmentiert (kein Global-Replace);
 * nicht gefundene Satzteile landen in `missing`.
 */
export function segmentStatement(
  input: SegmentStatementInput,
): SegmentStatementResult {
  const { statementRaw, params } = input;

  // 1. Raw-Text in Atome zerlegen (Textlaeufe + Platzhalter) und dabei die
  //    aufgeloeste Aussage mit Offset-Abbildung aufbauen. Anker wie Ergebnis
  //    oder Praezisierung liegen bereits aufgeloest vor und werden deshalb auf
  //    der aufgeloesten Aussage gesucht.
  const atoms: Atom[] = [];
  let resolved = '';
  function appendText(rawText: string): void {
    // Der Adapter entfernt die BSI-Auswahlklammern nach der Parameterauflösung.
    // Dieselbe Textsicht ist für Suchtext und sichtbare Satzsegmente nötig.
    const text = rawText.replace(/{{([^{}]+)}}/g, '$1');
    atoms.push({
      kind: 'text',
      text,
      resolvedStart: resolved.length,
      resolvedEnd: resolved.length + text.length,
    });
    resolved += text;
  }
  const placeholderRe = new RegExp(PLACEHOLDER_PATTERN, 'g');
  let rawCursor = 0;
  for (;;) {
    const match = placeholderRe.exec(statementRaw);
    if (match === null) {
      break;
    }
    if (match.index > rawCursor) {
      appendText(statementRaw.slice(rawCursor, match.index));
    }
    const paramId = match[1];
    const meta: ParamMeta | undefined = params[paramId];
    // Unbekannte IDs fallen wie in `resolveParams` auf `[id]` zurueck, damit
    // die aneinandergereihten Segmente der aufgeloesten Aussage entsprechen.
    const value = meta?.value ?? `[${paramId}]`;
    atoms.push({
      kind: 'param',
      paramId,
      value,
      resolvedStart: resolved.length,
      resolvedEnd: resolved.length + value.length,
    });
    resolved += value;
    rawCursor = match.index + match[0].length;
  }
  if (rawCursor < statementRaw.length) {
    appendText(statementRaw.slice(rawCursor));
  }

  // 2. Satzteile unabhaengig suchen: Ergebnis und Praezisierung koennen vor
  //    dem Handlungswort stehen. Praktik bleibt ein Praefix, das Modalverb
  //    wird danach gesucht; das Handlungswort braucht Wortgrenzen.
  const anchors: AnchorSpan[] = [];
  const missing: Array<'ergebnis' | 'praezisierung' | 'handlungsworte'> = [];
  let practiceEnd = 0;
  if (input.practiceTitle && resolved.startsWith(input.practiceTitle)) {
    practiceEnd = input.practiceTitle.length;
    anchors.push({ role: 'practice', start: 0, end: practiceEnd });
  }
  let modalverbEnd = practiceEnd;
  if (input.modalverb) {
    const at = resolved.indexOf(input.modalverb, practiceEnd);
    if (at >= 0) {
      modalverbEnd = at + input.modalverb.length;
      anchors.push({ role: 'modalverb', start: at, end: modalverbEnd });
    }
  }

  function findPlain(
    text: string | undefined,
    role: 'ergebnis' | 'praezisierung',
  ): void {
    if (!text) {
      missing.push(role);
      return;
    }
    const at = resolved.indexOf(text);
    if (at < 0) {
      missing.push(role);
      return;
    }
    anchors.push({ role, start: at, end: at + text.length });
  }

  if (!input.handlungsworte) {
    missing.push('handlungsworte');
  } else {
    const wordRe = new RegExp(
      `(?<![A-Za-zÄÖÜäöüß0-9_])${escapeRegExp(input.handlungsworte)}(?![A-Za-zÄÖÜäöüß0-9_])`,
      'g',
    );
    wordRe.lastIndex = modalverbEnd;
    const wordMatch = wordRe.exec(resolved);
    if (wordMatch === null) {
      missing.push('handlungsworte');
    } else {
      anchors.push({
        role: 'handlungswort',
        start: wordMatch.index,
        end: wordMatch.index + wordMatch[0].length,
      });
    }
  }
  findPlain(input.ergebnis, 'ergebnis');
  findPlain(input.praezisierung, 'praezisierung');

  // 3. Segmente emittieren: Luecken zwischen Ankern werden `text`,
  //    Platzhalter innerhalb eines Treffers werden als `param` aufgespalten.
  const ranges: Range[] = [];
  let rangeCursor = 0;
  for (const anchor of anchors.sort((a, b) => a.start - b.start)) {
    if (anchor.start < rangeCursor) {
      continue;
    }
    if (anchor.start > rangeCursor) {
      ranges.push({ start: rangeCursor, end: anchor.start, role: 'text' });
    }
    ranges.push({ start: anchor.start, end: anchor.end, role: anchor.role });
    rangeCursor = anchor.end;
  }
  if (rangeCursor < resolved.length) {
    ranges.push({ start: rangeCursor, end: resolved.length, role: 'text' });
  }

  const segments: SentenceSegment[] = [];
  for (const atom of atoms) {
    if (atom.kind === 'param') {
      segments.push({ role: 'param', text: atom.value, paramId: atom.paramId });
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
