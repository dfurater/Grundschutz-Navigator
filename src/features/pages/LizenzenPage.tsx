import { IconExternalLink } from '@/components/icons';

export function LizenzenPage() {
  return (
    <div className="max-w-3xl mx-auto py-8 px-6 space-y-8">
      <h1 className="text-2xl font-bold text-slate-900">
        Lizenzen und Quellenhinweise
      </h1>

      {/* BSI Catalog License */}
      <section className="bg-sky-50 border border-sky-100 rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          BSI Grundschutz++ Anwenderkatalog
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Diese Anwendung nutzt den offiziellen{' '}
          <strong>Grundschutz++-Anwenderkatalog</strong> des{' '}
          <strong>Bundesamts für Sicherheit in der Informationstechnik (BSI)</strong>
          {' '}aus der{' '}
          <a
            href="https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          >
            Stand-der-Technik-Bibliothek
            <span className="sr-only"> (öffnet in neuem Tab)</span>
            <IconExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
          .
        </p>
        <div className="bg-white border border-sky-200 rounded p-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            Lizenzhinweis
          </h3>
          <p className="text-sm text-slate-700 leading-relaxed">
            Das Repository `BSI-Bund/Stand-der-Technik-Bibliothek` steht laut
            Repository unter CC BY-SA 4.0. Für Nutzung, Bearbeitung und
            Weitergabe der Kataloginhalte sind die dortigen Lizenzhinweise
            maßgeblich, einschließlich Namensnennung und, soweit einschlägig,
            Weitergabe unter gleichen Bedingungen.
          </p>
        </div>
      </section>

      {/* Third-party Licenses */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-800">
          Ausgewählte Open-Source-Bibliotheken
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Die folgende Liste ist nicht abschließend. Maßgeblich bleiben die
          jeweiligen Lizenzdateien und Projektseiten der verwendeten Pakete.
        </p>
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
          {[
            {
              name: 'React',
              version: '19.x',
              license: 'MIT',
              url: 'https://github.com/facebook/react',
            },
            {
              name: 'Vite',
              version: '8.x',
              license: 'MIT',
              url: 'https://github.com/vitejs/vite',
            },
            {
              name: 'Tailwind CSS',
              version: '4.x',
              license: 'MIT',
              url: 'https://github.com/tailwindlabs/tailwindcss',
            },
            {
              name: 'FlexSearch',
              version: '0.8.x',
              license: 'Apache-2.0',
              url: 'https://github.com/nicxtreme/flexsearch',
            },
            {
              name: 'React Router',
              version: '7.x',
              license: 'MIT',
              url: 'https://github.com/remix-run/react-router',
            },
            {
              name: 'TypeScript',
              version: '6.x',
              license: 'Apache-2.0',
              url: 'https://github.com/microsoft/TypeScript',
            },
          ].map((lib) => (
            <div
              key={lib.name}
              className="flex items-center justify-between px-4 py-3"
            >
              <div>
                <a
                  href={lib.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded text-sm font-medium text-slate-900 hover:text-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                >
                  {lib.name}
                  <span className="sr-only"> (öffnet in neuem Tab)</span>
                  <IconExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
                <span className="text-xs text-slate-500 ml-2">
                  v{lib.version}
                </span>
              </div>
              <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                {lib.license}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* App License */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          Hinweis zum Projektcode
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Diese Seite fasst vor allem die Herkunft des BSI-Katalogs und
          ausgewählte Drittbibliotheken zusammen. Maßgeblich bleiben die
          Lizenzdateien und Lizenzhinweise der jeweiligen Projekte und
          Repositories.
        </p>
      </section>
    </div>
  );
}
