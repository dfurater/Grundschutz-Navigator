import { useContext, useId, useState } from 'react';
import { Button } from '@/components/Button';
import type { CatalogState, Control } from '@/domain/models';
import { addImport, importHrefPointer } from '@/domain/profileImportList';
import { SUPPORTED_CATALOGS, type CatalogKey } from '@/domain/sourceRegistry';
import { ROOT_TYPE_LABELS } from '@/domain/workspaceStations';
import type { BindingTarget, WorkspaceBinding } from '@/domain/workspaceModel';
import { CatalogContext } from '@/state/CatalogContext';
import type { ProfileAnalysis } from '@/state/workspaceProfileAnalysis';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { ImportCard } from '@/features/workspace/profile/ImportCard';
import { SECTION_LABEL } from '@/features/workspace/profile/ProfileMarks';
import { selectableTarget, targetKey, type ImportTargetOption } from '@/features/workspace/profile/useImportTargets';
import type { ProfileEditor } from '@/features/workspace/profile/useProfileEditor';

/** Auswahlliste der Importziele; ein Ziel mit anderer `oscal-version` ist ausgegraut. */
function TargetMenu({ id, options, oscalVersion, onPick }: Readonly<{
  id: string;
  options: readonly ImportTargetOption[];
  oscalVersion: string;
  onPick: (option: ImportTargetOption) => void;
}>) {
  return (
    <fieldset id={id} className="absolute right-0 top-full z-20 mt-1 w-full max-w-md rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-overlay)] py-2 shadow-overlay">
      <legend className={`${SECTION_LABEL} float-left w-full px-4 pb-1`}>Importziel</legend>
      <ul>
        {options.map((option) => {
          const disabled = option.oscalVersion !== oscalVersion || !selectableTarget(option);
          return (
            <li key={option.key}>
              <button
                type="button"
                disabled={disabled}
                className={`flex min-h-touch w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)] disabled:hover:bg-transparent ${FOCUS_RING} focus-visible:ring-inset`}
                onClick={() => onPick(option)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{option.title || ROOT_TYPE_LABELS[option.rootType]}</span>
                  <span className="font-mono text-xs text-[var(--color-text-secondary)]">{option.artifactKey ?? `${ROOT_TYPE_LABELS[option.rootType]} im Verbund`}</span>
                </span>
                <span className="font-mono text-xs text-[var(--color-text-secondary)]">OSCAL {option.oscalVersion}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function catalogDetails(catalogs: CatalogState['catalogs'], target: BindingTarget | undefined): ReadonlyMap<string, Control> | undefined {
  if (target?.kind !== 'class-1') return undefined;
  const entry = SUPPORTED_CATALOGS.find((catalog) => catalog.artifactKey === target.artifactKey);
  return entry ? catalogs.get(entry.catalogKey as CatalogKey)?.catalog?.controlsById : undefined;
}

export function ImportsTab({ editor, analysis, analyzedBindings, options, oscalVersion }: Readonly<{
  editor: ProfileEditor;
  analysis: ProfileAnalysis | null;
  analyzedBindings: readonly WorkspaceBinding[];
  options: readonly ImportTargetOption[];
  oscalVersion: string;
}>) {
  const menuId = useId();
  const { catalogs } = useContext(CatalogContext);
  // `null`: neuer Import; eine Zahl: Zuordnung für den Import an dieser Stelle.
  const [picking, setPicking] = useState<number | null | undefined>(undefined);
  const pick = (option: ImportTargetOption) => {
    const assigning = picking;
    setPicking(undefined);
    if (typeof assigning === 'number') {
      const href = editor.imports.find((entry) => entry.index === assigning)?.href;
      if (href !== undefined) editor.changeWithTarget((source) => ({ source, href, index: assigning }), option.target);
      return;
    }
    editor.changeWithTarget((source) => addImport(source, { resourceUuid: crypto.randomUUID(), title: option.title }), option.target);
  };
  const optionFor = (target: BindingTarget | undefined) => target === undefined ? undefined : options.find((option) => option.key === targetKey(target));

  return (
    <div className="space-y-4">
      <div className="relative flex justify-end">
        <Button
          variant="secondary"
          className="min-h-touch desktop:min-h-0"
          aria-expanded={picking !== undefined}
          aria-controls={menuId}
          onClick={() => setPicking(picking === undefined ? null : undefined)}
        >
          + Import hinzufügen
        </Button>
        {picking !== undefined && <TargetMenu id={menuId} options={options} oscalVersion={oscalVersion} onPick={pick} />}
      </div>
      {editor.imports.map((entry, position) => {
        const target = editor.targetFor(entry);
        const pointer = importHrefPointer(entry.index);
        // Nach dem Entfernen eines Imports gehört der Analyseeintrag an diesem Pointer bis zur nächsten Ableitung einem anderen Ziel.
        const analyzed = analyzedBindings.find((binding) => binding.pointer === pointer && binding.href === entry.href);
        const matches = target !== undefined && analyzed !== undefined && targetKey(analyzed.target) === targetKey(target);
        return (
          <ImportCard
            key={`${entry.index}|${entry.href ?? ''}`}
            entry={entry}
            position={position + 1}
            oscalVersion={oscalVersion}
            target={optionFor(target)}
            edge={analysis?.imports.find((edge) => edge.path === pointer)}
            controls={matches ? analysis?.targets.get(pointer) : undefined}
            details={catalogDetails(catalogs, target)}
            canRemove={editor.imports.length > 1 && !editor.busy}
            onChange={editor.change}
            onRemove={() => editor.removeImportAt(entry.index)}
            onAssign={() => setPicking(entry.index)}
          />
        );
      })}
    </div>
  );
}
