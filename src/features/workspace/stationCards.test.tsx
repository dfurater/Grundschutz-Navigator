import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import type { LocalId, VerbundId } from '@/domain/workspaceModel';
import type { DocumentMetric } from '@/domain/verbundStationMetrics';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import { latestSavedAt, relativeTime, StationCards } from '@/features/workspace/StationCards';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';

const NOW = Date.parse('2026-10-23T12:00:00Z');

describe('relativeTime', () => {
  it.each([
    ['2026-10-23T11:59:30Z', 'gerade eben'],
    ['2026-10-23T12:00:05Z', 'gerade eben'],
    ['2026-10-23T11:58:00Z', 'vor 2 Minuten'],
    ['2026-10-23T09:00:00Z', 'vor 3 Stunden'],
    ['2026-10-20T12:00:00Z', 'vor 3 Tagen'],
  ])('%s → %s', (iso, expected) => expect(relativeTime(iso, NOW)).toBe(expected));

  it('liefert ohne lesbaren Zeitpunkt nichts', () => {
    expect(relativeTime(undefined, NOW)).toBeUndefined();
    expect(relativeTime('kein Datum', NOW)).toBeUndefined();
  });
});

it('latestSavedAt wählt den jüngsten Zeitpunkt, unabhängig vom Zeitzonenformat', () => {
  expect(latestSavedAt(['2026-10-23T10:00:00+02:00', '2026-10-23T09:00:00Z', '2026-10-23T08:30:00Z'])).toBe('2026-10-23T09:00:00Z');
  expect(latestSavedAt([])).toBeUndefined();
});

describe('StationCards', () => {
  const NOW_ISO = '2026-10-23T12:00:00Z';
  const doc = (localId: string, rootType: OscalRootKey, metric?: DocumentMetric): WorkspaceDocumentView => ({
    localId: localId as LocalId, rootType, oscalVersion: '1.1.3', documentState: 'export-ready', savedAt: NOW_ISO, metric,
  });
  const view = (documents: readonly WorkspaceDocumentView[]): VerbundView => ({
    verbund: { verbundId: '00000000-0000-4000-8000-000000000001' as VerbundId, name: 'Verbund', createdAt: NOW_ISO, savedAt: NOW_ISO },
    documents, edges: new Map(), diagnostics: [],
    catalogControls: 1234, catalogKey: ENTRY_CATALOG_KEY, metricsComputedAt: NOW_ISO,
  });
  const cards = (documents: readonly WorkspaceDocumentView[]) => {
    render(<MemoryRouter><StationCards view={view(documents)} catalogHref="/katalog" now={NOW} /></MemoryRouter>);
    return screen.getAllByRole('listitem');
  };

  it('zeigt die Kennzahl jeder Station im Text und im zugänglichen Namen des Aktionslinks', () => {
    const [catalog, profile, ssp, assessment, poam] = cards([
      doc('p', 'profile', { kind: 'profile', included: 12, available: 40 }),
      doc('s', 'system-security-plan', { kind: 'ssp', documented: 7, baseline: 12 }),
      doc('r', 'assessment-results', { kind: 'assessment-results', assessed: 5, notSatisfied: 2, unknown: 1 }),
      doc('m', 'plan-of-action-and-milestones', { kind: 'poam', open: 3, overdue: 1 }),
    ]);
    expect(catalog).toHaveTextContent('1.234 Anforderungen');
    expect(within(profile).getByRole('link')).toHaveAccessibleName('Anforderungspaket bearbeiten, Profile, Gültig, 12 von 40 aufgenommen');
    expect(ssp).toHaveTextContent('7 von 12 dokumentiert');
    expect(assessment).toHaveTextContent('5 geprüft · 2 nicht erfüllt · 1 ohne auswertbaren Status');
    expect(poam).toHaveTextContent('3 offene Maßnahmen');
    expect(poam).toHaveTextContent('1 überfällig · berechnet aus Frist und Systemzeit');
    // Gültige Prüfergebnisse: kein Reihenfolge-Hinweis.
    expect(poam).not.toHaveTextContent('keine erzwungene Reihenfolge');
  });

  it('zeigt bei mehreren Dokumenten einer Station die Dokumentanzahl und ohne Überfälliges keinen Hinweis', () => {
    const [, profile, , , poam] = cards([
      doc('p1', 'profile', { kind: 'profile', included: 1, available: 2 }),
      doc('p2', 'profile'),
      doc('m', 'plan-of-action-and-milestones', { kind: 'poam', open: 1, overdue: 0 }),
    ]);
    expect(profile).toHaveTextContent('2 Dokumente');
    expect(profile).not.toHaveTextContent('aufgenommen');
    expect(poam).toHaveTextContent('1 offene Maßnahme');
    expect(poam).not.toHaveTextContent('überfällig');
  });
});
