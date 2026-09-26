import type { Control } from '@/domain/models';
import { detailLinkRowClass } from './ControlVocabularyPrimitives';

export interface ControlHierarchyProps {
  readonly childControls?: readonly Control[];
  readonly onNavigateToControl?: (control: Control) => void;
}

export function ControlHierarchy({
  childControls = [],
  onNavigateToControl,
}: ControlHierarchyProps) {
  if (childControls.length === 0) {
    return null;
  }

  // GSPP-303 T9: hüllenlos (Teil der Zusammenhänge-Zone; die Gruppen-
  // Beschriftung „Erweiterungen" setzt ControlDetail darüber).
  return (
    <div className="space-y-1">
      {childControls.map((childControl) => (
        <button
          key={childControl.id}
          type="button"
          aria-label={`${childControl.id} ${childControl.title}`}
          className={detailLinkRowClass}
          onClick={() => onNavigateToControl?.(childControl)}
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs text-slate-500 shrink-0 group-hover:text-primary-main">
              {childControl.id}
            </span>
            <span className="text-sm text-slate-700 leading-snug">
              {childControl.title}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
