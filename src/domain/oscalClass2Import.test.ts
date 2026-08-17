import { describe, expect, it } from 'vitest';
import { processClass2OscalBytes } from './oscalClass2Import';
import { ROOT_DISPATCH_DIAGNOSTIC_CODES } from '@/adapters/oscalRootDispatch';
import { buildSchemaId } from '@/domain/oscalVersionMatrix';
import {
  createReferenceDocument,
  resolveCatalogResources,
} from '@/domain/referenceResolution';
import {
  makeSchemaInvalidOscalDocument,
  makeSchemaValidOscalDocument,
} from '@/test/fixtures/oscalSchemaFixtures';

const context = { trustClass: 'class-2-local-user' } as const;

function encode(source: unknown): Uint8Array {
  return new TextEncoder().encode(typeof source === 'string' ? source : JSON.stringify(source));
}

/** Ein schemavalider Katalog mit zusätzlichen, vom Schema erlaubten Feldern. */
function makeCatalogWithVendorProperty(): Record<string, unknown> {
  const document = makeSchemaValidOscalDocument('catalog', '1.1.3');
  const body = document.catalog as Record<string, unknown>;

  return {
    $schema: buildSchemaId('catalog', '1.1.3'),
    catalog: {
      ...body,
      metadata: {
        ...(body.metadata as Record<string, unknown>),
        props: [{ name: 'vendor-property', ns: 'https://example.invalid/ext', value: 'preserve-me' }],
      },
      'back-matter': { resources: [{ uuid: '11111111-1111-4111-8111-1111111100a1' }] },
    },
  };
}

describe('processClass2OscalBytes', () => {
  it('übergibt ein vollständig gegatetes Klasse-2-Dokument an den vorhandenen Root-Dispatch', async () => {
    const result = await processClass2OscalBytes(encode(makeCatalogWithVendorProperty()), context);

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
            'back-matter': { resources: [{ uuid: '11111111-1111-4111-8111-1111111100a1' }] },
          },
        },
      },
    });
  });

  it('reicht einen bestehenden Root-Dispatch-Fehler ohne zweite Root-Logik durch', async () => {
    const result = await processClass2OscalBytes(
      encode('{"unknown-root":{"metadata":{"oscal-version":"1.1.3"}}}'),
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
  ])('lehnt %s ausschließlich über den bestehenden Root-Dispatch ab', async (text, code) => {
    const result = await processClass2OscalBytes(encode(text), context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code, stage: 'root-dispatch', path: '/' },
    });
  });

  it('weist einen zur Laufzeit falschen Vertrauenskontext ohne Dokumentinhalt ab', async () => {
    const secret = 'KLASSE-2-IMPORT-SEKRET';
    const result = await processClass2OscalBytes(
      encode(`{"catalog":{"metadata":{"oscal-version":"1.1.3"},"remarks":"${secret}"}}`),
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

  it('klassifiziert fehlende Resource-Integrität und unsichere Protokolle im Klasse-2-Kontext', async () => {
    const valid = makeSchemaValidOscalDocument('catalog', '1.1.3');
    const source = {
      catalog: {
        ...(valid.catalog as Record<string, unknown>),
        'back-matter': {
          resources: [{
            uuid: '11111111-1111-4111-8111-1111111100b2',
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
    const imported = await processClass2OscalBytes(encode(source), context);
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
      uuid: '11111111-1111-4111-8111-1111111100b2',
      rlinks: [
        { href: 'https://example.invalid/no-hash.pdf', integrity: 'missing' },
        { href: 'javascript:alert(1)', integrity: 'missing', target: { kind: 'unresolved', reason: 'unsafe-protocol' } },
        { href: 'data:text/plain,unsafe', integrity: 'missing', target: { kind: 'unresolved', reason: 'unsafe-protocol' } },
        { href: 'file:///private/secret', integrity: 'missing', target: { kind: 'unresolved', reason: 'unsafe-protocol' } },
      ],
      content: 'available',
    }]);
  });

  describe('Stufe 3 in der Kette', () => {
    it('lehnt ein schemawidriges Dokument nach bestandener Stufe 2 ab', async () => {
      const result = await processClass2OscalBytes(
        encode(makeSchemaInvalidOscalDocument('catalog', '1.1.3')),
        context,
      );

      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          code: 'OSCAL_SCHEMA_REQUIRED_PROPERTY_MISSING',
          stage: 'json-schema',
          validator: { name: 'ajv', version: '8.20.0' },
          path: '/catalog/metadata',
        },
      });
    });

    it('prüft eine nicht existierende Zelle nie gegen eine Nachbarversion', async () => {
      // `mapping-collection` gibt es erst ab OSCAL 1.2.0. Das Dokument darf
      // nicht gegen 1.2.1 geprüft werden, sondern muss vor Stufe 3 enden.
      const document = makeSchemaValidOscalDocument('mapping-collection', '1.2.1');
      const body = document['mapping-collection'] as Record<string, unknown>;
      const metadata = { ...(body.metadata as Record<string, unknown>), 'oscal-version': '1.1.3' };

      const result = await processClass2OscalBytes(
        encode({ 'mapping-collection': { ...body, metadata } }),
        context,
      );

      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          code: 'OSCAL_ROOT_VERSION_IMPOSSIBLE',
          stage: 'root-dispatch',
          artifact: { rootType: 'mapping-collection', oscalVersion: '1.1.3' },
          params: { expected: '>= 1.2.0' },
        },
      });
    });

    it('lässt jedes Root-Modell in seinem schemavaliden Minimaldokument passieren', async () => {
      for (const rootKey of ['catalog', 'profile', 'component-definition', 'system-security-plan'] as const) {
        const result = await processClass2OscalBytes(
          encode(makeSchemaValidOscalDocument(rootKey, '1.2.2')),
          context,
        );

        expect(result, rootKey).toMatchObject({ ok: true, document: { rootType: rootKey } });
      }
    });
  });
});
