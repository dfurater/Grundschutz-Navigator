import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ResolvedOscalReference } from '@/domain/referenceResolution';
import { ControlSources } from './ControlSources';

const references: readonly ResolvedOscalReference[] = [
  {
    kind: 'resource',
    href: '#resource-empty',
    path: '/catalog/groups/0/controls/0/links/0/href',
    text: 'Leere Quelle',
    resourceFragment: 'abschnitt-2.4',
    resource: {
      uuid: 'resource-empty',
      content: 'empty',
      rlinks: [],
    },
  },
  {
    kind: 'resource',
    href: '#resource-rich',
    path: '/catalog/groups/0/controls/0/links/1/href',
    resource: {
      uuid: 'resource-rich',
      title: 'Mehrfach verlinkte Quelle',
      citation: 'BSI, Quelle, 2026',
      content: 'available',
      embeddedContent: { filename: 'evidence.pdf', mediaType: 'application/pdf' },
      rlinks: [
        {
          href: 'https://example.invalid/first.pdf',
          hashes: [],
          integrity: 'missing',
          target: { kind: 'external', href: 'https://example.invalid/first.pdf' },
        },
        {
          href: 'http://example.invalid/not-safe',
          hashes: [],
          integrity: 'missing',
          target: { kind: 'unresolved', reason: 'unsafe-protocol' },
        },
      ],
    },
  },
  {
    kind: 'external',
    href: 'https://example.invalid/external',
    path: '/catalog/groups/0/controls/0/links/2/href',
    text: 'Externe Quelle',
  },
  {
    kind: 'unresolved',
    href: '../unresolved.json',
    path: '/catalog/groups/0/controls/0/links/3/href',
    reason: 'relative',
    diagnostic: {
      code: 'OSCAL_REFERENCE_RELATIVE',
      severity: 'error',
      stage: 'reference',
      artifact: { key: 'gspp', rootType: 'catalog', oscalVersion: '1.1.3' },
      path: '/catalog/groups/0/controls/0/links/3/href',
      validator: { name: 'reference-resolution', version: '1' },
      signature: 'reference-resolution@1|OSCAL_REFERENCE_RELATIVE|/catalog/groups/0/controls/0/links/3/href',
      messageKey: 'oscal.reference.relative',
      params: { reason: 'relative' },
    },
  },
];

describe('ControlSources', () => {
  it('renders sources separately, exposes resource fragments, and only makes HTTPS destinations clickable', () => {
    render(<ControlSources references={references} />);

    expect(screen.getByRole('heading', { name: 'Quellen und Verweise', level: 3 }))
      .toBeInTheDocument();
    expect(screen.getByText('Fragment: abschnitt-2.4')).toBeInTheDocument();
    expect(screen.getByText('Ressource enthält keine darstellbaren Inhalte.')).toBeInTheDocument();
    expect(screen.getByText('Eingebetteter Inhalt: evidence.pdf (application/pdf)')).toBeInTheDocument();
    expect(screen.getAllByText('Ohne Integritätsnachweis')).toHaveLength(2);

    const external = screen.getByRole('link', { name: /Externe Quelle/i });
    expect(external).toHaveAttribute('href', 'https://example.invalid/external');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');

    const resource = screen.getByText('Mehrfach verlinkte Quelle').closest('li')!;
    expect(within(resource).getByRole('link', { name: /first.pdf/i }))
      .toHaveAttribute('href', 'https://example.invalid/first.pdf');
    expect(within(resource).queryByRole('link', { name: /not-safe/i })).not.toBeInTheDocument();
    expect(within(resource).getByText('http://example.invalid/not-safe')).toBeInTheDocument();
    expect(screen.getByText('../unresolved.json')).toBeInTheDocument();
  });

  it('returns no section when there are no source-like references', () => {
    const { container } = render(<ControlSources references={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
