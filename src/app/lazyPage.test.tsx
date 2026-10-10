import { act, render, screen } from '@testing-library/react';
import { Suspense, useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { lazyPage } from './lazyPage';

function pageLoader(onMount: () => void = () => {}) {
  const Content = () => {
    useEffect(onMount, []);
    return <h1>Seite</h1>;
  };
  return () => Promise.resolve({ default: Content });
}

const Frame = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <Suspense fallback={<p>Lädt</p>}>{children}</Suspense>
);

describe('lazyPage', () => {
  it('suspendiert ohne Vorladen beim ersten Render und zeigt danach die Seite', async () => {
    const Page = lazyPage(pageLoader());
    render(<Frame><Page /></Frame>);

    expect(screen.getByText('Lädt')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Seite' })).toBeInTheDocument();
  });

  it('rendert nach preload() sofort, ohne Fallback', async () => {
    const Page = lazyPage(pageLoader());
    await Page.preload();

    render(<Frame><Page /></Frame>);

    expect(screen.getByRole('heading', { name: 'Seite' })).toBeInTheDocument();
    expect(screen.queryByText('Lädt')).not.toBeInTheDocument();
  });

  it('mountet eine bereits sichtbare Instanz nicht neu, wenn der Chunk danach als geladen gilt', async () => {
    let mounts = 0;
    const Page = lazyPage(pageLoader(() => { mounts += 1; }));
    const { rerender } = render(<Frame><Page /></Frame>);
    expect(await screen.findByRole('heading', { name: 'Seite' })).toBeInTheDocument();

    await act(async () => { await Page.preload(); });
    rerender(<Frame><Page /></Frame>);

    expect(mounts).toBe(1);
  });

  it('meldet einen Ladefehler beim Vorladen nicht und überlässt ihn dem ersten Render', async () => {
    const Page = lazyPage(() => Promise.reject(new Error('Chunk fehlt')));

    await expect(Page.preload()).resolves.toBeUndefined();
  });
});
