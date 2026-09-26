import type { Control } from '@/domain/models';
import { ControlListLink, detailListClass } from './ControlVocabularyPrimitives';

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

  // GSPP-303 T9: hüllenlos (Teil des Blocks „Zusammenhänge“; die Gruppen-
  // Beschriftung „Erweiterungen" setzt ControlDetail darüber). Liste mit
  // Punkten wie die Gefährdungen (Owner 26.09.2026).
  return (
    <ul className={detailListClass}>
      {childControls.map((childControl) => (
        <li key={childControl.id}>
          <ControlListLink
            control={childControl}
            ariaLabel={`${childControl.id} ${childControl.title}`}
            onNavigateToControl={onNavigateToControl}
          />
        </li>
      ))}
    </ul>
  );
}
