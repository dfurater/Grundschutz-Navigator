import { describe, expect, it } from 'vitest';
import { processClass2OscalBytes } from './oscalClass2Import';
import { ROOT_DISPATCH_DIAGNOSTIC_CODES } from '@/adapters/oscalRootDispatch';
import { buildSchemaId } from '@/domain/oscalVersionMatrix';
import {
  createReferenceDocument,
  resolveCatalogResources,
} from '@/domain/referenceResolution';

const context = { trustClass: 'class-2-local-user' } as const;

describe('processClass2OscalBytes', () => {
  it('übergibt ein vollständig gegatetes Klasse-2-Dokument an den vorhandenen Root-Dispatch', () => {
    const source = {
      $schema: buildSchemaId('catalog', '1.1.3'),
      catalog: {
        uuid: 'class-2-catalog',
        metadata: {
          'oscal-version': '1.1.3',
          props: [{ name: 'vendor-property', ns: 'https://example.invalid/ext', value: 'preserve-me' }],
        },
        'back-matter': {
          resources: [{ uuid: 'empty-resource' }],
        },
      },
    };

    const result = processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(source)), context);

    expect(result).toMatchObject({
      ok: true,
      document: {
        context,
        rootType: 'catalog',
        oscalVersion: '1.1.3',
        source: {
          catalog: {
            metadata: {
              props: [{ name: 'vendor-property', ns: 'https://example.invalid/ext', value: 'preserve-me' }],
            },
            'back-matter': { resources: [{ uuid: 'empty-resource' }] },
          },
        },
      },
    });
  });

  it('reicht einen bestehenden Root-Dispatch-Fehler ohne zweite Root-Logik durch', () => {
    const result = processClass2OscalBytes(
      new TextEncoder().encode('{"unknown-root":{"metadata":{"oscal-version":"1.1.3"}}}'),
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_ROOT_TYPE_UNKNOWN',
        stage: 'root-dispatch',
      },
    });
  });

  it.each([
    ['null', ROOT_DISPATCH_DIAGNOSTIC_CODES.DOCUMENT_NOT_OBJECT],
    [
      '{"catalog":{"metadata":{"oscal-version":"1.1.3"}},"profile":{"metadata":{"oscal-version":"1.1.3"}}}',
      ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_KEY_AMBIGUOUS,
    ],
  ])('lehnt %s ausschließlich über den bestehenden Root-Dispatch ab', (text, code) => {
    const result = processClass2OscalBytes(new TextEncoder().encode(text), context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code, stage: 'root-dispatch', path: '/' },
    });
  });

  it('weist einen zur Laufzeit falschen Vertrauenskontext ohne Dokumentinhalt ab', () => {
    const secret = 'KLASSE-2-IMPORT-SEKRET';
    const result = processClass2OscalBytes(
      new TextEncoder().encode(`{"catalog":{"metadata":{"oscal-version":"1.1.3"},"remarks":"${secret}"}}`),
      { trustClass: 'class-1-verified-public' } as never,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_IMPORT_CONTEXT_INVALID',
        stage: 'domain',
        path: '/',
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('klassifiziert fehlende Resource-Integrität und unsichere Protokolle im Klasse-2-Kontext', () => {
    const source = {
      catalog: {
        metadata: { 'oscal-version': '1.1.3' },
        'back-matter': {
          resources: [{
            uuid: 'linked-resource',
            rlinks: [
              { href: 'https://example.invalid/no-hash.pdf' },
              { href: 'javascript:alert(1)' },
              { href: 'data:text/plain,unsafe' },
              { href: 'file:///private/secret' },
            ],
          }],
        },
      },
    };
    const imported = processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(source)), context);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const resources = resolveCatalogResources({
      document: createReferenceDocument({
        source: imported.document.source,
        context: imported.document.context,
        rootType: imported.document.rootType,
        oscalVersion: imported.document.oscalVersion,
      }),
    });

    expect(resources).toMatchObject([{
      uuid: 'linked-resource',
      rlinks: [
        { href: 'https://example.invalid/no-hash.pdf', integrity: 'missing' },
        { href: 'javascript:alert(1)', integrity: 'missing', target: { kind: 'unresolved', reason: 'unsafe-protocol' } },
        { href: 'data:text/plain,unsafe', integrity: 'missing', target: { kind: 'unresolved', reason: 'unsafe-protocol' } },
        { href: 'file:///private/secret', integrity: 'missing', target: { kind: 'unresolved', reason: 'unsafe-protocol' } },
      ],
      content: 'available',
    }]);
  });
});
