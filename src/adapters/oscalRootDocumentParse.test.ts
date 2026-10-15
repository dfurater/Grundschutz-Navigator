import { describe, expect, it, vi } from 'vitest';
import { dispatchOscalDocumentOrThrow, OscalRootDispatchError } from '@/domain/oscalRootDispatch';
import { dispatchRootDocumentOrThrow, parseRootDocument } from './oscalRootDocumentParse';
import type { OscalDocumentContext } from '@/domain/models';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };

function profileSource() {
  return {
    profile: {
      uuid: '11111111-1111-4111-8111-111111111111',
      metadata: { title: 'Profil', 'oscal-version': '1.1.3' },
      imports: [{ href: '#katalog', 'include-all': {} }],
    },
  };
}

function catchDispatchError(run: () => unknown): OscalRootDispatchError {
  try {
    run();
  } catch (error) {
    if (error instanceof OscalRootDispatchError) return error;
    throw error;
  }
  throw new Error('OscalRootDispatchError erwartet');
}

describe('dispatchRootDocumentOrThrow', () => {
  it('liefert das Dispatch-Ergebnis des erwarteten Root-Typs', () => {
    const source = profileSource();
    const dispatch = dispatchRootDocumentOrThrow(source, context, 'profile');

    expect(dispatch).toEqual(dispatchOscalDocumentOrThrow(source, context));
    expect(dispatch.rootType).toBe('profile');
    expect(dispatch.body).toBe(source.profile);
  });

  it('weist einen fremden Root mit ROOT_TYPE_MISMATCH am Wurzelpfad ab', () => {
    const error = catchDispatchError(() =>
      dispatchRootDocumentOrThrow(profileSource(), context, 'catalog'),
    );

    expect(error.diagnostic).toMatchObject({
      code: 'OSCAL_ROOT_TYPE_MISMATCH',
      path: '/',
      params: { expected: 'catalog', found: 'profile' },
      artifact: { key: null, rootType: 'profile', oscalVersion: '1.1.3' },
    });
  });
});

describe('parseRootDocument', () => {
  it('projiziert den Wurzelkörper und reicht Pin, Version und Artefaktschlüssel durch', () => {
    const source = profileSource();
    const derive = vi.fn((body: unknown) => ({ body }));
    const dispatch = dispatchOscalDocumentOrThrow(source, context);

    const document = parseRootDocument(source, context, { rootType: 'profile', derive });

    expect(derive).toHaveBeenCalledOnce();
    expect(derive).toHaveBeenCalledWith(source.profile);
    expect(document).toEqual({
      source,
      context,
      view: { body: source.profile },
      pin: dispatch.pin,
      oscalVersion: dispatch.oscalVersion,
      artifactKey: dispatch.artifactKey,
    });
    expect(document.source).toBe(source);
    expect(document.context).toBe(context);
  });

  it('ruft derive bei fremdem Root nicht auf', () => {
    const derive = vi.fn();

    const error = catchDispatchError(() =>
      parseRootDocument(profileSource(), context, { rootType: 'mapping-collection', derive }),
    );

    expect(error.diagnostic.code).toBe('OSCAL_ROOT_TYPE_MISMATCH');
    expect(derive).not.toHaveBeenCalled();
  });
});
