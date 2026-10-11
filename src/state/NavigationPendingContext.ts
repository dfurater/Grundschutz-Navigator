import { createContext } from 'react';

/**
 * Die Shell besitzt den Wartezustand der Client-Navigation (GSPP-509):
 * `true`, solange eine Navigation länger als die Schwelle wartet.
 */
export const NavigationPendingContext = createContext(false);
