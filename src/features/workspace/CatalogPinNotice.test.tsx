import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_DIAGNOSTIC_CODES } from '@/domain/workspaceDiagnostics';
import type { CatalogPin } from '@/domain/workspaceCatalogPin';
import { CatalogPinNotice } from './CatalogPinNotice';

const notDelivered = (offers: readonly string[]): CatalogPin => ({
  state: 'not-delivered', code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered, offers, withheld: ['catalog-x'], pending: [],
});

describe('CatalogPinNotice', () => {
  it('nennt bei einem neueren ausgelieferten Stand die Migration', () => {
    render(<CatalogPinNotice pin={notDelivered(['gspp'])} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Gebundener Katalogstand nicht mehr ausgeliefert');
    expect(screen.getByRole('alert')).toHaveTextContent('neueren Stand');
  });

  it('behauptet bei einem nicht ausgelieferten Katalog keinen neueren Stand', () => {
    render(<CatalogPinNotice pin={notDelivered([])} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Gebundener Katalog nicht ausgeliefert');
    expect(alert).not.toHaveTextContent('neueren Stand');
    expect(alert).toHaveTextContent(WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered);
  });
});
