import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ControlWlanTaxonomy } from './ControlTaxonomy';

const PLACEHOLDER_NS = 'https://bsi.bund.de/ns/sdt/custom-properties/placeholder';
const REAL_NS = 'https://bsi.bund.de/ns/sdt/custom-properties/wlan-taxonomy';

describe('ControlWlanTaxonomy', () => {
  it('zeigt die Stufen als Tabelle: Stufe links, Wert rechts', () => {
    render(
      <ControlWlanTaxonomy
        control={{
          taxonomy: [
            { name: 'Taxonomy-L1', value: 'Identify', ns: PLACEHOLDER_NS },
            { name: 'Taxonomy-L2', value: 'Asset & Exposure Management', ns: PLACEHOLDER_NS },
          ],
        }}
      />,
    );

    const group = screen.getByLabelText('WLAN-Taxonomie');
    // Zwei Spalten mit gemeinsamer Wertkante statt grauer Kästen.
    expect(group.querySelector('dl')).toHaveClass('grid', 'grid-cols-[auto_1fr]');
    const rows = [...group.querySelectorAll('dl > div')];
    expect(rows.map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])).toEqual([
      ['L1', 'Identify'],
      ['L2', 'Asset & Exposure Management'],
    ]);
    for (const row of rows) expect(row).toHaveClass('contents');
  });

  it('blendet den BSI-Platzhalter als Namensraum aus', () => {
    render(
      <ControlWlanTaxonomy control={{ taxonomy: [{ name: 'Taxonomy-L1', value: 'Identify', ns: PLACEHOLDER_NS }] }} />,
    );

    expect(screen.queryByText(PLACEHOLDER_NS)).not.toBeInTheDocument();
  });

  it('zeigt einen echten Namensraum automatisch wieder', () => {
    render(
      <ControlWlanTaxonomy control={{ taxonomy: [{ name: 'Taxonomy-L1', value: 'Identify', ns: REAL_NS }] }} />,
    );

    const row = screen.getByLabelText('WLAN-Taxonomie').querySelector('dl > div') as HTMLElement;
    expect(within(row).getByText(REAL_NS).tagName).toBe('DD');
  });
});
