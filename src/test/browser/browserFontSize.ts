import { defineBrowserCommand } from '@vitest/browser-playwright';
import type { CDPSession, Page } from 'playwright';

/**
 * Browser-Standardschrift für die Browser-Prüfungen der rem-Grenzen
 * (GSPP-495, GSPP-496). `rem` in Media Queries hängt an der Standardschrift
 * des Browsers, nicht an `font-size` von `html`; nur `Page.setFontSizes`
 * stellt sie wie eine Nutzereinstellung ein. Ohne Größe gilt wieder Chromiums
 * Vorgabe von 16 px.
 */

const DEFAULT_FONT_SIZE = 16;

const sessions = new WeakMap<Page, Promise<CDPSession>>();

function fontSession(page: Page) {
  let session = sessions.get(page);
  if (!session) {
    session = page.context().newCDPSession(page);
    sessions.set(page, session);
  }
  return session;
}

export const setBrowserFontSize = defineBrowserCommand<[standard?: number]>(
  async ({ page }, standard = DEFAULT_FONT_SIZE) => {
    const session = await fontSession(page);
    await session.send('Page.setFontSizes', { fontSizes: { standard } });
  },
);
