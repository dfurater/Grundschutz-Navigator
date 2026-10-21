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

  it('nennt den Auflösungszustand einer externen UUID keinen Betriebsstatus', () => {
    render(<SspFields value={{ uuid: '66666666-0000-4000-8000-000000000015', status: 'not-resolvable-in-context' }} />);
    expect(screen.queryByText('Betriebsstatus')).not.toBeInTheDocument();
    expect(screen.getByText('Verweiszustand')).toBeInTheDocument();
    expect(screen.getByText('nicht auflösbar im aktuellen Kontext')).toBeInTheDocument();
  });

  it('trägt Kennungsschrift in UUID-Listen und Anforderungstitel weiter', async () => {
    const { container } = render(<SspFields value={{ partyUuids: ['ID-PARTY'], implementedRequirements: [{ controlId: 'AC-1' }] }} />);
    for (const detail of container.querySelectorAll('details')) {
      detail.open = true;
      fireEvent(detail, new Event('toggle'));
    }
    expect(screen.getByText('ID-PARTY')).toHaveClass('font-mono');
    expect(screen.getByText(/· AC-1/)).toHaveClass('font-mono');
    expect(screen.getByText('1', { selector: 'span' })).toHaveClass('tabular-nums');
  });
});
