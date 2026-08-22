export function DatenschutzPage() {
  const name = import.meta.env.VITE_IMPRESSUM_NAME;
  const strasse = import.meta.env.VITE_IMPRESSUM_STRASSE;
  const plzOrt = import.meta.env.VITE_IMPRESSUM_PLZ_ORT;
  const email = import.meta.env.VITE_IMPRESSUM_EMAIL;

  // Jede einzelne hinterlegte Angabe genügt, um den Block zu zeigen. Eine
  // strengere Bedingung würde vorhandene Kontaktwege verschweigen und zugleich
  // behaupten, es sei nichts hinterlegt. Ein Verweis auf das Impressum wäre
  // ebenfalls unzuverlässig, weil ImpressumPage bei jeder fehlenden Angabe alle
  // übrigen ausblendet — beides trifft ausgerechnet die Erreichbarkeit des
  // Verantwortlichen.
  const anschriftszeilen = [name, strasse, plzOrt].filter(Boolean);
  const hasVerantwortlicher = anschriftszeilen.length > 0 || Boolean(email);

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
          2. Verantwortlicher
        </h2>
        {hasVerantwortlicher ? (
          <div className="text-sm text-slate-700 leading-relaxed space-y-2">
            <p>
              Verantwortlich für die Verarbeitung personenbezogener Daten im
              Sinne der Datenschutz-Grundverordnung ist:
            </p>
            <address className="not-italic">
              {anschriftszeilen.map((zeile, index) => (
                <span key={zeile}>
                  {index > 0 && <br />}
                  {zeile}
                </span>
              ))}
              {email && (
                <>
                  {anschriftszeilen.length > 0 && <br />}
                  E-Mail:{' '}
                  <a
                    href={`mailto:${email}`}
                    className="rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                  >
                    {email}
                  </a>
                </>
              )}
            </address>
          </div>
        ) : (
          <p className="text-sm text-slate-700 leading-relaxed">
            Die Angaben zum Verantwortlichen sind derzeit nicht hinterlegt.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          3. Hosting
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Diese Anwendung wird über GitHub Pages bereitgestellt. GitHub kann
          beim Abruf der Seite technische Verbindungsdaten wie IP-Adresse,
          Zeitpunkte und HTTP-Metadaten nach eigener Verantwortung verarbeiten.
          Weitere Informationen finden Sie im{' '}
          <a
            href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          >
            GitHub Privacy Statement
            {' '}
            <span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>
          {'.'}
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          Rechtsgrundlage für diese Verarbeitung ist unser berechtigtes
          Interesse an einer technisch fehlerfreien Bereitstellung der
          Anwendung nach Art. 6 Abs. 1 lit. f DSGVO.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          GitHub, Inc. hat seinen Sitz in den USA; die Auslieferung erfolgt
          über Server-Infrastruktur außerhalb der Europäischen Union. GitHub
          ist unter dem EU-U.S. Data Privacy Framework zertifiziert. Grundlage
          der Übermittlung ist damit der Angemessenheitsbeschluss der
          Europäischen Kommission vom 10. Juli 2023. Den Zertifizierungseintrag
          können Sie im{' '}
          <a
            href="https://www.dataprivacyframework.gov"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          >
            Data Privacy Framework
            {' '}
            <span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>{' '}
          einsehen.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          Auf die von GitHub erhobenen Verbindungsdaten haben wir keinen
          Zugriff. Wir führen selbst keine Zugriffsprotokolle und speichern
          keine Verbindungsdaten. Für deren Speicherdauer gelten die Angaben im
          GitHub Privacy Statement.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          4. Cookies &amp; Tracking
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Nach aktuellem Stand setzt die Anwendung selbst keine Cookies für
          Analyse, Werbung oder Nutzerprofile ein. Ebenso werden keine
          Analyse- oder Werbedienste der Anwendung eingebunden.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          5. Lokale Datenspeicherung
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
          6. Externe Ressourcen
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Die Anwendung bindet keine externen Schriftarten, Analyse- oder
          Werbedienste ein. Benötigte Schriftdateien werden zusammen mit der
          Anwendung ausgeliefert.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-800">
          7. Ihre Rechte
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Soweit personenbezogene Daten von Ihnen verarbeitet werden, stehen
          Ihnen gegenüber dem Verantwortlichen die folgenden Rechte zu:
        </p>
        <ul className="text-sm text-slate-700 leading-relaxed list-disc pl-5 space-y-1">
          <li>Auskunft über die verarbeiteten Daten (Art. 15 DSGVO)</li>
          <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li>
          <li>Löschung (Art. 17 DSGVO)</li>
          <li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
          <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
          <li>
            Widerspruch gegen eine Verarbeitung auf Grundlage berechtigter
            Interessen (Art. 21 DSGVO)
          </li>
        </ul>
        <p className="text-sm text-slate-700 leading-relaxed">
          Sie haben außerdem das Recht, sich bei einer
          Datenschutz-Aufsichtsbehörde zu beschweren (Art. 77 DSGVO). Zuständig
          ist die Aufsichtsbehörde Ihres Aufenthaltsorts, Ihres Arbeitsplatzes
          oder des Orts des mutmaßlichen Verstoßes.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          Diese Seite beschreibt den aktuellen technischen Zuschnitt der
          Anwendung und ersetzt keine rechtliche Einzelfallprüfung.
        </p>
      </section>
    </div>
  );
}
