import { DESKTOP_QUERY, OWN_SCROLL_AREA_QUERY } from '@/hooks/breakpointQueries';

/**
 * Gerät für Komponententests der Breakpoint-Abos (GSPP-523): jsdom wertet
 * keine Media Queries aus. Das Modell spiegelt `breakpointQueries.ts`; ob die
 * echten Abfragen und die CSS-Regeln dasselbe entscheiden, prüfen die
 * Browser-Tests in Chromium (`tabletLayout.browser.test.ts`).
 */
export interface DeviceProfile {
  readonly label: string;
  /** Viewportbreite in CSS-px bei 16 px Standardschrift. */
  readonly width: number;
  /** Touch als Eingabemöglichkeit (`any-pointer: coarse`), sonst nur Maus. */
  readonly touch: boolean;
}

const REM = 16;

export const IPAD_MINI_PORTRAIT: DeviceProfile = { label: 'iPad mini, Hochformat', width: 744, touch: true };
export const IPAD_PRO_PORTRAIT: DeviceProfile = { label: 'iPad Pro 13", Hochformat', width: 1032, touch: true };
export const IPAD_MINI_LANDSCAPE: DeviceProfile = { label: 'iPad mini, Querformat', width: 1133, touch: true };
export const IPAD_PRO_LANDSCAPE: DeviceProfile = { label: 'iPad Pro 13", Querformat', width: 1376, touch: true };
export const NARROW_MOUSE_WINDOW: DeviceProfile = { label: 'schmales Mausfenster', width: 900, touch: false };
export const PHONE_PORTRAIT: DeviceProfile = { label: 'Smartphone, Hochformat', width: 390, touch: true };
export const DESKTOP_MOUSE: DeviceProfile = { label: 'Desktop mit Maus', width: 1366, touch: false };

export const TABLET_PROFILES = [
  IPAD_MINI_PORTRAIT,
  IPAD_PRO_PORTRAIT,
  IPAD_MINI_LANDSCAPE,
  IPAD_PRO_LANDSCAPE,
  NARROW_MOUSE_WINDOW,
] as const;

/** Auswertung der Abfragen, die `useMediaQuery` in der App stellt. */
export function matchesDeviceQuery(query: string, { width, touch }: DeviceProfile): boolean {
  if (query === OWN_SCROLL_AREA_QUERY) return width >= 46.5 * REM;
  if (query === DESKTOP_QUERY) return width >= 64 * REM && !touch;
  return false;
}
