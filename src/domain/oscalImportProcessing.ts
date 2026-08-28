import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_VALIDATOR,
  createClass2ByteLimitDiagnostic,
} from '@/domain/oscalImportContract';
import {
  createClass2ResourceLimitDiagnostic,
} from '@/domain/oscalObjectGraph';
import { walkOwnContainers } from '@/domain/oscalObjectWalk';

// =============================================================================
// Modulprivates Herkunftsregister des Byte-Eintrittspunkts (ADR-8 Festlegung 3)
//
// Register und Identitätsfrage leben hier gemeinsam: Der einzige Schreibpfad
// ist die Registrierung nach bestandener vollständiger Byte- und Textpolitik
// unmittelbar unten; er ist bewusst NICHT exportiert. Exportiert wird allein
// die nur-lesende Identitätsfrage — ein importierbarer Weg zu einem Beleg
// existiert nicht. oscalObjectProvenance.ts führt die Frage unter ihrem
// etablierten Namen unverändert weiter.
// =============================================================================
const parserProducedContainers = new WeakSet<object>();

function registerParsedTree(root: unknown): void {
  // Der Lauf ist der gemeinsame Helper der Kette; Registrierung und Prüfung
  // können sich dadurch nicht auseinanderleben (Gitar-Befund zu 7e2fa02).
  // Bewusst kein Einfrieren: Die Positivdefinition der Strukturinvariante
  // verlangt vollständig schreibbare, aufzählbare, konfigurierbare
  // Data-Properties (ADR-8), und die Inhaltsbindung entsteht pro Aufruf
  // durch Bytepolitik plus Schemastufe.
  walkOwnContainers(root, (container) => {
    parserProducedContainers.add(container);
    return true;
  });
}

/**
 * Nur-lesende Identitätsfrage über das Register des Byte-Eintrittspunkts und
 * dessen einziger Export: Mitgliedschaft ist von außen weder erzwingbar noch
 * löschbar; ein Schreibzugriff existiert nirgends importierbar.
 */
export function isParserProducedRoot(source: object): boolean {
  return parserProducedContainers.has(source);
}

// Die gemeinsame objektorientierte Prüfkette lebt in ihren eigenen Einheiten
// (ADR-8 Festlegung 1+3). Diese Bestandsmodule führen sie nur unter ihren
// etablierten Namen weiter — eine zweite Logik entsteht hier nicht. Die
// Prüfkette liest das Register dieses Byte-Eintrittspunkts direkt; ein
// Rückexport ihrer Schnittstelle entfällt bewusst, damit die Abhängigkeit
// zwischen Byte-Eintritt und Objektprüfung zyklenfrei in eine Richtung zeigt.
export {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_VALIDATOR,
} from '@/domain/oscalImportContract';
export {
  createClass2ResourceLimitDiagnostic,
  enforceClass2ObjectGraphInvariants,
  OBJECT_GRAPH_DIAGNOSTIC_CODES,
  OBJECT_GRAPH_STAGE,
} from '@/domain/oscalObjectGraph';

export type Class2OscalInputResult =
  | { readonly ok: true; readonly source: unknown }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

type JsonScanResult =
  | { readonly kind: 'valid'; readonly duplicatePath?: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'depth-limit' };

function childContainerPath(path: string, kind: 'array' | 'object', index: number): string {
  return `${path === '/' ? '' : path}/${kind}/${index}`;
}

class DuplicateMemberScanner {
  private position = 0;

  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  scan(): JsonScanResult {
    const result = this.scanValue('/', 1);
    if (result.kind !== 'valid' || result.duplicatePath !== undefined) return result;

    this.skipWhitespace();
    return this.position === this.text.length ? result : { kind: 'invalid' };
  }

  private scanValue(path: string, depth: number): JsonScanResult {
    if (depth > CLASS_2_IMPORT_LIMITS.maxDepth) return { kind: 'depth-limit' };

    this.skipWhitespace();
    const character = this.text[this.position];

    if (character === '{') return this.scanObject(path, depth);
    if (character === '[') return this.scanArray(path, depth);
    if (character === '"') return this.readString() === null ? { kind: 'invalid' } : { kind: 'valid' };
    if (character === 't') return this.readLiteral('true');
    if (character === 'f') return this.readLiteral('false');
    if (character === 'n') return this.readLiteral('null');
    return this.readNumber();
  }

  private scanObject(path: string, depth: number): JsonScanResult {
    this.position += 1;
    this.skipWhitespace();
    if (this.consume('}')) return { kind: 'valid' };

    const names = new Set<string>();
    let memberIndex = 0;
    while (this.position < this.text.length) {
      const name = this.readString();
      if (name === null) return { kind: 'invalid' };
      if (names.has(name)) return { kind: 'valid', duplicatePath: path };
      names.add(name);

      this.skipWhitespace();
      if (!this.consume(':')) return { kind: 'invalid' };

      const value = this.scanValue(childContainerPath(path, 'object', memberIndex), depth + 1);
      if (value.kind !== 'valid' || value.duplicatePath !== undefined) return value;
      memberIndex += 1;

      this.skipWhitespace();
      if (this.consume('}')) return { kind: 'valid' };
      if (!this.consume(',')) return { kind: 'invalid' };
      this.skipWhitespace();
    }

    return { kind: 'invalid' };
  }

  private scanArray(path: string, depth: number): JsonScanResult {
    this.position += 1;
    this.skipWhitespace();
    if (this.consume(']')) return { kind: 'valid' };

    let index = 0;
    while (this.position < this.text.length) {
      const value = this.scanValue(childContainerPath(path, 'array', index), depth + 1);
      if (value.kind !== 'valid' || value.duplicatePath !== undefined) return value;
      index += 1;

      this.skipWhitespace();
      if (this.consume(']')) return { kind: 'valid' };
      if (!this.consume(',')) return { kind: 'invalid' };
      this.skipWhitespace();
    }

    return { kind: 'invalid' };
  }

  private readString(): string | null {
    if (!this.consume('"')) return null;

    let value = '';
    while (this.position < this.text.length) {
      const character = this.text[this.position]!;
      this.position += 1;
      if (character === '"') return value;
      if ((character.codePointAt(0) ?? 0) < 0x20) return null;

      if (character !== '\\') {
        value += character;
        continue;
      }

      const escape = this.text[this.position];
      this.position += 1;
      switch (escape) {
        case '"':
        case '\\':
        case '/':
          value += escape;
          break;
        case 'b':
          value += '\b';
          break;
        case 'f':
          value += '\f';
          break;
        case 'n':
          value += '\n';
          break;
        case 'r':
          value += '\r';
          break;
        case 't':
          value += '\t';
          break;
        case 'u': {
          const hexadecimal = this.text.slice(this.position, this.position + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hexadecimal)) return null;
          value += String.fromCodePoint(Number.parseInt(hexadecimal, 16));
          this.position += 4;
          break;
        }
        default:
          return null;
      }
    }

    return null;
  }

  private readLiteral(literal: string): JsonScanResult {
    if (!this.text.startsWith(literal, this.position)) return { kind: 'invalid' };
    this.position += literal.length;
    return { kind: 'valid' };
  }

  private skipDigits(): void {
    while (this.isDigit(this.text[this.position])) this.position += 1;
  }

  /** Ganzzahlanteil; `null` heißt weiterlesen, sonst liegt `invalid` vor. */
  private readNumberIntegerPart(start: number): JsonScanResult | null {
    if (this.consume('0')) {
      // JSON verbietet führende Nullen; das abschließende JSON.parse liefert
      // dafür die redigierte Syntaxdiagnose.
      return null;
    }
    if (!this.isDigitOneToNine(this.text[this.position])) {
      this.position = start;
      return { kind: 'invalid' };
    }
    this.position += 1;
    this.skipDigits();
    return null;
  }

  private readNumberFractionPart(): JsonScanResult | null {
    if (!this.consume('.')) return null;
    if (!this.isDigit(this.text[this.position])) return { kind: 'invalid' };
    this.skipDigits();
    return null;
  }

  private readNumberExponentPart(): JsonScanResult | null {
    const exponentMarker = this.text[this.position];
    if (exponentMarker !== 'e' && exponentMarker !== 'E') return null;
    this.position += 1;
    if (this.text[this.position] === '+' || this.text[this.position] === '-') this.position += 1;
    if (!this.isDigit(this.text[this.position])) return { kind: 'invalid' };
    this.skipDigits();
    return null;
  }

  private readNumber(): JsonScanResult {
    const start = this.position;
    this.consume('-');

    const integerPart = this.readNumberIntegerPart(start);
    if (integerPart !== null) return integerPart;

    const fractionPart = this.readNumberFractionPart();
    if (fractionPart !== null) return fractionPart;

    const exponentPart = this.readNumberExponentPart();
    if (exponentPart !== null) return exponentPart;

    return { kind: 'valid' };
  }

  private consume(character: string): boolean {
    if (this.text[this.position] !== character) return false;
    this.position += 1;
    return true;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.text[this.position] ?? '')) this.position += 1;
  }

  private isDigit(value: string | undefined): boolean {
    return value !== undefined && value >= '0' && value <= '9';
  }

  private isDigitOneToNine(value: string | undefined): boolean {
    return value !== undefined && value >= '1' && value <= '9';
  }
}

export function parseClass2OscalInput(bytes: Uint8Array): Class2OscalInputResult {
  if (bytes.byteLength > CLASS_2_IMPORT_LIMITS.maxBytes) {
    return {
      ok: false,
      diagnostic: createClass2ByteLimitDiagnostic(),
    };
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      diagnostic: createOscalDiagnostic({
        code: 'OSCAL_JSON_INVALID_UTF8',
        stage: 'json-syntax',
        validator: CLASS_2_IMPORT_VALIDATOR,
        path: '/',
      }),
    };
  }

  const scan = new DuplicateMemberScanner(text).scan();
  if (scan.kind === 'depth-limit') {
    return {
      ok: false,
      diagnostic: createClass2ResourceLimitDiagnostic('OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED', {
        limitDepth: CLASS_2_IMPORT_LIMITS.maxDepth,
      }),
    };
  }
  if (scan.kind === 'valid' && scan.duplicatePath !== undefined) {
    return {
      ok: false,
      diagnostic: createOscalDiagnostic({
        code: 'OSCAL_JSON_DUPLICATE_MEMBER',
        stage: 'json-syntax',
        validator: CLASS_2_IMPORT_VALIDATOR,
        path: scan.duplicatePath,
      }),
    };
  }
  if (scan.kind === 'invalid') {
    return {
      ok: false,
      diagnostic: createOscalDiagnostic({
        code: 'OSCAL_JSON_MALFORMED',
        stage: 'json-syntax',
        validator: CLASS_2_IMPORT_VALIDATOR,
        path: '/',
      }),
    };
  }

  try {
    // Stufe 1 endet hier: Der Byte-Eintrittspunkt parst selbst und gibt das
    // unmittelbare Ergebnis weiter. Erst wenn Byte-Limit, UTF-8-, Syntax- und
    // Duplicate-Member-Prüfung bestanden sind, wird der Baum registriert —
    // ein Beleg trägt damit stets die vollständige Bytepolitik.
    const source = JSON.parse(text);
    registerParsedTree(source);
    return { ok: true, source };
  } catch {
    return {
      ok: false,
      diagnostic: createOscalDiagnostic({
        code: 'OSCAL_JSON_MALFORMED',
        stage: 'json-syntax',
        validator: CLASS_2_IMPORT_VALIDATOR,
        path: '/',
      }),
    };
  }
}
