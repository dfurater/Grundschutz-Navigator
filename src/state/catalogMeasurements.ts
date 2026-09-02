// =============================================================================
// Browser-Messpunkte des Katalog-Startpfads (GSPP-194)
//
// Die Instrumentierung ist absichtlich fehlertolerant: User Timing macht den
// vorhandenen Ladepfad beobachtbar, darf ihn aber weder verändern noch einen
// OSCAL- oder Netzwerkfehler verdecken.
// =============================================================================

import { useLayoutEffect, useRef, type MutableRefObject } from 'react';

export const CATALOG_LOAD_MEASURES = {
  download: 'gspp:catalog-download',
  jsonParse: 'gspp:catalog-json-parse',
  domainParse: 'gspp:catalog-domain-parse',
  reactRender: 'gspp:catalog-react-render',
} as const;

export interface UserTiming {
  now(): number;
  measure(name: string, options: PerformanceMeasureOptions): unknown;
}

function getUserTiming(): UserTiming | null {
  if (
    typeof performance === 'undefined' ||
    typeof performance.now !== 'function' ||
    typeof performance.measure !== 'function'
  ) {
    return null;
  }

  return performance;
}

function recordDuration(
  name: string,
  startedAt: number | null,
  timing: UserTiming | null,
): void {
  if (timing === null || startedAt === null) return;

  try {
    timing.measure(name, { start: startedAt, end: timing.now() });
  } catch {
    // Reine Instrumentierung: die Produktfunktion bleibt unabhängig davon.
  }
}

/**
 * Misst eine synchrone Ladephase. Der Rückgabewert und jeder Fehler der
 * Operation bleiben unverändert; fehlendes oder fehlerhaftes User Timing wird
 * absichtlich ignoriert.
 */
export function measureCatalogPhase<T>(
  name: string,
  operation: () => T,
  timing: UserTiming | null = getUserTiming(),
): T {
  const startedAt = timing?.now() ?? null;

  try {
    return operation();
  } finally {
    recordDuration(name, startedAt, timing);
  }
}

/** Misst eine asynchrone Ladephase bis ihr Promise erfüllt oder abgelehnt ist. */
export async function measureCatalogAsyncPhase<T>(
  name: string,
  operation: () => Promise<T>,
  timing: UserTiming | null = getUserTiming(),
): Promise<T> {
  const startedAt = timing?.now() ?? null;

  try {
    return await operation();
  } finally {
    recordDuration(name, startedAt, timing);
  }
}

/** Zeichnet eine bereits gemessene Phase bis zum aktuellen Zeitpunkt auf. */
export function recordCatalogPhase(
  name: string,
  startedAt: number | null,
  timing: UserTiming | null = getUserTiming(),
): void {
  recordDuration(name, startedAt, timing);
}

/**
 * Misst den React-Commit des erfolgreichen Einstiegskatalogs. Der Provider
 * setzt den Rückgabe-Ref direkt vor seinem Erfolgs-Dispatch; dieser Effekt
 * läuft danach im Layout-Commit, nicht während Netzwerk oder OSCAL-Parsing.
 */
export function useCatalogReactRenderMeasurement(
  entryCatalogIsVisible: boolean,
): MutableRefObject<number | null> {
  const startedAtRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!entryCatalogIsVisible) return;

    recordCatalogPhase(CATALOG_LOAD_MEASURES.reactRender, startedAtRef.current);
    startedAtRef.current = null;
  }, [entryCatalogIsVisible]);

  return startedAtRef;
}

/** Übernimmt die im Worker gemessene Dauer in die Main-Thread-Timeline. */
export function recordCatalogDuration(
  name: string,
  durationMs: number,
  timing: UserTiming | null = getUserTiming(),
): void {
  if (timing === null || !Number.isFinite(durationMs) || durationMs < 0) return;

  const endedAt = timing.now();
  try {
    timing.measure(name, { start: endedAt - durationMs, end: endedAt });
  } catch {
    // Reine Instrumentierung: die Produktfunktion bleibt unabhängig davon.
  }
}

/** Liefert den aktuellen Zeitstempel nur, wenn User Timing verfügbar ist. */
export function catalogMeasurementNow(): number | null {
  return getUserTiming()?.now() ?? null;
}
