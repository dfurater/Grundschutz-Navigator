import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import type { ProductArea } from '@/app/routes';

export interface AreaSwitchProps {
  readonly active: ProductArea;
  readonly catalogHref: string;
  readonly workspaceHref: string;
  /** Übernimmt den Wechsel, etwa um vorher offene Entwürfe zu speichern. */
  readonly onSelect: (area: ProductArea, href: string) => void;
  /** `header`: dunkle Kopfzeile auf dem Desktop; `drawer`: Kopf der Navigationsschublade. */
  readonly tone: 'header' | 'drawer';
}

const AREAS: readonly { readonly area: ProductArea; readonly label: string }[] = [
  { area: 'katalog', label: 'Katalog' },
  { area: 'informationsverbuende', label: 'Informationsverbünde' },
];

const TONE = {
  header: {
    list: 'flex gap-0.5 rounded-md bg-[var(--header-surface)] p-0.5',
    entry: 'flex',
    item: 'flex min-h-8 items-center rounded px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)]',
    active: 'bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-default)]',
    idle: 'text-[var(--header-text-muted)] hover:text-[var(--header-text)]',
  },
  drawer: {
    list: 'flex min-w-0 flex-1 gap-1',
    entry: 'flex flex-auto',
    item: 'flex min-h-touch items-center justify-center rounded-md px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]',
    active: 'bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-default)]',
    idle: 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]',
  },
} as const;

/** Sichtbarer Wechsel zwischen den beiden Bereichen (ADR-11). */
export function AreaSwitch({ active, catalogHref, workspaceHref, onSelect, tone }: AreaSwitchProps) {
  const style = TONE[tone];
  const hrefOf = (area: ProductArea) => (area === 'katalog' ? catalogHref : workspaceHref);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>, area: ProductArea) => {
    // Modifizierte Klicks öffnen wie jeder Link einen neuen Tab.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(area, hrefOf(area));
  };

  return (
    <nav aria-label="Bereiche" className="min-w-0">
      <ul className={style.list}>
        {AREAS.map(({ area, label }) => (
          <li key={area} className={style.entry}>
            <Link
              to={hrefOf(area)}
              aria-current={area === active ? 'true' : undefined}
              onClick={(event) => handleClick(event, area)}
              className={`${style.item} flex-1 whitespace-nowrap ${area === active ? style.active : style.idle}`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
