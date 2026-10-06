export interface BackdropTintProps {
  /**
 * Abdunklung des festen Hintergrunds der mobilen Bottom Sheets als absolut
 * positioniertes Kind. Ein festes oder sticky Element, das bis zum unteren
 * Bildschirmrand reicht, lässt Safari seine Leiste mit einer undurchsichtigen
 * Fläche füllen, unabhängig von seiner Hintergrundfarbe; bei den Sheets liegt
 * dort das Sheet selbst. Der Navigations-Drawer ist weder fest noch sticky und
 * verwendet diese Komponente nicht (GSPP-486).
 */
  readonly className: string;
}

/**
 * Abdunklung des festen Hintergrunds der mobilen Bottom Sheets als absolut
 * positioniertes Kind. Ein festes Element, das bis zum unteren Bildschirmrand
 * reicht, lässt Safari seine Leiste mit einer undurchsichtigen Fläche füllen,
 * unabhängig von seiner Hintergrundfarbe; die Lage der Tönung verhindert das
 * nicht. Bei den Sheets liegt dort ohnehin das Sheet selbst. Der
 * Navigations-Drawer ist deshalb nicht fest positioniert und verwendet diese
 * Komponente nicht (GSPP-486).
 */
export function BackdropTint({ className }: BackdropTintProps) {
  return <span aria-hidden="true" className={`absolute inset-0 ${className}`} />;
}
