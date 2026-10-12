import { defineBrowserCommand } from '@vitest/browser-playwright';
import type { CDPSession, Page } from 'playwright';

/**
 * Echte Touch-Eingaben für die Browser-Prüfungen der mobilen Schublade
 * (GSPP-494). `dispatchEvent` mit selbst gebauten `TouchEvent`s erreicht nur
 * die Handler; ob Chromium dabei scrollt oder die Berührung mit `touchcancel`
 * abbricht, entscheidet erst der Eingabepfad des Browsers. `Input.dispatchTouchEvent`
 * speist ihn wie ein Finger. Koordinaten gelten für die Seite des Browsers,
 * nicht für den Testframe.
 */

export type BrowserTouchKind = 'start' | 'move' | 'end' | 'reset';

const sessions = new WeakMap<Page, Promise<CDPSession>>();

function touchSession(page: Page) {
  let session = sessions.get(page);
  if (!session) {
    session = (async () => {
      const created = await page.context().newCDPSession(page);
      await created.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      return created;
    })();
    sessions.set(page, session);
  }
  return session;
}

const TOUCH_TYPES = { start: 'touchStart', move: 'touchMove', end: 'touchEnd' } as const;

async function resetTouchSession(page: Page) {
  const session = await touchSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  sessions.delete(page);
}

/**
 * Schaltet Touch als Eingabemöglichkeit ein oder aus (GSPP-523). Mit aktiver
 * Touch-Emulation melden `pointer` und `any-pointer` `coarse`, `hover` und
 * `any-hover` `none`; ausgeschaltet gelten wieder `fine` und `hover`, wie bei
 * einem Gerät mit Maus.
 */
export const setBrowserCoarsePointer = defineBrowserCommand<[coarse: boolean]>(
  async ({ page }, coarse) => {
    if (coarse) {
      await touchSession(page);
    } else {
      await resetTouchSession(page);
    }
  },
);

export const dispatchBrowserTouch = defineBrowserCommand<[kind: BrowserTouchKind, x?: number, y?: number]>(
  async ({ page }, kind, x = 0, y = 0) => {
    if (kind === 'reset') {
      await resetTouchSession(page);
      return;
    }
    const session = await touchSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: TOUCH_TYPES[kind],
      touchPoints: kind === 'end' ? [] : [{ x, y, id: 1 }],
    });
  },
);
