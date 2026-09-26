interface ControlDetailSectionProps {
  /**
   * Blocküberschrift als Leiste voller Panelbreite. Ohne Heading (z. B.
   * Kurzprofil, Fußzeile) rendert die Sektion KEINE Leiste (GSPP-303 T9).
   */
  readonly heading?: string;
  /**
   * `onZone` für Blöcke in der getönten Zone (Merkmale, Zusammenhänge):
   * Leisten-Hintergrund slate-100 statt Standard-Ton (GSPP-303 T4/T9).
   */
  readonly tone?: 'default' | 'onZone';
  readonly children: React.ReactNode;
}

export function ControlDetailSection({ heading, tone = 'default', children }: ControlDetailSectionProps) {
  return (
    <section>
      {heading !== undefined && (
        <h3
          className={`-mx-4 mb-4 border-y border-[var(--color-border-default)] px-4 py-1.5 text-sm font-semibold text-slate-800 ${
            tone === 'onZone' ? 'bg-slate-100' : 'bg-[var(--color-surface-subtle)]'
          }`}
        >
          {heading}
        </h3>
      )}
      {children}
    </section>
  );
}
