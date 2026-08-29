import { Link } from 'react-router';
import { buildCatalogUrl } from '@/app/routes';
import type { Catalog } from '@/domain/models';

interface CatalogTargetNotFoundProps {
  readonly catalog: Catalog | null;
}

export function CatalogTargetNotFound({ catalog }: CatalogTargetNotFoundProps) {
  return (
    <div className="flex-1 p-6">
      <h1 className="text-xl font-bold text-slate-900">
        404 — Katalogziel nicht gefunden
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        Der angeforderte Katalogeintrag existiert nicht.
        {catalog && (
          <>
            {' '}
            <Link
              to={buildCatalogUrl(catalog.catalogKey)}
              className="rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
            >
              Zum Katalog
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
