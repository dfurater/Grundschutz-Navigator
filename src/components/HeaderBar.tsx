import { useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { FOCUS_SEARCH_STATE } from '@/app/searchFocus';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { IconSearch, IconShield, IconMenu } from './icons';


export interface HeaderBarProps {
  readonly onSearch?: (term: string) => void;
  readonly onMenuToggle?: () => void;
  readonly menuExpanded?: boolean;
  readonly menuControls?: string;
  readonly menuButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly className?: string;
}

const TEXT_INPUT_TYPES = new Set([
  'date',
  'datetime-local',
  'email',
  'month',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'time',
  'url',
  'week',
]);

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  const input = target.closest('input');
  if (input instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(input.type)) return true;

  // Selects support keyboard type-ahead and should retain their native interaction.
  if (target.closest('textarea, select')) return true;

  const contentEditable = target.closest('[contenteditable]');
  return contentEditable !== null
    && contentEditable.getAttribute('contenteditable')?.toLowerCase() !== 'false';
}

export function HeaderBar({
  onSearch,
  onMenuToggle,
  menuExpanded = false,
  menuControls,
  menuButtonRef,
  className = '',
}: HeaderBarProps) {
  const [searchValue, setSearchValue] = useState('');
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useGlobalEventListener('document', 'keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'k') return;
    if (event.target !== inputRef.current && isEditableTarget(event.target)) return;

    event.preventDefault();
    // Unter 640 px ist das Feld ausgeblendet; dann führt das Kürzel wie die Lupe
    // auf die Suchseite und fokussiert dort die Eingabe. Auf der Suchseite bleibt
    // die laufende Anfrage stehen, und der Verlauf erhält keinen zweiten Eintrag.
    if (inputRef.current?.checkVisibility?.() === false) {
      const onSearchPage = location.pathname === '/suche';
      void navigate(
        { pathname: '/suche', search: onSearchPage ? location.search : '' },
        { state: FOCUS_SEARCH_STATE, replace: onSearchPage },
      );
      return;
    }
    inputRef.current?.focus();
  });

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSearch) {
      onSearch(searchValue.trim());
    }
  };

  return (
    <header
      role="banner"
      data-sticky-header
      className={`header-reference-theme sticky top-0 z-30 grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 sm:grid-cols-[max-content_minmax(0,36rem)] sm:gap-0 xl:grid-cols-[1fr_minmax(0,36rem)_1fr] ${className}`}
      data-testid="header-bar"
    >
      {/* Hamburger + Brand — grouped as one visual unit */}
      <div className="flex min-w-0 items-center">
        {onMenuToggle && (
          <button
            type="button"
            className="-ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--header-text-muted)] transition-colors hover:text-[var(--header-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)] md:hidden"
            ref={menuButtonRef}
            onClick={onMenuToggle}
            aria-expanded={menuExpanded}
            aria-controls={menuControls}
            aria-label="Menü öffnen"
          >
            <IconMenu className="w-5 h-5" />
          </button>
        )}
        <Link
          to="/"
          className="group flex min-h-11 min-w-0 items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)]"
        >
          <IconShield className="h-5 w-5 shrink-0 text-[var(--header-brand-accent)] transition-colors group-hover:text-[var(--header-brand-accent-hover)]" />
          <span className="min-w-0 whitespace-nowrap text-sm font-bold leading-tight tracking-wide transition-colors group-hover:text-[var(--header-text-hover)] sm:text-base">
            Grundschutz++ Navigator
          </span>
        </Link>
      </div>

      {/* Search */}
      <div className="hidden w-full px-4 sm:block lg:px-8">
        <div className="relative group">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--header-text-subtle)] transition-colors group-focus-within:text-[var(--header-brand-accent)]" />
          <input
            ref={inputRef}
            type="search"
            placeholder="Suche nach ID, Titel oder Stichwort..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="w-full rounded-md border border-transparent bg-[var(--header-surface)] py-1.5 pl-9 pr-3 text-sm text-[var(--header-text)] outline-none transition-colors placeholder:text-[var(--header-text-subtle)] focus-visible:bg-[var(--header-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)] lg:pr-12"
            aria-label="Katalog durchsuchen"
            data-testid="header-search"
          />
          <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 gap-1 lg:flex">
            <kbd className="shortcut-hint-text rounded bg-[var(--header-surface-hover)] px-1.5 py-0.5 font-mono text-[var(--header-text-muted)]">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </div>
        </div>
      </div>

      {/* Unter 640 px steht die Suche als Lupe im Header; das Feld folgt erst ab sm. */}
      <Link
        to="/suche"
        className="-mr-3 flex h-11 w-11 shrink-0 items-center justify-center justify-self-end rounded text-[var(--header-text-muted)] transition-colors hover:text-[var(--header-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)] sm:hidden"
        aria-label="Suche"
      >
        <IconSearch className="h-5 w-5" />
      </Link>
    </header>
  );
}
