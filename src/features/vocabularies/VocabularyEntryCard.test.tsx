import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
  createTestVocabularyRegistry,
  VOCABULARY_IDENTIFIERS,
} from '@/test/fixtures/vocabulary';
import { resolveVocabularyEntry } from '@/domain/vocabulary';
import { VocabularyEntryCard } from './VocabularyEntryCard';

const TARGET_OBJECT_NAMESPACE =
  'https://example.com/namespaces/target_object_categories.csv';

function renderCard(value: string, hiddenColumns?: string[]) {
  const registry = createTestVocabularyRegistry();
  const resolution = resolveVocabularyEntry(registry, TARGET_OBJECT_NAMESPACE, value)!;

  render(
    <MemoryRouter>
      <VocabularyEntryCard resolution={resolution} hiddenColumns={hiddenColumns} />
    </MemoryRouter>,
  );

  return resolution;
}

describe('VocabularyEntryCard', () => {
  it('shows the entry identifier as a plain metadata row', () => {
    renderCard('Server');

    expect(screen.getByText('UUID').tagName).toBe('DT');
    expect(screen.getByText(VOCABULARY_IDENTIFIERS.targetObjectServer)).toBeInTheDocument();
  });

  it('renders ChildOfUUID as a linked parent term instead of the raw identifier', () => {
    renderCard('Dateiserver');

    // Die Rohkennung des Elternverweises steht nirgends auf der Karte.
    expect(
      screen.queryByText(VOCABULARY_IDENTIFIERS.targetObjectServer),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('ChildOfUUID')).not.toBeInTheDocument();

    const label = screen.getByText('Übergeordneter Eintrag');
    expect(label.tagName).toBe('DT');

    const parentLink = screen.getByRole('link', { name: 'Server' });
    expect(parentLink).toHaveAttribute(
      'href',
      '/vokabular/target-object-categories?wert=Server',
    );

    // Die eigene Kennung des Eintrags bleibt erhalten.
    expect(
      screen.getByText(VOCABULARY_IDENTIFIERS.targetObjectDateiserver),
    ).toBeInTheDocument();
  });

  it('drops the row when the parent reference resolves to nothing', () => {
    renderCard('Verwaiste Kategorie');

    expect(screen.queryByText('Übergeordneter Eintrag')).not.toBeInTheDocument();
    expect(screen.queryByText('ChildOfUUID')).not.toBeInTheDocument();
    expect(
      screen.queryByText(VOCABULARY_IDENTIFIERS.targetObjectOrphanParent),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(VOCABULARY_IDENTIFIERS.targetObjectOrphan),
    ).toBeInTheDocument();
  });

  it('still honours curated hidden columns', () => {
    renderCard('Dateiserver', ['Objektklasse']);

    expect(screen.queryByText('Objektklasse')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Server' })).toBeInTheDocument();
  });

  it('renders no metadata list when every column is hidden or empty', () => {
    renderCard('Server', ['Objektklasse', 'UUID']);

    expect(document.querySelector('dl')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Zu den Vokabularen →' }),
    ).toBeInTheDocument();
  });

  it('keeps the footer link pointing at the entry itself', () => {
    renderCard('Dateiserver');

    const footer = screen.getByRole('link', { name: 'Zu den Vokabularen →' });
    expect(footer).toHaveAttribute(
      'href',
      '/vokabular/target-object-categories?wert=Dateiserver',
    );
    // Genau zwei Links: der Elternverweis und der Fußlink.
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
