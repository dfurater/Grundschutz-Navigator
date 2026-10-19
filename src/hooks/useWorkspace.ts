import { useContext } from 'react';
import { WorkspaceContext, type WorkspaceContextValue } from '@/state/WorkspaceContext';

/** Zustand des Bereichs Informationsverbünde; außerhalb eines `WorkspaceProvider` bleibt der Speicher geschlossen. */
export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}
