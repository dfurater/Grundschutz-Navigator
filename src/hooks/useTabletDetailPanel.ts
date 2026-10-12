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
  /** Listenbereich der zuletzt sichtbaren Liste (Katalog und Thema bzw. Praktik). */
  readonly scopeKey: string;
  /** Die Liste ist gerendert, nicht Lade-, Fehler- oder Nicht-gefunden-Ansicht. */
  readonly listReady: boolean;
  readonly onClose: () => void;
}

/**
 * Fokus- und Escape-Vertrag des Tablet-Inline-Detailpanels (GSPP-514): Öffnen
 * und jeder Wechsel zu einer verknüpften Kontrolle fokussieren die
 * Detailüberschrift; Schließen gibt den Fokus an die Zeile zurück, mit der
 * das Panel geöffnet wurde — auch nach Wechseln zu verknüpften Kontrollen.
 * Gehört die auslösende Zeile nicht mehr zum sichtbaren Bereich, etwa nach
 * einem Katalogwechsel, geht der Fokus ersatzweise an die Bereichsüberschrift.
 * Das Panel ist nicht modal — Liste und Filter bleiben daneben bedienbar,
 * daher gibt es keine Fokusfalle, kein `inert` und keine Scroll-Sperre. Escape
 * schließt nur aus dem Panel oder vom `body`, damit Sheets und die
 * Navigationsschublade mit eigenem Escape-Handler Vorrang behalten.
 */
export function useTabletDetailPanel({ enabled, controlId, scopeKey, listReady, onClose }: UseTabletDetailPanelOptions): void {
  // Öffnungssitzung: Zeile und Bereich, aus denen das Panel geöffnet wurde;
  // `null`, solange nur die Liste sichtbar ist.
  const sessionRef = useRef<{ rowControlId: string; scopeKey: string | null } | null>(null);
  const prevControlIdRef = useRef<string | null>(null);
  const prevEnabledRef = useRef(false);
  // Bereich der zuletzt sichtbaren Liste; `null` nach einem Direktaufruf.
  const listScopeKeyRef = useRef<string | null>(null);

  // Zuerst deklariert, damit der Öffnungseffekt im selben Commit noch den
  // Listenbereich vor der Navigation liest.
  useEffect(() => {
    if (enabled && controlId === null && listReady) {
      listScopeKeyRef.current = scopeKey;
    }
  }, [enabled, controlId, scopeKey, listReady]);

  useEffect(() => {
    const prevControlId = prevControlIdRef.current;
    const prevEnabled = prevEnabledRef.current;
    prevControlIdRef.current = controlId;
    prevEnabledRef.current = enabled;
    if (!enabled || controlId === null) return;
    // Eine frische Öffnung beginnt eine neue Sitzung; der Wechsel zu einer
    // verknüpften Kontrolle behält die auslösende Zeile. Wer mit geöffnetem
    // Detail ins Tablet-Band wechselt, erhält beim Eintritt ebenfalls eine
    // Bindung, sofern noch keine besteht. Maßgeblich ist der Bereich der
    // zuletzt sichtbaren Liste, nicht das Thema der geöffneten Kontrolle.
    if (prevControlId === null || (sessionRef.current === null && !prevEnabled)) {
      sessionRef.current = { rowControlId: controlId, scopeKey: listScopeKeyRef.current };
    }
    // Kein Fokusraub aus einem offenen modalen Dialog (etwa einem Sheet über
    // dem Panel): Dort bleibt der Fokus, bis der Dialog schließt.
    if (document.activeElement?.closest('dialog') != null) return;
    document
      .querySelector<HTMLElement>(
        `${TABLET_DETAIL_PANEL_SELECTOR} ${DETAIL_TITLE_SELECTOR}`,
      )
      ?.focus({ preventScroll: true });
  }, [enabled, controlId, scopeKey]);

  // Ohne Abhängigkeiten: läuft nach jedem Commit, bis das Rückkehrziel den
  // Fokus übernommen hat. Die Bindung bleibt bestehen, solange das Ziel fehlt,
  // nicht bedienbar ist oder den Fokus nicht angenommen hat — erst dann endet
  // die Sitzung, damit der Fokus nie auf `body` fällt.
  useEffect(() => {
    if (!enabled || controlId !== null) return;
    const session = sessionRef.current;
    if (session === null || !listReady) return;
    const sameScope = session.scopeKey === null || session.scopeKey === scopeKey;
    const row = sameScope
      ? document.querySelector<HTMLElement>(controlRowSelector(session.rowControlId))
      : null;
    const returnTarget = row
      ?? document.querySelector<HTMLElement>(SCOPE_HEADING_SELECTOR);
    if (
      returnTarget === null
      || returnTarget.closest('[hidden],[inert]') !== null
    ) {
      return;
    }
    returnTarget.focus({ preventScroll: true });
    if (document.activeElement !== returnTarget) return;
    sessionRef.current = null;
    // Zurück in den sichtbaren Listenbereich holen, ohne das Dokument zu
    // bewegen: Die Zeile kann beim Schließen herausgescrollt sein.
    row?.scrollIntoView?.({ block: 'nearest' });
  });

  // Schließen in einer anderen Breite beendet die Rückkehrbindung: Dort gibt
  // es keine Tablet-Zeile, und die nächste Tablet-Öffnung erhält einen neuen
  // Ausgangspunkt.
  useEffect(() => {
    if (enabled || controlId !== null) return;
    sessionRef.current = null;
  }, [enabled, controlId]);

  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const { target } = event;
    const fromTabletDetail = target === document.body
      || (target instanceof Element && target.closest(TABLET_DETAIL_PANEL_SELECTOR) !== null);
    if (fromTabletDetail) onClose();
  }, enabled && controlId !== null);
}
