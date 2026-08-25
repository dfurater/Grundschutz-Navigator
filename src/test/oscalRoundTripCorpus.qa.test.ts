// =============================================================================
// QA-Lane des No-op-Round-trip-Harnischs (GSPP-298)
//
// Vollständiger, reproduzierbarer Sweep: jedes der acht Root-Modelle gegen
// jede existierende Matrixzelle (30 Zellen — mapping-collection erst ab
// 1.2.0). Die schnellen Kernfälle liegen im regulären Testlauf
// (`npm run test`); diese Lane beweist zusätzlich die komplette
// Versionsabdeckung und läuft bewusst getrennt:
//
//   npm run test:qa
// =============================================================================

import { describe, expect, it } from 'vitest';
import { listSchemaPins } from '@/domain/oscalVersionMatrix';
import { makeMaximalOscalDocument } from '@/test/fixtures/oscalRoundTripCorpus';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';

describe('QA-Sweep über alle 30 Matrixzellen', () => {
  const pins = listSchemaPins();

  it('führt exakt die 30 existierenden Zellen', () => {
    expect(pins).toHaveLength(30);
  });

  for (const pin of pins) {
    it(`${pin.rootKey} @ ${pin.oscalVersion}: Maximaldokument ohne Verlust, Stufe 3 bestanden`, async () => {
      const result = await runNoOpRoundTrip({
        fixtureText: JSON.stringify(
          makeMaximalOscalDocument(pin.rootKey, pin.oscalVersion),
        ),
        catalogKey: pin.rootKey === 'catalog' ? 'gspp' : undefined,
      });

      expect(result.binding, `${pin.rootKey} @ ${pin.oscalVersion}`).toMatchObject({ ok: true });
      expect(result.serialization, pin.oscalVersion).toEqual({ status: 'passed' });
      expect(result.graph).toEqual({ status: 'passed', differences: [] });
      expect(result.identities).toEqual({ status: 'passed', findings: [] });
      expect(result.stages.schemaValidation).toEqual({
        stage: 'json-schema',
        status: 'passed',
      });
      // Die dokumentierte Lücke bleibt sichtbar — in keiner Zelle wird sie
      // zu einer bestandenen Prüfung.
      expect(result.stages.constraints).toMatchObject({ status: 'not-checked' });
    });
  }
});
