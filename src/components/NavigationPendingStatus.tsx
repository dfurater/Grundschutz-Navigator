import { useContext } from 'react';
import { NavigationPendingContext } from '@/state/NavigationPendingContext';

/**
 * Dauerhaft gemounteter Statusbereich (`<output>`, implizite Rolle `status`)
 * mit „Seite wird geladen…“, solange `NavigationPendingContext` `true` meldet.
 * Er fängt keine Zeiger ab; `className` bestimmt nur die Lage.
 */
export function NavigationPendingStatus({ className }: { readonly className: string }) {
  const pending = useContext(NavigationPendingContext);
  return (
    <output className={`pointer-events-none -translate-x-1/2 ${className}`}>
      {pending && (
        <span className="flex items-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] shadow-[var(--shadow-overlay)]">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-border-default)] border-t-[var(--color-primary-main)] motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span>Seite wird geladen…</span>
        </span>
      )}
    </output>
  );
}

/**
 * Statusbereich innerhalb eines modalen Dialogs. Bei offenem Dialog ist der
 * Hinweis der Shell inert und liegt unter dem Dialog; ein Statusbereich
 * außerhalb eines `aria-modal`-Dialogs bliebe zudem ungewiss angesagt. Er
 * schwebt oben mittig über dem Dialoginhalt.
 */
export function DialogNavigationStatus() {
  return <NavigationPendingStatus className="absolute left-1/2 top-2 z-10" />;
}
