import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageTitle } from './PageTitle';
import { PRODUCT_TITLE } from './pageTitles';
import { expectSingleDocumentTitle } from '@/test/documentTitle';

function addStaticFallback(): void {
  document.head.insertAdjacentHTML(
    'afterbegin',
    `<title data-page-title-fallback>${PRODUCT_TITLE}</title>`,
  );
}

describe('PageTitle', () => {
  it('suffixes a page title with the product name', () => {
    render(<PageTitle title="Suche" />);

    expectSingleDocumentTitle(`Suche — ${PRODUCT_TITLE}`);
  });

  it('uses the bare product name without a page title', () => {
    render(<PageTitle />);

    expectSingleDocumentTitle(PRODUCT_TITLE);
  });

  it('uses the bare product name for an empty page title', () => {
    // Ein leerer OSCAL-`metadata/title` darf keinen führenden Gedankenstrich erzeugen.
    render(<PageTitle title="" />);

    expectSingleDocumentTitle(PRODUCT_TITLE);
  });

  it('replaces the static bootstrap fallback once it renders', () => {
    addStaticFallback();

    render(<PageTitle title="Suche" />);

    expectSingleDocumentTitle(`Suche — ${PRODUCT_TITLE}`);
    expect(document.head.querySelector('[data-page-title-fallback]')).toBeNull();
  });

  it('keeps the static fallback when no page title ever renders', () => {
    // Ohne ErrorBoundary bleibt ein gescheiterter Render sonst titellos zurück.
    addStaticFallback();

    expect(document.title).toBe(PRODUCT_TITLE);
    expect(document.head.querySelector('[data-page-title-fallback]')).not.toBeNull();
    document.head.querySelectorAll('title').forEach((element) => element.remove());
  });
});
