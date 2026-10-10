import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { Link, Outlet, createMemoryRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATION_PENDING_DELAY_MS, NavigationPendingIndicator } from './navigationPending';

/** Lazy-Route, deren Modul erst auf Aufruf von `resolve` (oder `reject`) eintrifft. */
function deferredRoute(path: string, name: string): { route: RouteObject; resolve: () => void; reject: () => void } {
  let release: () => void = () => {};
  let fail: () => void = () => {};
  const arrived = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = () => reject(new Error('Chunk nicht erreichbar'));
  });
  const route: RouteObject = {
    path,
    lazy: async () => {
      await arrived;
      const Component: ComponentType = () => <h1>{name}</h1>;
      return { Component };
    },
  };
  return { route, resolve: release, reject: fail };
}

function Layout() {
  return (
    <>
      <Link to="/">Start</Link>
      <Link to="/langsam">Langsam</Link>
      <NavigationPendingIndicator />
      <Outlet />
    </>
  );
}

function renderApp(slow: RouteObject) {
  const router = createMemoryRouter([{
    element: <Layout />,
    children: [{
      ErrorBoundary: () => <p role="alert">Fehlerfläche</p>,
      children: [{ path: '/', element: <h1>Start</h1> }, slow],
    }],
  }]);
  render(<RouterProvider router={router} />);
  return router;
}

const PENDING_TEXT = 'Seite wird geladen…';

async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

describe('NavigationPendingIndicator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('zeigt den Hinweis erst nach der Schwelle und hält bis dahin vorige Seite und Ort', async () => {
    const slow = deferredRoute('/langsam', 'Langsame Seite');
    const router = renderApp(slow.route);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('link', { name: 'Langsam' }));
    await advance(NAVIGATION_PENDING_DELAY_MS - 1);

    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(status).toBeEmptyDOMElement();

    await advance(1);

    expect(status).toHaveTextContent(PENDING_TEXT);
    expect(status.querySelector('[aria-hidden="true"]')).toHaveClass('animate-spin');
    expect(status).toHaveClass('pointer-events-none');
    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();

    await act(async () => { slow.resolve(); });

    expect(screen.getByRole('heading', { name: 'Langsame Seite' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/langsam');
    expect(status).toBeEmptyDOMElement();
  });

  it('meldet auch eine Navigation ohne Link (Programm, Tastenkürzel)', async () => {
    const slow = deferredRoute('/langsam', 'Langsame Seite');
    const router = renderApp(slow.route);

    act(() => { void router.navigate('/langsam'); });
    await advance(NAVIGATION_PENDING_DELAY_MS);

    expect(screen.getByRole('status')).toHaveTextContent(PENDING_TEXT);
    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();

    await act(async () => { slow.resolve(); });

    expect(screen.getByRole('heading', { name: 'Langsame Seite' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('räumt den Hinweis, wenn eine weitere Navigation die wartende ablöst', async () => {
    const slow = deferredRoute('/langsam', 'Langsame Seite');
    const router = renderApp(slow.route);

    fireEvent.click(screen.getByRole('link', { name: 'Langsam' }));
    await advance(NAVIGATION_PENDING_DELAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent(PENDING_TEXT);

    await act(async () => { await router.navigate('/?abgeloest'); });

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();

    // Der verspätete Chunk wechselt die Seite nicht nachträglich.
    await act(async () => { slow.resolve(); });
    await advance(NAVIGATION_PENDING_DELAY_MS);

    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Langsame Seite' })).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?abgeloest');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('räumt den Hinweis, wenn der Chunk fehlschlägt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = deferredRoute('/langsam', 'Nie sichtbar');
    renderApp(failing.route);

    fireEvent.click(screen.getByRole('link', { name: 'Langsam' }));
    await advance(NAVIGATION_PENDING_DELAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent(PENDING_TEXT);

    await act(async () => { failing.reject(); });

    expect(screen.getByRole('alert')).toHaveTextContent('Fehlerfläche');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    vi.mocked(console.error).mockRestore();
  });
});
