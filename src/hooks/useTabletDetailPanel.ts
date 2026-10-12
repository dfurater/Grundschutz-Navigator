import { useEffect, useRef } from 'react';
import { useGlobalEventListener } from './useGlobalEventListener';
import {
  DETAIL_TITLE_SELECTOR,
  SCOPE_HEADING_SELECTOR,
  controlRowSelector,
} from './useDocumentDetailPage';

/** Inline-Detailpanel des Tablet-Bands für Fokus- und Escape-Abfragen. */
export const TABLET_DETAIL_PANEL_SELECTOR = '[data-tablet-detail-panel]';

export interface UseTabletDetailPanelOptions {
  /** Das Tablet-Band ist aktiv (eigener Scrollbereich, aber kein Desktop). */
  readonly enabled: boolean;
  /** Geöffnete Kontrolle oder `null`, solange nur die Liste sichtbar ist. */
  readonly controlId: string | null;
  readonly onClose: () => void;
}

/**
 * Fokus- und Escape-Vertrag des Tablet-Inline-Detailpanels (GSPP-514): Öffnen
 * und jeder Wechsel zu einer verknüpften Kontrolle fokussieren die
 * Detailüberschrift; Schließen gibt den Fokus an die Zeile zurück, aus der
 * das Detail geöffnet wurde, ersatzweise an die Bereichsüberschrift. Das
 * Panel ist nicht modal — Liste und Filter bleiben daneben bedienbar, daher
 * gibt es keine Fokusfalle, kein `inert` und keine Scroll-Sperre. Escape
 * schließt nur aus dem Panel oder vom `body`, damit Sheets und die
 * Navigationsschublade mit eigenem Escape-Handler Vorrang behalten.
 */
export function useTabletDetailPanel({ enabled, controlId, onClose }: UseTabletDetailPanelOptions): void {
  // Kontrolle, mit der das Panel aus der Liste geöffnet wurde; `null`,
  // solange nur die Liste sichtbar ist.
  const openedRowRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || controlId === null) return;
    openedRowRef.current ??= controlId;
    // Kein Fokusraub aus einem offenen modalen Dialog (etwa einem Sheet über
    // dem Panel): Dort bleibt der Fokus, bis der Dialog schließt.
    if (document.activeElement?.closest('dialog') != null) return;
    document
      .querySelector<HTMLElement>(
        `${TABLET_DETAIL_PANEL_SELECTOR} ${DETAIL_TITLE_SELECTOR}`,
      )
      ?.focus({ preventScroll: true });
  }, [enabled, controlId]);

  // Ohne Abhängigkeiten: läuft nach jedem Commit, bis das Rückkehrziel steht.
  useEffect(() => {
    if (!enabled || controlId !== null || openedRowRef.current === null) return;
    const openedRowId = openedRowRef.current;
    const row = document.querySelector<HTMLElement>(controlRowSelector(openedRowId));
    const returnTarget = row
      ?? document.querySelector<HTMLElement>(SCOPE_HEADING_SELECTOR);
    if (returnTarget === null) return;
    openedRowRef.current = null;
    returnTarget.focus({ preventScroll: true });
  });

  // Schließen in einer anderen Breite beendet die Rückkehrbindung: Dort gibt
  // es keine mobile Zeile, und die nächste Tablet-Öffnung erhält einen neuen
  // Ausgangspunkt.
  useEffect(() => {
    if (enabled || controlId !== null) return;
    openedRowRef.current = null;
  }, [enabled, controlId]);

  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const { target } = event;
    const fromTabletDetail = target === document.body
      || (target instanceof Element && target.closest(TABLET_DETAIL_PANEL_SELECTOR) !== null);
    if (fromTabletDetail) onClose();
  }, enabled && controlId !== null);
}
