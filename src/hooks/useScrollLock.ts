import { useEffect } from 'react';

// Nicht referenzgezählt: Überlappende Sperren müssen in umgekehrter Reihenfolge
// enden. Hebt die zuerst gesetzte zuerst auf, stellt sie den Scroll wieder her,
// während die spätere noch aktiv ist.
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
