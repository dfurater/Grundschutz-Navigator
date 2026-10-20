import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SspFields } from '@/features/workspace/ssp/SspFields';

describe('große SSP-Listen', () => {
  it('rendert einen begrenzten Ausschnitt und macht weitere Einträge erreichbar', () => {
    render(<SspFields value={Array.from({ length: 121 }, (_, index) => `Wert ${index}`)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(screen.queryByText('Wert 50')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Weitere Einträge/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    fireEvent.click(screen.getByRole('button', { name: /Weitere Einträge/ }));
    expect(screen.getByText('Wert 120')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
