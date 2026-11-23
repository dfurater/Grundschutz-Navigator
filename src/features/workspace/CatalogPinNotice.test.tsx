import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_DIAGNOSTIC_CODES } from '@/domain/workspaceDiagnostics';
import type { CatalogPin } from '@/domain/workspaceCatalogPin';
import { CatalogPinNotice } from './CatalogPinNotice';

const notDelivered = (offers: readonly string[], undelivered = false): CatalogPin => ({
  state: 'not-delivered', code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered, offers, withheld: ['catalog-x'], pending: [],
  ...(undelivered ? { undelivered: true as const } : {}),
});

describe('CatalogPinNotice', () => {
  it('nennt bei einem neueren ausgelieferten Stand die Migration', () => {
    render(<CatalogPinNotice pin={notDelivered(['gspp'])} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Gebundener Katalogstand nicht mehr ausgeliefert');
    expect(screen.getByRole('alert')).toHaveTextContent('neueren Stand');
  });

  it.each([
    ['allein', [] as string[]],
    ['neben einem ersetzten ausgelieferten Stand', ['gspp']],
  ])('nennt einen nicht ausgelieferten Katalog %s statt einer Migration', (_label, offers) => {
    render(<CatalogPinNotice pin={notDelivered(offers, true)} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Gebundener Katalog nicht ausgeliefert');
    expect(alert).not.toHaveTextContent('neueren Stand');
    expect(alert).toHaveTextContent(WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered);
  });
});
