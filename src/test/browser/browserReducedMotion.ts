import { defineBrowserCommand } from '@vitest/browser-playwright';

/**
 * Emuliert `prefers-reduced-motion` für die Kaskadenprüfung der
 * Reduced-Motion-Regel (GSPP-533). Ohne Argument gilt wieder die Vorgabe
 * `no-preference`.
 */
export const setBrowserReducedMotion = defineBrowserCommand<[reduce?: boolean]>(
  async ({ page }, reduce = false) => {
    await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
  },
);
