import { useState } from 'react';
import { LegendPanel, LegendToggle, type LegendEntry } from './ControlVocabularyPrimitives';

interface ControlDetailSectionProps {
  /**
   * Blocküberschrift als Leiste voller Panelbreite. Ohne Heading (z. B.
   * Fußzeile) rendert die Sektion KEINE Leiste (GSPP-303 T9).
   */
  readonly heading?: string;
  /** Legende des Blocks: Textlink rechts in der Leiste, Panel direkt darunter. */
  readonly legend?: { readonly id: string; readonly entries: LegendEntry[] };
  readonly children: React.ReactNode;
}

export function ControlDetailSection({ heading, legend, children }: ControlDetailSectionProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const hasLegend = legend !== undefined && legend.entries.length > 0;
  // Alle Blöcke gleich: Leiste im Standard-Ton, Inhalt auf Weiß (Owner
  // 26.09.2026). Der erste Block des Panels schließt ohne Lücke an die
  // Kopflinie an, die dann seine obere Kante ist.
  const barTone = 'bg-[var(--color-surface-subtle)] border-t [section:first-child>&]:-mt-4 [section:first-child>&]:border-t-0';

  return (
    <section>
      {heading !== undefined && (
        <div
          className={`-mx-4 mb-2.5 flex items-center justify-between gap-2 border-b border-[var(--color-border-default)] px-4 py-1.5 ${barTone}`}
        >
          <h3 className="text-base font-semibold leading-snug text-slate-900">{heading}</h3>
          {hasLegend && (
            <LegendToggle
              legendId={legend.id}
              open={legendOpen}
              onToggle={() => {
                setLegendOpen((current) => !current);
              }}
            />
          )}
        </div>
      )}
      {hasLegend && (
        <LegendPanel legendId={legend.id} open={legendOpen} entries={legend.entries} className="mb-3" />
      )}
      {children}
    </section>
  );
}
