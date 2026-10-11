// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAZY_ROUTE_MODULES } from './lazyRouteModules.mjs';
import { STATIC_PAGE_ROUTES } from './staticPageRoutes';

/*
 * Die Preload-Tabelle des Builds und die `lazy()`-Importe der Routentabelle
 * beschreiben dieselben Seiten (GSPP-506). Dieser Test hält sie paarweise
 * deckungsgleich: Eine neue Lazy-Route ohne Preload-Ziel, ein Preload-Ziel ohne
 * Lazy-Route und vertauschte Zuordnungen fallen hier auf, nicht erst im Browser.
 */

/** Route → literaler Importpfad, gelesen aus den `lazyPage`-Konstanten und den Routeneinträgen. */
function routeImports(source: string): Record<string, string | undefined> {
  const importByPage = new Map(
    [...source.matchAll(/const (\w+) = lazyPage\(\(\) =>\s+import\('(@\/[^']+)'\)/g)]
      .map(([, page, path]) => [page, path]),
  );
  return Object.fromEntries(
    [...source.matchAll(/\{ path: '([^']+)'([^}\n]*)\}/g)]
      .map(([, route, rest]) => [route, /page: (\w+)/.exec(rest)?.[1]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .map(([route, page]) => [route, importByPage.get(page)]),
  );
}

/** Route → erwarteter Importpfad aus einer Tabelle wie `LAZY_ROUTE_MODULES`. */
function expectedRouteImports(table: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(table).map(([route, module]) => [route, `@/${module.replace(/^src\//, '').replace(/\.tsx$/, '')}`]),
  );
}

describe('LAZY_ROUTE_MODULES', () => {
  it('nennt genau die lazy geladenen statischen Routen', () => {
    const lazyPaths = STATIC_PAGE_ROUTES.filter(({ page }) => page !== undefined).map(({ path }) => path);

    expect(Object.keys(LAZY_ROUTE_MODULES).sort()).toEqual([...lazyPaths].sort());
    expect(lazyPaths.length).toBeGreaterThan(0);
  });

  it('verweist auf vorhandene Quelldateien', () => {
    for (const module of Object.values(LAZY_ROUTE_MODULES)) {
      expect(existsSync(resolve(import.meta.dirname, '../..', module)), module).toBe(true);
    }
  });

  it('ordnet jede Lazy-Route genau dem Modul zu, das ihr lazy()-Import lädt', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'staticPageRoutes.tsx'), 'utf8');

    expect(routeImports(source)).toEqual(expectedRouteImports(LAZY_ROUTE_MODULES));
    expect(source.match(/import\('/g)).toHaveLength(Object.keys(LAZY_ROUTE_MODULES).length);
  });

  it('erkennt vertauschte Zuordnungen', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'staticPageRoutes.tsx'), 'utf8');
    const swapped = {
      ...LAZY_ROUTE_MODULES,
      '/suche': LAZY_ROUTE_MODULES['/about'],
      '/about': LAZY_ROUTE_MODULES['/suche'],
    };

    expect(routeImports(source)).not.toEqual(expectedRouteImports(swapped));
  });
});
