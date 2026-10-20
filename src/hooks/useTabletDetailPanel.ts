import { useEffect, useRef } from 'react';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import {
  DETAIL_TITLE_SELECTOR,
  SCOPE_HEADING_SELECTOR,
  controlRowSelector,
} from '@/hooks/useDocumentDetailPage';

/** Inline-Detailpanel der Tablet-Ansicht für Fokus- und Escape-Abfragen. */
export const TABLET_DETAIL_PANEL_SELECTOR = '[data-tablet-detail-panel]';

export interface UseTabletDetailPanelOptions {
  /** Die Tablet-Ansicht ist aktiv (eigener Scrollbereich, aber kein Desktop). */
  readonly enabled: boolean;
  /** Geöffnete Kontrolle oder `null`, solange nur die Liste sichtbar ist. */
  readonly controlId: string | null;
  /** Listenbereich der zuletzt sichtbaren Liste (Katalog und Thema bzw. Praktik). */
  readonly scopeKey: string;
  /** Die Liste ist gerendert, nicht Lade-, Fehler- oder Nicht-gefunden-Ansicht. */
  readonly listReady: boolean;
  readonly onClose: () => void;
  /** Eine gefensterte Liste rendert und fokussiert ein fehlendes Rückkehrziel. */
  readonly onRestoreRowFocus?: (controlId: string) => boolean;
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
export function useTabletDetailPanel({ enabled, controlId, scopeKey, listReady, onClose, onRestoreRowFocus }: UseTabletDetailPanelOptions): void {
  // Öffnungssitzung: Zeile und Bereich, aus denen das Panel geöffnet wurde;
  // `null`, solange nur die Liste sichtbar ist.
  const sessionRef = useRef<{ rowControlId: string; scopeKey: string | null } | null>(null);
  const prevControlIdRef = useRef<string | null>(null);
  // Bereich der zuletzt sichtbaren Liste; `null` nach einem Direktaufruf.
  const listScopeKeyRef = useRef<string | null>(null);

  // Zuerst deklariert, damit der Öffnungseffekt im selben Commit noch den
  // Listenbereich vor der Navigation liest. Der Bereich wird in jeder Breite
  // gemerkt, solange die Liste sichtbar ist — auch unterhalb von `md` und auf
  // dem Desktop, damit ein Tablet-Eintritt mit offenem Detail den aktuellen
  // Stand findet.
  useEffect(() => {
    if (controlId === null && listReady) {
      listScopeKeyRef.current = scopeKey;
    }
  }, [controlId, scopeKey, listReady]);

  useEffect(() => {
    const prevControlId = prevControlIdRef.current;
    prevControlIdRef.current = controlId;
    if (controlId === null) return;
    // Eine frische Öffnung beginnt eine neue Sitzung; der Wechsel zu einer
    // verknüpften Kontrolle behält die auslösende Zeile. Die Bindung entsteht
    // in jeder Breite, damit beim Tablet-Eintritt nach einem Querverweis die
    // ursprüngliche Zeile erhalten bleibt. Maßgeblich ist der Bereich der
    // zuletzt sichtbaren Liste, nicht das Thema der geöffneten Kontrolle.
    if (prevControlId === null) {
      sessionRef.current = { rowControlId: controlId, scopeKey: listScopeKeyRef.current };
    }
    if (!enabled) return;
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
  // nicht bedienbar ist oder den Fokus nicht angenommen hat. Neuer bedienbarer
  // Fokus außerhalb eines Dialogs beendet die Sitzung ebenfalls. Die Zeile gilt
  // katalogweit: Control-IDs sind je Katalog eindeutig (`controlsById`), nur
  // bei einem Katalogwechsel geht der Fokus ersatzweise an die
  // Bereichsüberschrift.
  useEffect(() => {
    if (!enabled || controlId !== null) return;
    const session = sessionRef.current;
    if (session === null || !listReady) return;
    if (document.activeElement?.closest('dialog') != null) return;
    const sessionCatalog = session.scopeKey?.split(':')[0] ?? null;
    const currentCatalog = scopeKey.split(':')[0];
    const row = sessionCatalog === null || sessionCatalog === currentCatalog
      ? document.querySelector<HTMLElement>(controlRowSelector(session.rowControlId))
      : null;
    if (row === null && (sessionCatalog === null || sessionCatalog === currentCatalog)
      && onRestoreRowFocus?.(session.rowControlId)) {
      sessionRef.current = null;
      return;
    }
    const returnTarget = row
      ?? document.querySelector<HTMLElement>(SCOPE_HEADING_SELECTOR);
    if (returnTarget?.closest('[hidden],[inert]') !== null) {
      return;
    }
    returnTarget.focus({ preventScroll: true });
    if (document.activeElement !== returnTarget) return;
    sessionRef.current = null;
    // Zurück in den sichtbaren Listenbereich holen, ohne das Dokument zu
    // bewegen: Die Zeile kann beim Schließen herausgescrollt sein.
    if (row !== null && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  });

  // Auch ohne React-Render beendet neuer Fokus außerhalb eines Dialogs den
  // blockierten Rückkehrauftrag. Spätere Commits dürfen ihn nicht wiederholen.
  useGlobalEventListener('document', 'focusin', (event) => {
    const { target } = event;
    if (target instanceof HTMLElement && target !== document.body
      && target.closest('dialog,[hidden],[inert]') === null) {
      sessionRef.current = null;
    }
  }, enabled && controlId === null);

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
