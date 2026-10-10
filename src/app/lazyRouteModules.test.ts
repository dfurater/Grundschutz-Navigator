// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAZY_ROUTE_MODULES } from './lazyRouteModules.mjs';
import { STATIC_PAGE_ROUTES } from './staticPageRoutes';

/*
 * Die Preload-Tabelle des Builds und die `lazy()`-Importe der Routentabelle
 * beschreiben dieselben Seiten (GSPP-506). Dieser Test hält sie deckungsgleich:
 * Eine neue Lazy-Route ohne Preload-Ziel und ein Preload-Ziel ohne Lazy-Route
 * fallen hier auf, nicht erst im Browser.
 */

describe('LAZY_ROUTE_MODULES', () => {
  it('nennt genau die lazy geladenen statischen Routen', () => {
    const lazyPaths = STATIC_PAGE_ROUTES.filter(({ preload }) => preload !== undefined).map(({ path }) => path);

    expect(Object.keys(LAZY_ROUTE_MODULES).sort()).toEqual([...lazyPaths].sort());
    expect(lazyPaths.length).toBeGreaterThan(0);
  });

  it('verweist auf vorhandene Quelldateien', () => {
    for (const module of Object.values(LAZY_ROUTE_MODULES)) {
      expect(existsSync(resolve(import.meta.dirname, '../..', module)), module).toBe(true);
    }
  });

  it('entspricht je Route genau einem literalen import() in staticPageRoutes.tsx', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'staticPageRoutes.tsx'), 'utf8');
    const importedPaths = [...source.matchAll(/import\('(@\/[^']+)'\)/g)].map((match) => match[1]);
    const expected = Object.values(LAZY_ROUTE_MODULES).map(
      (module) => `@/${module.replace(/^src\//, '').replace(/\.tsx$/, '')}`,
    );

    expect(importedPaths.sort()).toEqual(expected.sort());
  });
});
