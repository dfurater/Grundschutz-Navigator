import { createContext } from 'react';

/** Die Shell besitzt den Zustand; Toolbars bauen überlagerte Sheets ab (GSPP-450). */
export const MobileNavigationContext = createContext(false);
