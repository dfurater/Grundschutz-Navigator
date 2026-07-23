import type { Control } from '@/domain/models';
import { ControlDetailSection } from './ControlDetailSection';
import {
  detailLinkRowClass,
  SubSectionHeading,
} from './ControlVocabularyPrimitives';

export interface ControlHierarchyProps {
  parentControl?: Control;
  childControls?: readonly Control[];
  onNavigateToControl?: (control: Control) => void;
}

export function ControlHierarchy({
  parentControl,
  childControls = [],
  onNavigateToControl,
}: ControlHierarchyProps) {
  if (!parentControl && childControls.length === 0) {
    return null;
  }

  return (
    <ControlDetailSection heading="Hierarchie">
      <div className="space-y-3">
        {parentControl && (
          <div>
            <SubSectionHeading>Übergeordnete Kontrolle</SubSectionHeading>
            <button
              type="button"
              aria-label={`${parentControl.id} ${parentControl.title}`}
              className={detailLinkRowClass}
              onClick={() => onNavigateToControl?.(parentControl)}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-slate-500 shrink-0 group-hover:text-primary-main">
                  {parentControl.id}
                </span>
                <span className="text-sm text-slate-700 leading-snug">
                  {parentControl.title}
                </span>
              </div>
            </button>
          </div>
        )}
        {childControls.length > 0 && (
          <div>
            <SubSectionHeading>Erweiterungen</SubSectionHeading>
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
          </div>
        )}
      </div>
    </ControlDetailSection>
  );
}
