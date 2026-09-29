export interface BackdropTintProps {
  /** Farbe der Abdunklung, z. B. `bg-black/30`. */
  readonly className: string;
}

/**
 * Abdunklung eines festen Hintergrunds (Drawer, Bottom Sheets) als absolut
 * positioniertes Kind. Safari 26 färbt seine Liquid-Glass-Leiste mit der
 * Hintergrundfarbe eines festen Elements, das den unteren Rand in voller
 * Breite berührt, und zeigt dort dann keinen Seiteninhalt mehr. Auf einem
 * Kind liest Safari die Farbe nicht; das feste Element selbst bleibt deshalb
 * ohne eigene Hintergrundfarbe (GSPP-447, iPhone 16 Pro, iOS 27.0.1).
 */
export function BackdropTint({ className }: BackdropTintProps) {
  return <span aria-hidden="true" className={`absolute inset-0 ${className}`} />;
}
