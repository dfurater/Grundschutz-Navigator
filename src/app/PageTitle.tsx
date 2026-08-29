const PRODUCT_TITLE = 'Grundschutz++ Navigator';

export function PageTitle({ title }: Readonly<{ title?: string }>) {
  return <title>{title === undefined ? PRODUCT_TITLE : `${title} — ${PRODUCT_TITLE}`}</title>;
}
