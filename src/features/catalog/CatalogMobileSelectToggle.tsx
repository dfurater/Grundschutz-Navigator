import { Button } from '@/components/Button';
import { IconListChecks } from '@/components/icons';

interface CatalogMobileSelectToggleProps {
  readonly active: boolean;
  readonly onToggle: () => void;
}

/**
 * Auswahl-Schalter unter `lg`, gemeinsam für Katalog und Suchergebnisse
 * (GSPP-471). Aktiv ist er keine gefüllte Fläche, sondern die Glyphe in
 * Akzentfarbe auf einer 36-px-Tönung; das Touch-Ziel bleibt 44 px.
 */
export function CatalogMobileSelectToggle({
  active,
  onToggle,
}: CatalogMobileSelectToggleProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="lg:hidden relative isolate min-h-[44px] min-w-[44px]"
      onClick={onToggle}
      aria-label={active ? 'Auswahl beenden' : 'Kontrollen auswählen'}
      aria-pressed={active}
    >
      {active && (
        <span
          data-testid="select-toggle-tint"
          className="absolute inset-1 -z-10 rounded-md bg-[var(--color-accent-soft)]"
          aria-hidden="true"
        />
      )}
      <IconListChecks
        className={`w-4 h-4${active ? ' text-[var(--color-accent-default)]' : ''}`}
      />
    </Button>
  );
}
