import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { IconSearch, IconShield, IconMenu } from './icons';


export interface HeaderBarProps {
  onSearch?: (term: string) => void;
  onMenuToggle?: () => void;
  className?: string;
}

export function HeaderBar({
  onSearch,
  onMenuToggle,
  className = '',
}: HeaderBarProps) {
  const [searchValue, setSearchValue] = useState('');
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSearch) {
      onSearch(searchValue.trim());
    }
  };

  return (
    <header
      role="banner"
      className={`header-reference-theme sticky top-0 z-30 grid h-14 shrink-0 grid-cols-[1fr_minmax(0,36rem)_1fr] items-center px-4 ${className}`}
      data-testid="header-bar"
    >
      {/* Hamburger + Brand — grouped as one visual unit */}
      <div className="flex items-center justify-self-start shrink-0">
        {onMenuToggle && (
          <button
            type="button"
            className="mr-2 rounded p-2 text-[var(--header-text-muted)] transition-colors hover:text-[var(--header-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)] md:hidden"
            onClick={onMenuToggle}
            aria-label="Menü öffnen"
          >
            <IconMenu className="w-5 h-5" />
          </button>
        )}
        <Link
          to="/"
          className="group flex shrink-0 items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)]"
          aria-label="Zur Startseite"
        >
          <IconShield className="h-5 w-5 text-[var(--header-brand-accent)] transition-colors group-hover:text-[var(--header-brand-accent-hover)]" />
          <span className="text-sm font-bold tracking-wide transition-colors group-hover:text-[var(--header-text-hover)] sm:text-base">
            Grundschutz++ Navigator
          </span>
        </Link>
      </div>

      {/* Search */}
      <div className="w-full px-4 sm:px-8 hidden sm:block">
        <div className="relative group">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--header-text-subtle)] transition-colors group-focus-within:text-[var(--header-brand-accent)]" />
          <input
            ref={inputRef}
            type="search"
            placeholder="Suche nach ID, Titel oder Stichwort..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="w-full rounded-md border border-transparent bg-[var(--header-surface)] py-1.5 pl-9 pr-12 text-sm text-[var(--header-text)] outline-none transition-colors placeholder:text-[var(--header-text-subtle)] focus-visible:bg-[var(--header-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)]"
            aria-label="Katalog durchsuchen"
            data-testid="header-search"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
            <kbd className="shortcut-hint-text rounded bg-[var(--header-surface-hover)] px-1.5 py-0.5 font-mono text-[var(--header-text-muted)]">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </div>
        </div>
      </div>

    </header>
  );
}
