import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { FOCUS_SEARCH_STATE } from '@/app/searchFocus';
import { dismissModalDialogs } from '@/hooks/useModalDialog';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { IconSearch, IconShield, IconMenu } from './icons';


export interface HeaderBarProps {
  readonly onSearch?: (term: string) => void;
  readonly onMenuToggle?: () => void;
  readonly menuExpanded?: boolean;
  readonly menuControls?: string;
  readonly menuButtonRef?: RefObject<HTMLButtonElement | null>;
  /**
   * Die offene mobile Schublade schiebt den App-Kopf aus dem Bild. Seine
   * Steuerungen außer dem Menübutton sind dann `inert`, damit Tab nicht auf
   * verdeckte Ziele führt.
   */
  readonly obscured?: boolean;
  /**
   * Gibt den App-Kopf frei: Die Shell schließt eine offene Schublade und
   * beendet eine Wischgeste, die den Kopf gerade verschiebt. Das Suchkürzel
   * ruft es bei sichtbarem Feld vor dem Fokussieren auf; ist der Kopf
   * `obscured` oder durch einen Dialog inert, wartet der Fokus auf die Freigabe.
   */
  readonly onUncover?: () => void;
  /** Bereichswechsel links neben der Marke; nur auf dem Desktop, sonst trägt ihn die Schublade. */
  readonly areaSwitch?: ReactNode;
  /** Kontext auf der rechten Seite, etwa der Verbundpfad; nur auf dem Desktop. */
  readonly context?: ReactNode;
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
  obscured = false,
  onUncover,
  areaSwitch,
  context,
  className = '',
}: HeaderBarProps) {
  const [searchValue, setSearchValue] = useState('');
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const focusObserverRef = useRef<MutationObserver | null>(null);

  useEffect(() => () => focusObserverRef.current?.disconnect(), []);

  // Die Isolation endet im Dialog-Cleanup; der Observer läuft danach, auch
  // wenn der Header selbst keinen neuen React-Zustand erhält. Er beobachtet
  // nur die inert-Attribute der Vorfahren und endet mit Fokus oder Unmount.
  const focusSearchWhenOperable = (input: HTMLInputElement) => {
    const focus = () => {
      if (!input.isConnected || input.closest('[inert]')) return;
      focusObserverRef.current?.disconnect();
      focusObserverRef.current = null;
      if (input.checkVisibility?.() ?? input.getClientRects().length > 0) input.focus();
    };
    if (!input.closest('[inert]')) {
      focus();
      return;
    }
    const observer = new MutationObserver(focus);
    focusObserverRef.current = observer;
    for (let ancestor: HTMLElement | null = input; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ['inert'] });
    }
  };

  useGlobalEventListener('document', 'keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'k') return;
    if (event.target !== inputRef.current && isEditableTarget(event.target)) return;

    event.preventDefault();
    focusObserverRef.current?.disconnect();
    focusObserverRef.current = null;
    dismissModalDialogs();
    // Unter 640 px ist das Feld ausgeblendet; dann führt das Kürzel wie die Lupe
    // auf die Suchseite und fokussiert dort die Eingabe. Auf der Suchseite bleibt
    // die laufende Anfrage stehen, und der Verlauf erhält keinen zweiten Eintrag.
    const input = inputRef.current;
    const visible = input && (input.checkVisibility?.() ?? input.getClientRects().length > 0);
    if (!visible) {
      const onSearchPage = location.pathname === '/suche';
      void navigate(
        { pathname: '/suche', search: onSearchPage ? location.search : '' },
        { state: FOCUS_SEARCH_STATE, replace: onSearchPage },
      );
      return;
    }
    // Die Shell gibt die Schublade frei; Dialoge geben #root im Cleanup frei.
    onUncover?.();
    focusSearchWhenOperable(input);
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
      className={`header-reference-theme sticky top-0 z-30 grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 sm:grid-cols-[max-content_minmax(0,36rem)] sm:gap-0 desktop:grid-cols-[max-content_minmax(0,36rem)_minmax(max-content,1fr)] ${className}`}
      data-testid="header-bar"
    >
      {/* Hamburger + Brand — grouped as one visual unit */}
      <div className="flex min-w-0 items-center">
        {onMenuToggle && (
          <button
            type="button"
            className="-ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--header-text-muted)] transition-colors hover:text-[var(--header-text)] focus-visible:outline-none kbd-focus:ring-2 kbd-focus:ring-[var(--header-focus-ring)] kbd-focus:ring-offset-1 kbd-focus:ring-offset-[var(--header-bg)] desktop:hidden"
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
          inert={obscured}
          className="group flex min-h-11 min-w-0 items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)]"
        >
          <IconShield className="h-5 w-5 shrink-0 text-[var(--header-brand-accent)] transition-colors group-hover:text-[var(--header-brand-accent-hover)]" />
          <span className="min-w-0 whitespace-nowrap text-sm font-bold leading-tight tracking-wide transition-colors group-hover:text-[var(--header-text-hover)] sm:text-base">
            Grundschutz++ Navigator
          </span>
        </Link>
        {areaSwitch && (
          <div inert={obscured} className="ml-6 hidden shrink-0 desktop:flex">
            {areaSwitch}
          </div>
        )}
      </div>

      {/* Search */}
      <div inert={obscured} className="hidden w-full px-4 sm:block lg:px-8">
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
        inert={obscured}
        className="-mr-3 flex h-11 w-11 shrink-0 items-center justify-center justify-self-end rounded text-[var(--header-text-muted)] transition-colors hover:text-[var(--header-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)] sm:hidden"
        aria-label="Suche"
      >
        <IconSearch className="h-5 w-5" />
      </Link>

      {context && (
        <div inert={obscured} className="hidden min-w-0 justify-self-end desktop:flex">
          {context}
        </div>
      )}
    </header>
  );
}
