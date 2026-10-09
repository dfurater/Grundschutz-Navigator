import { useId, useMemo, useRef } from 'react';
import type { Catalog, Control } from '@/domain/models';
import {
  buildChildControlMap,
  buildIncomingLinkMap,
} from '@/domain/controlRelationships';
import { ModalPortal } from '@/components/ModalPortal';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';
import { ControlDetail, type ControlDetailLayout } from './ControlDetail';

interface CatalogDetailPanelProps {
  readonly catalog: Catalog;
  readonly control: Control;
  readonly onClose: () => void;
  readonly onNavigateToControl: (control: Control) => void;
  readonly layout?: ControlDetailLayout;
  readonly titleId?: string;
}

export function CatalogDetailPanel({
  catalog,
  control,
  onClose,
  onNavigateToControl,
  layout,
  titleId,
}: CatalogDetailPanelProps) {
  const incomingLinksByTarget = useMemo(
    () => buildIncomingLinkMap(catalog.controls),
    [catalog.controls],
  );
  const childControlsByParentId = useMemo(
    () => buildChildControlMap(catalog.controls),
    [catalog.controls],
  );

  return (
    <ControlDetail
      control={control}
      controlsById={catalog.controlsById}
      incomingLinks={incomingLinksByTarget.get(control.id) ?? []}
      parentControl={
        control.parentId
          ? catalog.controlsById.get(control.parentId)
          : undefined
      }
      childControls={childControlsByParentId.get(control.id) ?? []}
      onClose={onClose}
      onNavigateToControl={onNavigateToControl}
      layout={layout}
      titleId={titleId}
    />
  );
}

interface CatalogMobileDetailOverlayProps
  extends Omit<CatalogDetailPanelProps, 'control' | 'layout' | 'titleId'> {
  readonly control: Control | null;
  readonly active: boolean;
}

/**
 * Detail als Vollbild-Overlay mit eigenem Scrollbereich für Breiten zwischen
 * `md` und `lg`, in denen die Shell selbst nicht scrollt. Darunter zeigt
 * `CatalogBrowser` das Detail als Seite im Dokumentfluss (GSPP-447).
 * Modaler Dialog außerhalb von `#root`, benannt nach der Detailüberschrift
 * (GSPP-503). Der Dialogknoten bleibt beim Wechsel zu einer verknüpften
 * Kontrolle bestehen, nur der Inhalt wird neu aufgebaut — so bleiben
 * Fokusfalle und Isolation an demselben Element.
 */
export function CatalogMobileDetailOverlay({
  catalog,
  control,
  active,
  onClose,
  onNavigateToControl,
}: CatalogMobileDetailOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useModalDialog(overlayRef, active);
  useScrollLock(active);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') onClose();
  }, active);

  if (!active || !control) return null;

  return (
    <ModalPortal>
      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-0 z-50 lg:hidden flex flex-col bg-[var(--color-surface-raised)]"
      >
        <CatalogDetailPanel
          key={`${catalog.catalogKey}:${control.id}`}
          catalog={catalog}
          control={control}
          onClose={onClose}
          onNavigateToControl={onNavigateToControl}
          titleId={titleId}
        />
      </div>
    </ModalPortal>
  );
}

/**
 * Detail als Seite im Dokumentfluss unterhalb `md` (GSPP-447): kein Overlay,
 * keine Scroll-Sperre, das Dokument scrollt. Scroll-, Fokus- und
 * Escape-Vertrag hält `useDocumentDetailPage` in `CatalogBrowser`.
 */
export function CatalogDetailPage({
  catalog,
  control,
  onClose,
  onNavigateToControl,
}: Omit<CatalogDetailPanelProps, 'layout'>) {
  return (
    <div data-control-detail-page className="flex-1 bg-[var(--color-surface-raised)]">
      <CatalogDetailPanel
        catalog={catalog}
        control={control}
        layout="page"
        onClose={onClose}
        onNavigateToControl={onNavigateToControl}
      />
    </div>
  );
}
