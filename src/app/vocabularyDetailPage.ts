import { lazyPage } from '@/app/lazyPage';

/**
 * Das Vokabulardetail lädt wie die statischen Nebenrouten erst beim ersten Aufruf
 * (Chunk-Vertrag: `staticPageRoutes.tsx`, GSPP-506). Es hat keine statischen
 * HTML-Einstiege und steht deshalb nicht in `STATIC_PAGE_ROUTES`; vorgeladen wird
 * es bei Navigationsabsicht (`routePrefetch.ts`).
 */
export const VocabularyNamespacePage = lazyPage(() =>
  import('@/features/vocabularies/VocabularyNamespacePage').then((m) => ({ default: m.VocabularyNamespacePage })));
