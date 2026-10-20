import type { ReactNode, RefCallback } from 'react';
import { AreaSwitch } from '@/components/AreaSwitch';
import { ScopeSwitcher } from '@/components/ScopeSwitcher';
import type { ScopeSwitcherItem } from '@/components/ScopeSwitcher';
import { TreeNav } from '@/components/TreeNav';
import type { TreeItem } from '@/components/TreeNav';
import { IconX } from '@/components/icons';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type { ProductArea } from '@/app/routes';
import { StationSidebar, type StationSelection } from '@/features/workspace/StationSidebar';
import type { WorkspaceDocumentView } from '@/state/workspaceVerbundView';

export interface ShellSidebarProps {
  readonly area: ProductArea;
  readonly persistent: boolean;
  readonly catalogHref: string;
  readonly workspaceHref: string;
  readonly onSelectArea: (href: string) => void;
  readonly onClose: () => void;
  /** Einklappen auf dem Desktop. */
  readonly collapseButton: ReactNode;
  readonly catalog: {
    readonly items: readonly ScopeSwitcherItem<CatalogKey>[];
    readonly activeKey: CatalogKey;
    readonly treeItems: TreeItem[];
    readonly selectedId?: string;
    readonly loading: boolean;
    readonly error: string | null;
    readonly onTreeSelect: (id: string) => void;
  };
  readonly treeScrollRef: RefCallback<HTMLDivElement>;
  readonly workspace: {
    readonly verbundId: string | null;
    readonly active: StationSelection | null;
    readonly documents?: readonly WorkspaceDocumentView[];
  };
}

/**
 * Inhalt der Seitenleiste bzw. Navigationsschublade (GSPP-577). Außerhalb des
 * Desktops trägt die Schublade oben den Bereichswechsel samt Schließen; darunter
 * folgt im Katalogbereich der Katalog-Explorer, im Bereich Informationsverbünde
 * die Stationen des geöffneten Verbunds.
 */
export function ShellSidebar({
  area, persistent, catalogHref, workspaceHref, onSelectArea, onClose, collapseButton, catalog, treeScrollRef, workspace,
}: ShellSidebarProps) {
  const trailing = persistent ? collapseButton : undefined;
  return (
    <>
      {!persistent && (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border-default)] py-1 pl-2 pr-1">
          <AreaSwitch
            active={area}
            catalogHref={catalogHref}
            workspaceHref={workspaceHref}
            onSelect={onSelectArea}
            tone="drawer"
          />
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
            aria-label="Menü schließen"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {area === 'katalog' && (
        <>
          {/* Kontextwahl als Kopf; auf dem Desktop mit Einklappen */}
          <ScopeSwitcher
            label="Katalog"
            items={catalog.items}
            activeKey={catalog.activeKey}
            onItemActivate={onClose}
            trailing={trailing}
          />
          <div ref={treeScrollRef} className="flex-1 overflow-y-auto py-2">
            {catalog.loading && (
              <div className="px-4 py-8 text-center">
                <div className="inline-block w-5 h-5 border-2 border-slate-300 border-t-primary-main rounded-full animate-spin" />
                <p className="text-xs text-slate-500 mt-2">Katalog wird geladen…</p>
              </div>
            )}
            {catalog.error && (
              <div className="px-4 py-4 text-center">
                <p className="text-xs text-red-600 font-medium">Fehler</p>
                <p className="text-xs text-[var(--color-danger-text)] mt-1">{catalog.error}</p>
              </div>
            )}
            {!catalog.loading && !catalog.error && catalog.treeItems.length > 0 && (
              <TreeNav
                catalogKey={catalog.activeKey}
                items={catalog.treeItems}
                onSelect={catalog.onTreeSelect}
                selectedId={catalog.selectedId}
              />
            )}
          </div>
        </>
      )}

      {area === 'informationsverbuende' && workspace.verbundId !== null && (
        <StationSidebar
          verbundId={workspace.verbundId}
          active={workspace.active}
          documents={workspace.documents}
          catalogHref={catalogHref}
          onSelectCatalog={onSelectArea}
          trailing={trailing}
        />
      )}
    </>
  );
}
