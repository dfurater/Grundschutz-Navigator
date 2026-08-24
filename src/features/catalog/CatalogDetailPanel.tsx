import { useMemo, useRef } from 'react';
import type { Catalog, Control } from '@/domain/models';
import {
  buildChildControlMap,
  buildIncomingLinkMap,
} from '@/domain/controlRelationships';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useScrollLock } from '@/hooks/useScrollLock';
import { ControlDetail } from './ControlDetail';

interface CatalogDetailPanelProps {
  readonly catalog: Catalog;
  readonly control: Control;
  readonly onClose: () => void;
  readonly onNavigateToControl: (control: Control) => void;
}

export function CatalogDetailPanel({
  catalog,
  control,
  onClose,
  onNavigateToControl,
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
    />
  );
}

interface CatalogMobileDetailOverlayProps
  extends Omit<CatalogDetailPanelProps, 'control'> {
  readonly control: Control | null;
  readonly active: boolean;
}

export function CatalogMobileDetailOverlay({
  catalog,
  control,
  active,
  onClose,
  onNavigateToControl,
}: CatalogMobileDetailOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useFocusTrap(overlayRef, active);
  useScrollLock(active);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') onClose();
  }, active);

  if (!active || !control) return null;

  return (
    <div
      key={`${catalog.catalogKey}:${control.id}`}
      ref={overlayRef}
      className="fixed inset-0 z-50 lg:hidden flex flex-col bg-[var(--color-surface-raised)]"
    >
      <CatalogDetailPanel
        catalog={catalog}
        control={control}
        onClose={onClose}
        onNavigateToControl={onNavigateToControl}
      />
    </div>
  );
}
