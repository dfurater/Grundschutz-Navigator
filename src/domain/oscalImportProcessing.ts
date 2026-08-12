import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_VALIDATOR,
} from '@/domain/oscalImportContract';
import { enforceClass2ResourceLimits } from '@/domain/oscalResourceLimits';

export {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_VALIDATOR,
} from '@/domain/oscalImportContract';
export { enforceClass2ResourceLimits } from '@/domain/oscalResourceLimits';

export type Class2OscalInputResult =
  | { readonly ok: true; readonly source: unknown }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

type JsonScanResult =
  | { readonly kind: 'valid'; readonly duplicatePath?: string }
  | { readonly kind: 'invalid' };

function childContainerPath(path: string, kind: 'array' | 'object', index: number): string {
  return `${path === '/' ? '' : path}/${kind}/${index}`;
}

class DuplicateMemberScanner {
  private position = 0;

  constructor(private readonly text: string) {}

  scan(): JsonScanResult {
    const result = this.scanValue('/');
    if (result.kind === 'invalid' || result.duplicatePath !== undefined) return result;

    this.skipWhitespace();
    return this.position === this.text.length ? result : { kind: 'invalid' };
  }

  private scanValue(path: string): JsonScanResult {
    this.skipWhitespace();
    const character = this.text[this.position];

    if (character === '{') return this.scanObject(path);
    if (character === '[') return this.scanArray(path);
    if (character === '"') return this.readString() === null ? { kind: 'invalid' } : { kind: 'valid' };
    if (character === 't') return this.readLiteral('true');
    if (character === 'f') return this.readLiteral('false');
    if (character === 'n') return this.readLiteral('null');
    return this.readNumber();
  }

  private scanObject(path: string): JsonScanResult {
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

      const value = this.scanValue(childContainerPath(path, 'object', memberIndex));
      if (value.kind === 'invalid' || value.duplicatePath !== undefined) return value;
      memberIndex += 1;

      this.skipWhitespace();
      if (this.consume('}')) return { kind: 'valid' };
      if (!this.consume(',')) return { kind: 'invalid' };
      this.skipWhitespace();
    }

    return { kind: 'invalid' };
  }

  private scanArray(path: string): JsonScanResult {
    this.position += 1;
    this.skipWhitespace();
    if (this.consume(']')) return { kind: 'valid' };

    let index = 0;
    while (this.position < this.text.length) {
      const value = this.scanValue(childContainerPath(path, 'array', index));
      if (value.kind === 'invalid' || value.duplicatePath !== undefined) return value;
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
      if (character.charCodeAt(0) < 0x20) return null;

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
          value += String.fromCharCode(Number.parseInt(hexadecimal, 16));
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

  private readNumber(): JsonScanResult {
    const start = this.position;
    this.consume('-');

    if (this.consume('0')) {
      // JSON verbietet führende Nullen; das abschließende JSON.parse liefert
      // dafür die redigierte Syntaxdiagnose.
    } else if (this.isDigitOneToNine(this.text[this.position])) {
      this.position += 1;
      while (this.isDigit(this.text[this.position])) this.position += 1;
    } else {
      this.position = start;
      return { kind: 'invalid' };
    }

    if (this.consume('.')) {
      if (!this.isDigit(this.text[this.position])) return { kind: 'invalid' };
      while (this.isDigit(this.text[this.position])) this.position += 1;
    }

    if (this.text[this.position] === 'e' || this.text[this.position] === 'E') {
      this.position += 1;
      if (this.text[this.position] === '+' || this.text[this.position] === '-') this.position += 1;
      if (!this.isDigit(this.text[this.position])) return { kind: 'invalid' };
      while (this.isDigit(this.text[this.position])) this.position += 1;
    }

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
      diagnostic: createOscalDiagnostic({
        code: 'OSCAL_BYTE_LIMIT_EXCEEDED',
        stage: 'resource-limit',
        validator: CLASS_2_IMPORT_VALIDATOR,
        path: '/',
        params: { limitBytes: CLASS_2_IMPORT_LIMITS.maxBytes },
      }),
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

  try {
    const source = JSON.parse(text);
    const resourceLimitFailure = enforceClass2ResourceLimits(source);
    return resourceLimitFailure === null
      ? { ok: true, source }
      : { ok: false, diagnostic: resourceLimitFailure };
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
