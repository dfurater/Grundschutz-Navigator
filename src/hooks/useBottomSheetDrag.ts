import { useEffect, type RefObject } from 'react';

interface BottomSheetDragOptions {
  active?: boolean;
  sheetRef: RefObject<HTMLElement | null>;
  backdropRef: RefObject<HTMLElement | null>;
  handleRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  dismissThresholdPx?: number;
  dismissVelocity?: number;
}

const TRANSITION = 'var(--duration-normal) var(--easing-default)';

export function useBottomSheetDrag({
  active = true,
  sheetRef,
  backdropRef,
  handleRef,
  onDismiss,
  dismissThresholdPx,
  dismissVelocity = 400,
}: BottomSheetDragOptions) {
  useEffect(() => {
    // Bewusst nur am Drag-Handle kleben: Die Geste startet ausschließlich dort,
    // der Rest des Sheets (Inhalte, Buttons, Scrollen) bleibt unangetastet.
    const handle = handleRef.current;
    const sheet = sheetRef.current;
    if (!active || !handle || !sheet) return;

    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let delta = 0;
    let dismissTimer: number | undefined;

    const onTouchStart = (event: TouchEvent) => {
      startY = event.touches[0].clientY;
      lastY = startY;
      lastTime = Date.now();
      velocity = 0;
      delta = 0;
      sheet.style.transition = 'none';
    };

    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      const currentY = event.touches[0].clientY;
      const now = Date.now();
      delta = currentY - startY;
      const elapsed = now - lastTime;
      if (elapsed > 0) velocity = ((currentY - lastY) / elapsed) * 1000;
      lastY = currentY;
      lastTime = now;
      // Rubber-Banding: Nach unten folgt das Sheet dem Finger 1:1, nach oben
      // federt es stark gedämpft zurück – das Overshoot signalisiert das
      // feststehende obere Ende, statt hart anzuschlagen.
      sheet.style.transform = `translateY(${delta > 0 ? delta : delta * 0.12}px)`;
      const backdrop = backdropRef.current;
      if (backdrop) {
        const fade = delta > 0 ? Math.min(delta / sheet.offsetHeight, 1) : 0;
        backdrop.style.opacity = String(Math.max(0, 0.3 * (1 - fade)));
      }
    };

    const snapBack = () => {
      sheet.style.transition = `transform ${TRANSITION}`;
      sheet.style.transform = '';
      const backdrop = backdropRef.current;
      if (backdrop) {
        backdrop.style.transition = `opacity ${TRANSITION}`;
        backdrop.style.opacity = '0.3';
      }
    };

    const onTouchEnd = () => {
      const height = sheet.offsetHeight;
      const threshold = dismissThresholdPx ?? height * 0.3;
      const dismiss = (velocity > dismissVelocity && delta > 20) || delta > threshold;
      if (dismiss) {
        sheet.style.transition = `transform ${TRANSITION}`;
        sheet.style.transform = `translateY(${height}px)`;
        const backdrop = backdropRef.current;
        if (backdrop) {
          backdrop.style.transition = `opacity ${TRANSITION}`;
          backdrop.style.opacity = '0';
        }
        // Erst nach der kurzen Abschluss-Animation entlassen, damit das Sheet
        // sichtbar aus dem Viewport fährt, bevor die UI es entfernt.
        dismissTimer = window.setTimeout(onDismiss, 200);
      } else {
        snapBack();
      }
    };

    // Bricht Browser/OS die Geste ab (Systemgeste, App-Wechsel, Scroll-/Zoom-Übernahme),
    // wird die Geste ohne touchend beendet – Sheet und Backdrop müssen dennoch in den
    // Ausgangszustand zurückfedern und der Gesten-Zustand sauber zurückgesetzt werden.
    const onTouchCancel = () => {
      velocity = 0;
      delta = 0;
      snapBack();
    };

    // touchmove ist absichtlich nicht-passiv ({ passive: false }): Nur so darf
    // preventDefault im Handler das Browser-Scrollen/Pull-to-refresh während
    // des Ziehens zuverlässig unterdrücken.
    handle.addEventListener('touchstart', onTouchStart, { passive: true });
    handle.addEventListener('touchmove', onTouchMove, { passive: false });
    handle.addEventListener('touchend', onTouchEnd, { passive: true });
    handle.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      handle.removeEventListener('touchstart', onTouchStart);
      handle.removeEventListener('touchmove', onTouchMove);
      handle.removeEventListener('touchend', onTouchEnd);
      handle.removeEventListener('touchcancel', onTouchCancel);
      // Der Dismiss-Timer gehört zur aktiven Hook-Instanz: Nach dem Unmount
      // darf onDismiss nicht mehr feuern, sonst würde eine bereits entfernte
      // Sheet-UI nachträglich geschlossen. Ein abgelaufener Timer verträgt
      // das clearTimeout ebenfalls.
      if (dismissTimer !== undefined) window.clearTimeout(dismissTimer);
    };
  }, [active, backdropRef, dismissThresholdPx, dismissVelocity, handleRef, onDismiss, sheetRef]);
}
