import { act, fireEvent, render, screen } from '@testing-library/react';
import { Component, Suspense, lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link, MemoryRouter, Route, Routes, UNSAFE_createMemoryHistory, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NAVIGATION_PENDING_DELAY_MS,
  NavigationPendingIndicator,
  TransitionRouter,
} from './navigationPending';

/** Seite, deren Chunk erst auf Aufruf von `resolve` (oder `reject`) eintrifft. */
function deferredPage(name: string): { Page: ComponentType; resolve: () => void; reject: () => void } {
  let release: () => void = () => {};
  let fail: () => void = () => {};
  const arrived = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = () => reject(new Error('Chunk nicht erreichbar'));
  });
  const Page = lazy(async () => {
    await arrived;
    return { default: () => <h1>{name}</h1> };
  });
  return { Page, resolve: release, reject: fail };
}

class ErrorCatcher extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <p role="alert">Fehlerfläche</p> : this.props.children;
  }
}

function ProgrammaticNavigation() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => { void navigate('/langsam'); }}>Programmnavigation</button>;
}

function renderApp(Slow: ComponentType) {
  const history = UNSAFE_createMemoryHistory({ initialEntries: ['/'], v5Compat: true });
  render(
    <TransitionRouter history={history}>
      <Link to="/">Start</Link>
      <Link to="/langsam">Langsam</Link>
      <ProgrammaticNavigation />
      <NavigationPendingIndicator />
      <Suspense fallback={<p>Fallback</p>}>
        <Routes>
          <Route path="/" element={<h1>Start</h1>} />
          <Route path="/langsam" element={<Slow />} />
        </Routes>
      </Suspense>
    </TransitionRouter>,
  );
  return history;
}

const PENDING_TEXT = 'Seite wird geladen…';

async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

describe('TransitionRouter mit NavigationPendingIndicator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('zeigt den Hinweis erst nach der Schwelle und hält bis dahin die vorige Seite', async () => {
    const slow = deferredPage('Langsame Seite');
    renderApp(slow.Page);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('link', { name: 'Langsam' }));
    await advance(NAVIGATION_PENDING_DELAY_MS - 1);

    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expect(screen.queryByText('Fallback')).not.toBeInTheDocument();

    await advance(1);

    expect(status).toHaveTextContent(PENDING_TEXT);
    expect(status.querySelector('[aria-hidden="true"]')).toHaveClass('animate-spin');
    expect(status).toHaveClass('pointer-events-none');
    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();

    await act(async () => { slow.resolve(); });

    expect(screen.getByRole('heading', { name: 'Langsame Seite' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('meldet auch eine Navigation ohne Link (Programm, Tastenkürzel)', async () => {
    const slow = deferredPage('Langsame Seite');
    renderApp(slow.Page);

    fireEvent.click(screen.getByRole('button', { name: 'Programmnavigation' }));
    await advance(NAVIGATION_PENDING_DELAY_MS);

    expect(screen.getByRole('status')).toHaveTextContent(PENDING_TEXT);
    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();

    await act(async () => { slow.resolve(); });

    expect(screen.getByRole('heading', { name: 'Langsame Seite' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('räumt den Hinweis, wenn eine weitere Navigation die wartende ablöst', async () => {
    const slow = deferredPage('Langsame Seite');
    renderApp(slow.Page);

    fireEvent.click(screen.getByRole('link', { name: 'Langsam' }));
    await advance(NAVIGATION_PENDING_DELAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent(PENDING_TEXT);

    fireEvent.click(screen.getByRole('link', { name: 'Start' }));
    await advance(0);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();

    // Der verspätete Chunk wechselt die Seite nicht nachträglich.
    await act(async () => { slow.resolve(); });
    await advance(NAVIGATION_PENDING_DELAY_MS);

    expect(screen.getByRole('heading', { name: 'Start' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Langsame Seite' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('räumt den Hinweis, wenn der Chunk fehlschlägt', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = deferredPage('Nie sichtbar');
    const history = UNSAFE_createMemoryHistory({ initialEntries: ['/'], v5Compat: true });
    render(
      <TransitionRouter history={history}>
        <Link to="/langsam">Langsam</Link>
        <NavigationPendingIndicator />
        <ErrorCatcher>
          <Suspense fallback={<p>Fallback</p>}>
            <Routes>
              <Route path="/" element={<h1>Start</h1>} />
              <Route path="/langsam" element={<failing.Page />} />
            </Routes>
          </Suspense>
        </ErrorCatcher>
      </TransitionRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Langsam' }));
    await advance(NAVIGATION_PENDING_DELAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent(PENDING_TEXT);

    await act(async () => { failing.reject(); });

    expect(screen.getByRole('alert')).toHaveTextContent('Fehlerfläche');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    consoleError.mockRestore();
  });

  it('übernimmt Basis und Verlauf wie BrowserRouter', () => {
    const history = UNSAFE_createMemoryHistory({ initialEntries: ['/basis/langsam'], v5Compat: true });
    render(
      <TransitionRouter history={history} basename="/basis">
        <Routes>
          <Route path="/langsam" element={<h1>Unter der Basis</h1>} />
        </Routes>
      </TransitionRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Unter der Basis' })).toBeInTheDocument();
  });
});

describe('NavigationPendingIndicator außerhalb von TransitionRouter', () => {
  it('rendert nichts', () => {
    const { container } = render(
      <MemoryRouter>
        <NavigationPendingIndicator />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
