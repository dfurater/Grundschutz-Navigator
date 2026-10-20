import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionCriteria } from '@/features/workspace/profile/SelectionCriteria';

describe('SelectionCriteria', () => {
  it('rendert lange ID-Listen erst auf ausdrücklichen Wunsch vollständig', () => {
    const withIds = Array.from({ length: 60 }, (_, index) => `ID.${index}`);
    const actions = { setId: vi.fn(), addPattern: vi.fn(), setPattern: vi.fn(), removePattern: vi.fn() };
    render(<SelectionCriteria title="Ausschlüsse" oscalKey="exclude-controls" view={{ withIds, patterns: [] }} ids={[]} actions={actions} />);
    expect(screen.getAllByRole('button', { name: /entfernen$/ })).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Alle 60 anzeigen' }));
    expect(screen.getAllByRole('button', { name: /entfernen$/ })).toHaveLength(60);
  });
});
