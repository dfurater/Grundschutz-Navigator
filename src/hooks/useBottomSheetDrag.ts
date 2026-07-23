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
  active = true, sheetRef, backdropRef, handleRef, onDismiss, dismissThresholdPx,
  dismissVelocity = 400,
}: BottomSheetDragOptions) {
  useEffect(() => {
    const handle = handleRef.current;
    const sheet = sheetRef.current;
    if (!active || !handle || !sheet) return;
    let startY = 0, lastY = 0, lastTime = 0, velocity = 0, delta = 0;
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
      if (elapsed > 0) velocity = (currentY - lastY) / elapsed * 1000;
      lastY = currentY;
      lastTime = now;
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
    handle.addEventListener('touchstart', onTouchStart, { passive: true });
    handle.addEventListener('touchmove', onTouchMove, { passive: false });
    handle.addEventListener('touchend', onTouchEnd, { passive: true });
    handle.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      handle.removeEventListener('touchstart', onTouchStart);
      handle.removeEventListener('touchmove', onTouchMove);
      handle.removeEventListener('touchend', onTouchEnd);
      handle.removeEventListener('touchcancel', onTouchCancel);
      if (dismissTimer !== undefined) window.clearTimeout(dismissTimer);
    };
  }, [active, backdropRef, dismissThresholdPx, dismissVelocity, handleRef, onDismiss, sheetRef]);
}
