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
