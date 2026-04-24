export function ImpressumPage() {
  const name = import.meta.env.VITE_IMPRESSUM_NAME;
  const strasse = import.meta.env.VITE_IMPRESSUM_STRASSE;
  const plzOrt = import.meta.env.VITE_IMPRESSUM_PLZ_ORT;
  const email = import.meta.env.VITE_IMPRESSUM_EMAIL;
  const telefon = import.meta.env.VITE_IMPRESSUM_TELEFON;

  const hasData = name && strasse && plzOrt && email;

  return (
    <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Impressum</h1>

      {hasData ? (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-800">
              Angaben gemäß DDG § 5
            </h2>
            <address className="text-sm text-slate-700 not-italic leading-relaxed">
              {name}
              <br />
              {strasse}
              <br />
              {plzOrt}
            </address>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-800">
              Kontakt
            </h2>
            <div className="text-sm text-slate-700 space-y-1">
              <p>
                E-Mail:{' '}
                <a
                  href={`mailto:${email}`}
                  className="rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                >
                  {email}
                </a>
              </p>
              {telefon && <p>Telefon: {telefon}</p>}
            </div>
          </section>
        </>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-800 font-medium">
            Impressumsdaten sind derzeit nicht hinterlegt.
          </p>
          <p className="text-xs text-amber-700 mt-1">
            Die Angaben werden über Umgebungsvariablen{' '}
            <code>VITE_IMPRESSUM_*</code> bereitgestellt. Siehe{' '}
            <code>.env.local.example</code> für die erforderlichen Werte.
          </p>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          Haftungsausschluss
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Der Grundschutz++ Navigator ist ein inoffizielles Werkzeug auf Basis
          des öffentlich zugänglichen Grundschutz++-Anwenderkatalogs des BSI.
          Trotz sorgfältiger Aufbereitung übernehmen wir keine Gewähr für
          Vollständigkeit, Richtigkeit und Aktualität der dargestellten
          Informationen. Maßgeblich bleibt der offizielle Katalog im
          BSI-Repository.
        </p>
      </section>
    </div>
  );
}
