import { useEffect } from 'react';

// Referenzgezählt (GSPP-451): Überlappende Sperren dürfen in beliebiger
// Reihenfolge enden. Die erste merkt sich den vorherigen Inline-Wert, erst
// die letzte stellt ihn wieder her — sonst setzte etwa ein später beendetes
// Overlay `hidden` zurück, obwohl kein Overlay mehr offen ist.
// Gesperrt wird `html`, nicht `body`: `html` trägt `overflow-x: hidden`
// (`src/index.css`), daher würde `overflow: hidden` auf `body` den `body` zum
// eigenen Scrollcontainer machen; der `sticky` App-Kopf klebte dann an ihm und
// verschwände mit der Dokumentposition aus dem Bild (GSPP-486).
let activeLocks = 0;
let overflowBeforeLock = '';

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    if (activeLocks === 0) overflowBeforeLock = document.documentElement.style.overflow;
    activeLocks += 1;
    document.documentElement.style.overflow = 'hidden';

    return () => {
      activeLocks -= 1;
      if (activeLocks === 0) document.documentElement.style.overflow = overflowBeforeLock;
    };
  }, [active]);
}
