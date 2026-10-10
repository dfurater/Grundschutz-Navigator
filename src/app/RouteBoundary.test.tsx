import { act, fireEvent, render, screen } from '@testing-library/react';
import { lazy } from 'react';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTitle } from './PageTitle';
import { LazyRoute, RouteLoading } from './RouteBoundary';
import { PRODUCT_TITLE } from './pageTitles';
import { expectSingleDocumentTitle } from '@/test/documentTitle';

/** Seite, deren Chunk erst auf Aufruf von `resolve` eintrifft. */
function deferredPage(): { Page: ComponentType; resolve: () => void } {
  let release: () => void = () => {};
  const arrived = new Promise<void>((resolve) => { release = resolve; });
  const Page = lazy(async () => {
    await arrived;
    return { default: () => <h1>Seiteninhalt</h1> };
  });
  return { Page, resolve: release };
}

function failingPage(): ComponentType {
  return lazy(() => Promise.reject(new Error('Chunk nicht erreichbar')));
}

function Shell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <MemoryRouter>
      <header>Kopfzeile</header>
      <main>{children}</main>
      <footer>Fußzeile</footer>
    </MemoryRouter>
  );
}

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

describe('LazyRoute', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React meldet abgefangene Renderfehler zusätzlich auf der Konsole.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  it('zeigt den Ladezustand, bis der Chunk eintrifft, und danach die Seite', async () => {
    const { Page, resolve } = deferredPage();
    render(<Shell><LazyRoute><Page /></LazyRoute></Shell>);

    expect(screen.getByRole('status')).toHaveTextContent('Seite wird geladen…');
    expect(screen.queryByRole('heading', { name: 'Seiteninhalt' })).not.toBeInTheDocument();

    await act(async () => { resolve(); });

    expect(await screen.findByRole('heading', { name: 'Seiteninhalt' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('ersetzt bei einem fehlgeschlagenen Chunk nur die Seitenfläche', async () => {
    const Page = failingPage();
    render(<Shell><LazyRoute><Page /></LazyRoute></Shell>);

    const alert = await screen.findByRole('alert');
    expect(alert).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Seite konnte nicht geladen werden' }),
    );
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Startseite' })).toHaveAttribute('href', '/');
    // Die Shell bleibt bedienbar, und die Fehlerursache erscheint nicht in der Oberfläche.
    expect(screen.getByText('Kopfzeile')).toBeInTheDocument();
    expect(screen.getByText('Fußzeile')).toBeInTheDocument();
    expect(screen.queryByText(/Chunk nicht erreichbar/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('lädt über „Neu laden“ die Seite neu und sonst nie von selbst', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...globalThis.location, reload });
    const Page = failingPage();
    render(<Shell><LazyRoute><Page /></LazyRoute></Shell>);

    const button = await screen.findByRole('button', { name: 'Neu laden' });
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(button);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('setzt den Fehlerzustand bei geändertem resetKey zurück', async () => {
    const Broken = failingPage();
    const Healthy = () => <h1>Gesunde Seite</h1>;
    const { rerender } = render(
      <Shell><LazyRoute resetKey="/kaputt"><Broken /></LazyRoute></Shell>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    rerender(<Shell><LazyRoute resetKey="/gesund"><Healthy /></LazyRoute></Shell>);

    expect(screen.getByRole('heading', { name: 'Gesunde Seite' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hält bei gleichem resetKey im Fehlerzustand fest', async () => {
    const Broken = failingPage();
    const { rerender } = render(<Shell><LazyRoute resetKey="/a"><Broken /></LazyRoute></Shell>);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    rerender(<Shell><LazyRoute resetKey="/a"><Broken /></LazyRoute></Shell>);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('zeigt einen Fehler, der im selben Render wie der resetKey-Wechsel auftritt', async () => {
    const Healthy = () => <h1>Gesunde Seite</h1>;
    const Throwing = () => { throw new Error('Renderfehler'); };
    const { rerender } = render(<Shell><LazyRoute resetKey="/a"><Healthy /></LazyRoute></Shell>);

    rerender(<Shell><LazyRoute resetKey="/b"><Throwing /></LazyRoute></Shell>);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Kopfzeile')).toBeInTheDocument();
    // Ein weiterer Render auf demselben Pfad lässt den Fehlerzustand stehen.
    rerender(<Shell><LazyRoute resetKey="/b"><Throwing /></LazyRoute></Shell>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('erholt sich nach einem Fehler beim nächsten Pfadwechsel und fängt den folgenden erneut', async () => {
    const Healthy = () => <h1>Gesunde Seite</h1>;
    const Throwing = () => { throw new Error('Renderfehler'); };
    const { rerender } = render(<Shell><LazyRoute resetKey="/a"><Throwing /></LazyRoute></Shell>);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    rerender(<Shell><LazyRoute resetKey="/b"><Healthy /></LazyRoute></Shell>);
    expect(screen.getByRole('heading', { name: 'Gesunde Seite' })).toBeInTheDocument();

    rerender(<Shell><LazyRoute resetKey="/c"><Throwing /></LazyRoute></Shell>);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('trägt im Fehlerzustand ohne Routentitel den Produktnamen', async () => {
    const Throwing = () => { throw new Error('Renderfehler'); };
    render(<Shell><LazyRoute><Throwing /></LazyRoute></Shell>);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expectSingleDocumentTitle(PRODUCT_TITLE);
  });

  it('setzt den Titel der Route vor dem Eintreffen des Chunks, wenn er außerhalb der Grenze steht', async () => {
    const { Page, resolve } = deferredPage();
    render(
      <Shell>
        <PageTitle title="Suche" />
        <LazyRoute><Page /></LazyRoute>
      </Shell>,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expectSingleDocumentTitle(`Suche | ${PRODUCT_TITLE}`);

    await act(async () => { resolve(); });

    expect(await screen.findByRole('heading', { name: 'Seiteninhalt' })).toBeInTheDocument();
    expectSingleDocumentTitle(`Suche | ${PRODUCT_TITLE}`);
  });

  it('nutzt fallbackTitle im Lade- und im Fehlerzustand', async () => {
    const { Page, resolve } = deferredPage();
    const { unmount } = render(
      <Shell><LazyRoute fallbackTitle="Vokabulare"><Page /></LazyRoute></Shell>,
    );
    expectSingleDocumentTitle(`Vokabulare | ${PRODUCT_TITLE}`);
    await act(async () => { resolve(); });
    unmount();

    const Broken = failingPage();
    render(<Shell><LazyRoute fallbackTitle="Vokabulare"><Broken /></LazyRoute></Shell>);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expectSingleDocumentTitle(`Vokabulare | ${PRODUCT_TITLE}`);
  });
});
