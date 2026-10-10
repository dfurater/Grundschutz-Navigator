import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteLoadError, RouteLoading } from './RouteBoundary';
import { PRODUCT_TITLE } from './pageTitles';
import { expectSingleDocumentTitle } from '@/test/documentTitle';

describe('RouteLoading', () => {
  it('meldet den Ladezustand als Status mit sichtbarem Text', () => {
    render(<RouteLoading />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Seite wird geladen…');
    expect(status.querySelector('[aria-hidden="true"]')).toHaveClass('animate-spin');
  });

  it('setzt ohne Titel keinen Dokumenttitel', () => {
    render(<RouteLoading />);

    expect(document.head.querySelectorAll('title')).toHaveLength(0);
  });

  it('setzt einen übergebenen Titel', () => {
    render(<RouteLoading title="Vokabulare" />);

    expectSingleDocumentTitle(`Vokabulare | ${PRODUCT_TITLE}`);
  });

  it('trägt bei bekanntem Titel eine verborgene Hauptüberschrift neben dem Status', () => {
    render(<RouteLoading title="Suche" />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Suche' });
    expect(heading).toHaveClass('sr-only');
    expect(screen.getByRole('status')).not.toContainElement(heading);
  });

  it('rendert ohne Titel keine Überschrift', () => {
    render(<RouteLoading />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('RouteLoadError', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('meldet den Fehler als Alarm mit Überschrift, „Neu laden“ und Link zur Startseite', () => {
    render(<MemoryRouter><RouteLoadError /></MemoryRouter>);

    const alert = screen.getByRole('alert');
    expect(alert).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Seite konnte nicht geladen werden' }),
    );
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Startseite' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('lädt über „Neu laden“ die Seite neu und sonst nie von selbst', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...globalThis.location, reload });
    render(<MemoryRouter><RouteLoadError /></MemoryRouter>);
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('trägt ohne Routentitel den Produktnamen', () => {
    render(<MemoryRouter><RouteLoadError /></MemoryRouter>);

    expectSingleDocumentTitle(PRODUCT_TITLE);
  });

  it('trägt einen übergebenen Routentitel', () => {
    render(<MemoryRouter><RouteLoadError title="Vokabulare" /></MemoryRouter>);

    expectSingleDocumentTitle(`Vokabulare | ${PRODUCT_TITLE}`);
  });
});
