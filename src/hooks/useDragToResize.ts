import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MouseEventHandler, SetStateAction } from 'react';

export interface UseDragToResizeOptions {
  axis: 'x' | 'y';
  edge: 'start' | 'end';
  min: number;
  max: number;
  initial: number;
}

// Achsenneutraler Vertrag: Der Hook unterstützt horizontale wie vertikale
// Deltas (GSPP-264), deshalb heißt die Größe generisch „size“ statt „width“.
export interface UseDragToResizeResult {
  size: number;
  isResizing: boolean;
  setSize: Dispatch<SetStateAction<number>>;
  startResize: MouseEventHandler<HTMLElement>;
}

interface ActiveListeners {
  mouseMove: (event: MouseEvent) => void;
  mouseUp: () => void;
  windowBlur: () => void;
}

// Globale Exklusivität über alle Hook-Instanzen hinweg (GSPP-258): Es darf zu
// jedem Zeitpunkt höchstens eine Resize-Sitzung aktiv sein. Die Marke hält die
// Stop-Funktion der aktuell aktiven Sitzung; der Start einer neuen Sitzung
// beendet die vorherige damit deterministisch, statt auf parallele
// mousemove-Verarbeitung oder konkurrierende Body-Klassen zu laufen.
let activeGlobalSession: (() => void) | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useDragToResize({
  axis,
  edge,
  min,
  max,
  initial,
}: UseDragToResizeOptions): UseDragToResizeResult {
  const [size, setSize] = useState(() => clamp(initial, min, max));
  const [isResizing, setIsResizing] = useState(false);
  const listenersRef = useRef<ActiveListeners | null>(null);

  // Einzige Aufräumstelle für Listener, Body-Klasse und Resize-State. Wer hier
  // noch registrierte Listener vorfindet, ist zwangsläufig Eigentümer der
  // einen globalen Sitzung (jeder Sitzungsstart beendet die vorige zuerst) –
  // deshalb darf die Exklusivitätsmarke bedingungslos freigegeben werden.
  const stopResize = useCallback((updateState = true) => {
    const listeners = listenersRef.current;
    if (!listeners) return;

    document.removeEventListener('mousemove', listeners.mouseMove);
    document.removeEventListener('mouseup', listeners.mouseUp);
    window.removeEventListener('blur', listeners.windowBlur);
    document.body.classList.remove('is-resizing');
    listenersRef.current = null;
    activeGlobalSession = null;

    if (updateState) {
      setIsResizing(false);
    }
  }, []);

  useEffect(() => () => stopResize(false), [stopResize]);

  const startResize = useCallback<MouseEventHandler<HTMLElement>>((event) => {
    // Resize ausschließlich über die primäre Maustaste: Mittelklick (Autoscroll)
    // und Rechtsklick (Kontextmenü) dürfen keine Sitzung starten.
    if (event.button !== 0) return;

    // Globale Exklusivität: Eine neue Sitzung beendet eine noch laufende
    // vorherige deterministisch – auch die einer anderen Hook-Instanz –,
    // damit höchstens eine Instanz auf mousemove reagiert und sich Instanzen
    // nicht gegenseitig die Body-Klasse wegnehmen.
    event.preventDefault();
    activeGlobalSession?.();

    const startPosition = axis === 'x' ? event.clientX : event.clientY;
    const startSize = size;
    const direction = edge === 'end' ? 1 : -1;

    setIsResizing(true);
    document.body.classList.add('is-resizing');

    const mouseMove = (moveEvent: MouseEvent) => {
      const position = axis === 'x' ? moveEvent.clientX : moveEvent.clientY;
      setSize(clamp(startSize + ((position - startPosition) * direction), min, max));
    };
    const mouseUp = () => stopResize();

    // Verlorene Mausereignisse (Fokusverlust des Fensters, Wechsel in ein
    // anderes Programm) liefern kein mouseup mehr – window.blur beendet die
    // Sitzung daher zusätzlich und idempotent.
    const windowBlur = () => stopResize();

    listenersRef.current = { mouseMove, mouseUp, windowBlur };
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
    window.addEventListener('blur', windowBlur);
    activeGlobalSession = stopResize;
  }, [axis, edge, max, min, stopResize, size]);

  return { size, isResizing, setSize, startResize };
}
