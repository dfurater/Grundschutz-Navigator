import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayerTarget } from '@/hooks/useModalDialog';

/**
 * Hängt Abdunklung und Dialog gemeinsam als eigene Ebene unter `body`, neben
 * `#root` (GSPP-503). Nur so kann `useModalDialog` den Hintergrund inert
 * setzen, ohne den Dialog mitzunehmen; die Abdunklung bleibt dabei klickbar.
 */
export function ModalPortal({ children }: { readonly children: ReactNode }) {
  return createPortal(<div data-modal-layer>{children}</div>, useModalLayerTarget());
}
