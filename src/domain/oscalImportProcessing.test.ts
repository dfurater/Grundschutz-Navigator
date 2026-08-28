import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLASS_2_IMPORT_LIMITS,
  enforceClass2ObjectGraphInvariants,
  parseClass2OscalInput,
} from './oscalImportProcessing';
import { processClass2OscalBytes } from './oscalClass2Import';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseClass2OscalInput', () => {
  it('weist Bytes über dem Limit vor der UTF-8-Dekodierung ab', () => {
    const decoder = vi.fn();
    vi.stubGlobal('TextDecoder', decoder);

    const result = parseClass2OscalInput(
      new Uint8Array(CLASS_2_IMPORT_LIMITS.maxBytes + 1),
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_BYTE_LIMIT_EXCEEDED',
        stage: 'resource-limit',
        path: '/',
      },
    });
    expect(decoder).not.toHaveBeenCalled();
  });

  it('weist ungültiges UTF-8 ohne Ersatzzeichen ab', () => {
    const result = parseClass2OscalInput(new Uint8Array([0xc3, 0x28]));

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_JSON_INVALID_UTF8',
        stage: 'json-syntax',
        path: '/',
      },
    });
  });

  it('weist escape-äquivalente doppelte Member vor JSON.parse ohne Membernamen ab', () => {
    const jsonParse = vi.spyOn(JSON, 'parse');
    const text = '{"catalog":{"metadata":{"oscal-version":"1.1.3","oscal-\\u0076ersion":"1.1.3"}}}';

    const result = parseClass2OscalInput(new TextEncoder().encode(text));

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_JSON_DUPLICATE_MEMBER',
        stage: 'json-syntax',
      },
    });
    expect(jsonParse).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('oscal-version');
  });

  it('weist ungültige JSON-Syntax aus dem Scanner fail-closed vor JSON.parse ab', () => {
    const jsonParse = vi.spyOn(JSON, 'parse');
    const secret = 'NUR-IN-TEST-FIXTURE';
    const result = parseClass2OscalInput(new TextEncoder().encode(`{"catalog":"${secret}"`));

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_JSON_MALFORMED',
        stage: 'json-syntax',
        path: '/',
      },
    });
    expect(jsonParse).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('weist eine Verschachtelung über 64 Ebenen ab', () => {
    let source: unknown = null;
    for (let depth = 0; depth < CLASS_2_IMPORT_LIMITS.maxDepth; depth += 1) {
      source = [source];
    }

    const result = parseClass2OscalInput(new TextEncoder().encode(JSON.stringify(source)));

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED',
        stage: 'resource-limit',
      },
    });
  });

  it('weist eine Tiefenbombe schon im Scanner ohne JSON.parse oder Stacküberlauf ab', () => {
    const jsonParse = vi.spyOn(JSON, 'parse');
    jsonParse.mockClear();
    const nesting = 8_000;
    const text = `${'['.repeat(nesting)}null${']'.repeat(nesting)}`;

    const result = parseClass2OscalInput(new TextEncoder().encode(text));

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED',
        stage: 'resource-limit',
        path: '/',
      },
    });
    expect(jsonParse).not.toHaveBeenCalled();
  });

  it('akzeptiert genau 64 Verschachtelungsebenen', () => {
    let source: unknown = null;
    for (let depth = 1; depth < CLASS_2_IMPORT_LIMITS.maxDepth; depth += 1) {
      source = [source];
    }

    const result = parseClass2OscalInput(new TextEncoder().encode(JSON.stringify(source)));

    expect(result).toMatchObject({ ok: true });
  });

  it('weist mehr als eine Million JSON-Knoten an der öffentlichen Byte-Eintrittskette ab', async () => {
    // Die Objektgraph-Limits liegen seit der gemeinsamen objektorientierten
    // Einheit hinter Stufe 1; der End-to-End-Nachweis läuft deshalb über
    // `processClass2OscalBytes` (Stufe 1 + gemeinsame Kette).
    const text = `[${'null,'.repeat(CLASS_2_IMPORT_LIMITS.maxNodes)}null]`;

    const result = await processClass2OscalBytes(
      new TextEncoder().encode(text),
      { trustClass: 'class-2-local-user' },
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
        stage: 'resource-limit',
      },
    });
  });

  it('akzeptiert genau eine Million JSON-Knoten', () => {
    const source = { values: Array.from({ length: CLASS_2_IMPORT_LIMITS.maxNodes - 2 }, () => null) };

    expect(enforceClass2ObjectGraphInvariants(source)).toBeNull();
  });

  it('nimmt dem Byte-Eintrittspunkt die Objektgraph-Limits ab — sie liegen in der gemeinsamen Einheit', () => {
    // Mehr Knoten, als das Limit erlaubt: Der Byte-Eintrittspunkt parst nur
    // noch; die Ablehnung geschieht ausschließlich in der gemeinsamen
    // objektorientierten Einheit.
    const source = { values: Array.from({ length: CLASS_2_IMPORT_LIMITS.maxNodes - 1 }, () => null) };

    const result = parseClass2OscalInput(new TextEncoder().encode(JSON.stringify(source)));

    expect(result).toMatchObject({ ok: true });
  });

  it('weist die arithmetisch bestimmte Base64-Gesamtgröße ohne Dekodierung ab', () => {
    const atob = vi.fn();
    vi.stubGlobal('atob', atob);
    const encodedLength = Math.ceil((CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes + 1) / 3) * 4;
    const source = {
      catalog: {
        'back-matter': {
          resources: [{
            uuid: 'fixture-resource',
            base64: {
              value: 'A'.repeat(encodedLength),
              'media-type': 'text/html',
            },
          }],
        },
      },
    };

    const diagnostic = enforceClass2ObjectGraphInvariants(source);

    expect(diagnostic).toMatchObject({
      code: 'OSCAL_RESOURCE_BASE64_LIMIT_EXCEEDED',
      stage: 'resource-limit',
    });
    expect(atob).not.toHaveBeenCalled();
  });

  it('akzeptiert genau 10 MiB Base64-Nutzlast ohne Dekodierung', () => {
    const atob = vi.fn();
    vi.stubGlobal('atob', atob);
    // Die Byte-Obergrenze des Eingangs liegt unter der Base64-Darstellung.
    // Deshalb wird die exakte Grenze dieser separaten Stufe direkt geprüft.
    const encoded = `${'A'.repeat(Math.floor(CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes / 3) * 4)}AA==`;
    const source = {
      catalog: {
        'back-matter': {
          resources: [{
            uuid: 'fixture-resource',
            base64: { value: encoded, 'media-type': 'text/html' },
          }],
        },
      },
    };

    expect(enforceClass2ObjectGraphInvariants(source)).toBeNull();
    expect(atob).not.toHaveBeenCalled();
  });
});
