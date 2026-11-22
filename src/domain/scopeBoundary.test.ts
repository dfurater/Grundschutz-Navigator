import { describe, expect, it } from 'vitest';
import { buildScopeBoundary, isIssuedAt, scopeBoundaryInput, scopeBoundarySourceText, scopeBoundaryState, type ScopeBoundaryInput } from '@/domain/scopeBoundary';

const ID = '11111111-1111-4111-8111-111111111111';
const COMPLETE: ScopeBoundaryInput = {
  ...scopeBoundaryInput(undefined),
  organization: 'Verwaltung', processCoverage: 'Netzbetrieb', infrastructure: 'Standort Nord', externalParties: 'keine',
  interfaces: 'Portal', exclusions: 'keine', sourceLabel: 'Abgrenzung v2', sourceIssuedAt: '2026-10-22', role: 'ISB', party: 'Sicherheitsorganisation',
};

describe('scopeBoundary', () => {
  it('normalisiert Texte nach NFC und trimmt, leere optionale Angaben entfallen', () => {
    const item = buildScopeBoundary(ID, { ...COMPLETE, organization: '  Behördë ', sourceLabel: '', sourceIssuedAt: '', role: '', party: '' });
    expect(item?.details.organization).toBe('Behördë'.normalize('NFC'));
    expect(item).not.toHaveProperty('source');
    expect(item).not.toHaveProperty('responsibility');
    expect(item).not.toHaveProperty('content');
  });

  it('unterscheidet Fehlt, Offen mit namentlich fehlenden Feldern und Erfasst', () => {
    expect(scopeBoundaryState(undefined)).toEqual({ kind: 'missing' });
    expect(scopeBoundaryState(buildScopeBoundary(ID, COMPLETE) ?? undefined)).toEqual({ kind: 'complete' });
    expect(scopeBoundaryState(buildScopeBoundary(ID, { ...COMPLETE, sourceIssuedAt: '', sourceVersion: 'v2' }) ?? undefined)).toEqual({ kind: 'complete' });
    expect(scopeBoundaryState(buildScopeBoundary(ID, { ...COMPLETE, interfaces: ' ', sourceIssuedAt: '', party: '' }) ?? undefined))
      .toEqual({ kind: 'open', missing: ['Schnittstellen', 'Version oder Datum', 'Zuständige Stelle'] });
  });

  it('nimmt nur existierende Kalendertage als Datum an', () => {
    expect(isIssuedAt('2026-10-22')).toBe(true);
    expect(isIssuedAt('2026-02-30')).toBe(false);
    expect(isIssuedAt('22.10.2026')).toBe(false);
    expect(buildScopeBoundary(ID, { ...COMPLETE, sourceIssuedAt: '2026-13-01' })).toBeNull();
  });

  it('bildet den Quellenstand nur aus source und lässt leere Teile weg', () => {
    expect(scopeBoundarySourceText({ label: 'Abgrenzung v2', issuedAt: '2026-10-22' })).toBe('Abgrenzung v2 · 22.10.2026');
    expect(scopeBoundarySourceText({ label: '', version: 'v3' })).toBe('v3');
    expect(scopeBoundarySourceText(undefined)).toBe('');
  });
});

describe('Abgrenzungsentwurf', () => {
  it('übernimmt einen neueren Vergleichsstand nur bei unveränderter gespeicherter Abgrenzung', async () => {
    const { boundaryDraftBase, startBoundaryDraft } = await import('@/domain/scopeBoundary');
    const item = buildScopeBoundary(ID, COMPLETE);
    if (!item) throw new Error('fixture');
    const draft = startBoundaryDraft({ savedAt: 's1', items: [item] });
    expect(boundaryDraftBase(draft, { savedAt: 's1', items: [item] })).toBe('s1');
    expect(boundaryDraftBase(draft, { savedAt: 's2', items: [item] })).toBe('s2');
    expect(boundaryDraftBase(draft, { savedAt: 's2', items: [{ ...item, details: { ...item.details, interfaces: 'Neu' } }] })).toBeNull();
    expect(boundaryDraftBase(draft, { savedAt: 's2', items: [] })).toBeNull();
    // Ein neu angelegter Eintrag mit gleichem Inhalt ist nicht die Abgrenzung, auf der der Entwurf beruht.
    expect(boundaryDraftBase(draft, { savedAt: 's2', items: [{ ...item, itemId: '22222222-2222-4222-8222-222222222222' }] })).toBeNull();
    const fresh = startBoundaryDraft({ savedAt: 's1', items: [] });
    expect(boundaryDraftBase(fresh, { savedAt: 's2', items: [{ ...item, details: { organization: '', processCoverage: '', infrastructure: '', externalParties: '', interfaces: '', exclusions: '' } }] })).toBeNull();
  });
});
