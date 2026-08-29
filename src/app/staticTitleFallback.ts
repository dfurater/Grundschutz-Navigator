const STATIC_TITLE_FALLBACK_SELECTOR = 'head > title[data-page-title-fallback]';

export function removeStaticTitleFallback(targetDocument: Document = document): void {
  targetDocument.querySelector(STATIC_TITLE_FALLBACK_SELECTOR)?.remove();
}
