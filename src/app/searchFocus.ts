// Navigationszustand für „Suche öffnen und Eingabe fokussieren“. Ohne
// sichtbares Header-Suchfeld (unter 640 px) führt ⌘K/Ctrl+K auf die
// Suchseite; die Seite fokussiert dann ihr eigenes Eingabefeld.

export const FOCUS_SEARCH_STATE = { focusSearch: true } as const;

export function isFocusSearchState(state: unknown): boolean {
  return typeof state === 'object'
    && state !== null
    && (state as { focusSearch?: unknown }).focusSearch === true;
}
