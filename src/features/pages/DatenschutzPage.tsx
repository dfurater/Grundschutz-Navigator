export function DatenschutzPage() {
  return (
    <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        Datenschutzerklärung
      </h1>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          1. Allgemeine Hinweise
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Der Grundschutz++ Navigator ist eine clientseitige Webanwendung. Der
          Grundschutz++-Katalog wird im Browser geladen und dort verarbeitet.
          Die Anwendung stellt derzeit keine Nutzerkonten, Formulare oder
          serverseitige Fachverarbeitung bereit.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          2. Hosting
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Diese Anwendung wird über GitHub Pages bereitgestellt. GitHub kann
          beim Abruf der Seite technische Verbindungsdaten wie IP-Adresse,
          Zeitpunkte und HTTP-Metadaten nach eigener Verantwortung verarbeiten.
          Weitere Informationen finden Sie in der{' '}
          <a
            href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          >
            GitHub Privacy Statement
            <span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          3. Cookies & Tracking
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Nach aktuellem Stand setzt die Anwendung selbst keine Cookies für
          Analyse, Werbung oder Nutzerprofile ein. Ebenso werden keine
          Analyse- oder Werbedienste der Anwendung eingebunden.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          4. Lokale Datenspeicherung
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Nach aktuellem Stand speichert die Anwendung keine fachlichen
          Nutzungsdaten in <code>localStorage</code>,{' '}
          <code>sessionStorage</code> oder vergleichbaren Browser-Speichern.
          Ausgelieferte Dateien können browser- oder netzwerkbedingt
          zwischengespeichert werden und lassen sich über die
          Browser-Einstellungen entfernen.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          5. Externe Ressourcen
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Die Anwendung lädt Schriftarten von{' '}
          <a
            href="https://fonts.bunny.net"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          >
            Bunny Fonts
            <span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>
          . Beim Abruf können technische Verbindungsdaten an den Anbieter
          übermittelt werden. Maßgeblich sind die Hinweise des jeweiligen
          Anbieters.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          6. Ihre Rechte
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Diese Seite beschreibt den aktuellen technischen Zuschnitt der
          Anwendung und ersetzt keine rechtliche Einzelfallprüfung. Soweit beim
          Hosting oder beim Abruf externer Ressourcen personenbezogene Daten
          verarbeitet werden, richten sich Informations- und Betroffenenrechte
          nach den jeweils einschlägigen Verantwortlichkeiten. Für Hinweise zur
          Anwendung selbst nutzen Sie bitte die Angaben im Impressum.
        </p>
      </section>
    </div>
  );
}
