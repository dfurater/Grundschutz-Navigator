// =============================================================================
// Positivkorpus der Root-Erkennung (GSPP-285)
//
// Der Korpus wird aus dem Quellregister erhoben, nicht verdrahtet: Eine feste
// Artefaktzahl wäre beim nächsten Registry-Eintrag rot, ohne dass etwas kaputt
// ist. Die realen BSI-Artefakte liegen nicht im Repository — geprüft wird
// deshalb die Root-Erkennung gegen die registrierte Erwartung je Eintrag, nicht
// deren Inhalt.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { dispatchOscalDocument, ROOT_DISPATCH_DIAGNOSTIC_CODES } from './oscalRootDispatch';
import type { OscalRootDispatchFailure } from './oscalRootDispatch';
import type { OscalDocumentContext } from '@/domain/models';
import { OSCAL_ROOT_KEYS } from '@/domain/oscalVersionMatrix';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import { listOscalArtifacts } from '@/domain/sourceRegistry';
import { makeOscalEnvelope } from '@/test/fixtures/oscalEnvelope';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };

describe('dispatchOscalDocument — registrierte Artefakte', () => {
  const catalogArtifact = listOscalArtifacts().find(
    (entry) => entry.expectedRootType === 'catalog',
  );

  it('erkennt jedes registrierte OSCAL-Artefakt an seinem erwarteten Root', () => {
    const artifacts = listOscalArtifacts();
    expect(artifacts.length).toBeGreaterThan(0);

    for (const artifact of artifacts) {
      const result = dispatchOscalDocument(
        makeOscalEnvelope(artifact.expectedRootType, artifact.oscalVersion),
        { ...context, upstreamPath: artifact.upstreamPath },
      );

      expect(result.ok, `${artifact.artifactKey} muss erkannt werden`).toBe(true);
      if (!result.ok) continue;
      expect(result.rootType).toBe(artifact.expectedRootType);
      expect(result.oscalVersion).toBe(artifact.oscalVersion);
      expect(result.artifactKey).toBe(artifact.artifactKey);
      expect(result.pin.rootKey).toBe(artifact.expectedRootType);
    }
  });

  it('deckt mit dem Korpus mehr als einen Root-Typ und mehr als eine Version ab', () => {
    // Ohne diese Schranke liefe der Korpustest trivial durch, sobald die
    // Registry irgendwann nur noch Kataloge einer Version führte.
    const artifacts = listOscalArtifacts();

    expect(new Set(artifacts.map((entry) => entry.expectedRootType)).size).toBeGreaterThan(1);
    expect(new Set(artifacts.map((entry) => entry.oscalVersion)).size).toBeGreaterThan(1);
  });

  it('erkennt einen Root-Mismatch gegenüber getExpectedRootType()', () => {
    expect(catalogArtifact).toBeDefined();
    if (!catalogArtifact) return;

    const result = dispatchOscalDocument(
      makeOscalEnvelope('profile', catalogArtifact.oscalVersion),
      { ...context, upstreamPath: catalogArtifact.upstreamPath },
    );

    expect(result.ok).toBe(false);
    const { diagnostic } = result as OscalRootDispatchFailure;
    expect(diagnostic.code).toBe(ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_TYPE_MISMATCH);
    expect(diagnostic.params).toEqual({ expected: 'catalog', found: 'profile' });
    expect(diagnostic.artifact.key).toBe(catalogArtifact.artifactKey);
  });

  it('lässt einen unregistrierten Upstream-Pfad ohne Erwartung passieren', () => {
    const result = dispatchOscalDocument(makeOscalEnvelope('profile', '1.1.3'), {
      ...context,
      upstreamPath: 'control_layer/Nicht/Registriert.json',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.artifactKey).toBeNull();
  });
});

describe('dispatchOscalDocument — alle acht Root-Modelle', () => {
  it('erkennt jeden Root-Key des Standards, nicht nur die registrierten', () => {
    const recognised = OSCAL_ROOT_KEYS.map((rootKey: OscalRootKey) => {
      const result = dispatchOscalDocument(makeOscalEnvelope(rootKey, '1.2.2'), context);
      return result.ok ? result.rootType : null;
    });

    expect(recognised).toEqual([...OSCAL_ROOT_KEYS]);
    expect(recognised).toHaveLength(8);
  });
});
