import { defineBrowserCommand } from '@vitest/browser-playwright';

/** Überschreibt CSS-env-Insetwerte in Chromium; liefert keinen iPhone-Gerätenachweis. */
export const setBrowserSafeArea = defineBrowserCommand<[bottom?: number]>(
  async ({ page }, bottom = 0) => {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom } });
    } finally {
      await session.detach();
    }
  },
);
