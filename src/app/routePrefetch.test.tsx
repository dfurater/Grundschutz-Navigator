import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutePrefetcher, findLazyRoutePreload, internalRoutePath } from './routePrefetch';

function setup(basename?: string) {
  const preload = vi.fn(() => Promise.resolve());
  const lookup = vi.fn((routePath: string) => (
    ['/suche', '/about', '/vokabular/security-level'].includes(routePath)
      ? { key: routePath, preload }
      : undefined
  ));
  const handle = createRoutePrefetcher(basename, lookup);
  document.addEventListener('pointerover', handle, true);
  document.addEventListener('focusin', handle, true);
  document.addEventListener('pointerdown', handle, true);
  return { preload, lookup };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function link(href: string, attributes: Record<string, string> = {}) {
  render(<a href={href} {...attributes}><span>Ziel</span></a>);
  return screen.getByText('Ziel');
}

describe('createRoutePrefetcher', () => {
  it.each(['pointerOver', 'focusIn', 'pointerDown'] as const)('lädt bei %s auf einen Link zu einer Lazy-Route genau einmal vor', (name) => {
    const { preload } = setup();
    const target = link('/suche');

    fireEvent[name](target);

    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('lädt eine Route bei wiederholten Ereignissen über allen Links höchstens einmal vor', () => {
    const { preload } = setup();
    const target = link('/suche');

    fireEvent.pointerOver(target);
    fireEvent.pointerOver(target);
    fireEvent.focusIn(target);
    fireEvent.pointerDown(target);

    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('lädt andere Routen unabhängig vor', () => {
    const { preload } = setup();
    render(<><a href="/suche">A</a><a href="/about">B</a></>);

    fireEvent.pointerOver(screen.getByText('A'));
    fireEvent.pointerOver(screen.getByText('B'));

    expect(preload).toHaveBeenCalledTimes(2);
  });

  it('ignoriert Ereignisse außerhalb von Links und Links ohne Lazy-Route', () => {
    const { preload, lookup } = setup();
    render(<><p>Text</p><a href="/katalog/gspp">Katalog</a><a>Ohne href</a></>);

    fireEvent.pointerOver(screen.getByText('Text'));
    fireEvent.pointerOver(screen.getByText('Katalog'));
    fireEvent.pointerOver(screen.getByText('Ohne href'));

    expect(preload).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['externer Link', 'https://example.org/suche', {}],
    ['anderer Origin mit gleichem Pfad', 'http://andere.test/suche', {}],
    ['target=_blank', '/suche', { target: '_blank' }],
    ['download', '/suche', { download: '' }],
    ['Hash-Link', '#suche', {}],
  ])('lädt bei %s nicht vor', (_label, href, attributes) => {
    const { preload } = setup();
    const target = link(href, attributes);

    fireEvent.pointerOver(target);

    expect(preload).not.toHaveBeenCalled();
  });

  it('lädt bei target=_self vor', () => {
    const { preload } = setup();

    fireEvent.pointerOver(link('/suche', { target: '_self' }));

    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('schneidet die Basis ab und ignoriert Pfade außerhalb davon, auch /Basis-x', () => {
    const { preload, lookup } = setup('/Basis');
    render(<><a href="/Basis/suche">In</a><a href="/Basis-x/suche">Fremd</a><a href="/suche">Ohne</a></>);

    fireEvent.pointerOver(screen.getByText('Fremd'));
    fireEvent.pointerOver(screen.getByText('Ohne'));
    expect(lookup).not.toHaveBeenCalled();
    fireEvent.pointerOver(screen.getByText('In'));

    expect(lookup).toHaveBeenCalledWith('/suche');
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('lädt mit aktivem Datensparmodus nicht vor, und ohne navigator.connection schon', () => {
    const { preload } = setup();
    const target = link('/suche');
    vi.stubGlobal('navigator', { connection: { saveData: true } });

    fireEvent.pointerOver(target);
    expect(preload).not.toHaveBeenCalled();

    vi.stubGlobal('navigator', {});
    fireEvent.pointerOver(target);
    expect(preload).toHaveBeenCalledTimes(1);
  });
});

describe('internalRoutePath', () => {
  it('liefert den Pfad ohne Query und Hash', () => {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', '/suche?q=x#a');

    expect(internalRoutePath(anchor)).toBe('/suche');
  });
});

describe('findLazyRoutePreload', () => {
  it.each(['/suche', '/suche/', '/vokabular', '/about', '/datenschutz', '/impressum', '/lizenzen', '/vokabular/security-level'])(
    'kennt die Lazy-Route %s',
    (path) => {
      expect(findLazyRoutePreload(path)).toBeDefined();
    },
  );

  it.each(['/', '/katalog/gspp', '/katalog/gspp/kontrolle/x', '/mehr', '/gibt-es-nicht'])(
    'kennt %s nicht (Kernroute, Weiterleitung oder unbekannt)',
    (path) => {
      expect(findLazyRoutePreload(path)).toBeUndefined();
    },
  );

  it('ordnet alle Vokabulardetails demselben Schlüssel zu', () => {
    expect(findLazyRoutePreload('/vokabular/a')?.key).toBe(findLazyRoutePreload('/vokabular/b')?.key);
  });
});
