/**
 * Minimale, gültige OSCAL-Envelopes für den Root-Dispatch (GSPP-285).
 *
 * Bewusst nur Envelope und `metadata`: Genau das braucht Stufe 2, und mehr
 * würde suggerieren, dass der Dispatch modellinterne Felder kennt.
 */
export function makeOscalEnvelope(
  rootType: string,
  oscalVersion: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    [rootType]: {
      uuid: `uuid-${rootType}`,
      metadata: {
        title: `Testdokument ${rootType}`,
        'last-modified': '2026-08-06T00:00:00Z',
        version: '1',
        'oscal-version': oscalVersion,
      },
    },
    ...extra,
  };
}
