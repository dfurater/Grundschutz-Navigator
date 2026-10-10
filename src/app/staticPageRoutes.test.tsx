import { describe, expect, it, vi } from 'vitest';
import { STATIC_PAGE_ROUTES, preloadStaticPage } from './staticPageRoutes';

const loaded = vi.hoisted(() => ({ imprint: 0 }));
vi.mock('@/features/pages/ImpressumPage', () => {
  loaded.imprint += 1;
  return { ImpressumPage: () => <h1>Impressum</h1> };
});

describe('preloadStaticPage', () => {
  it('führt Lazy-Routen mit einem Seitenmodul, die Startseite ohne', () => {
    const withPreload = STATIC_PAGE_ROUTES.filter(({ page }) => page).map(({ path }) => path);

    expect(withPreload).toEqual(['/suche', '/vokabular', '/about', '/datenschutz', '/impressum', '/lizenzen']);
  });

  it.each(['/', '/katalog/gspp', '/gibt-es-nicht', '/vokabular/security-level'])(
    'erledigt %s sofort, ohne Chunk',
    async (path) => {
      await expect(preloadStaticPage(path)).resolves.toBeUndefined();
    },
  );

  it('lädt den Chunk der Einstiegsseite, auch mit abschließendem Schrägstrich', async () => {
    await preloadStaticPage('/impressum/');

    expect(loaded.imprint).toBe(1);
  });
});
