import { useMemo } from 'react';
import type { Catalog, Control } from '@/domain/models';
import {
  buildChildControlMap,
  buildIncomingLinkMap,
} from '@/domain/controlRelationships';
import { ControlDetail, type ControlDetailLayout } from './ControlDetail';

interface CatalogDetailPanelProps {
  readonly catalog: Catalog;
  readonly control: Control;
  readonly onClose: () => void;
  readonly onNavigateToControl: (control: Control) => void;
  readonly layout?: ControlDetailLayout;
}

export function CatalogDetailPanel({
  catalog,
  control,
  onClose,
  onNavigateToControl,
  layout,
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
    />
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
