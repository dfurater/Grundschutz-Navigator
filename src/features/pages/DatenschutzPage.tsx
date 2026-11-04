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
      <h1 className="type-page-title">
        Datenschutzerklärung
      </h1>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug text-slate-900">
          1. Allgemeine Hinweise
        </h2>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Der Grundschutz++ Navigator ist eine clientseitige Webanwendung. Der
          Grundschutz++-Katalog wird im Browser geladen und dort verarbeitet.
          Die Anwendung stellt derzeit keine Nutzerkonten, Formulare oder
          serverseitige Fachverarbeitung bereit.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug text-slate-900">
          2. Verantwortlicher
        </h2>
        {hasVerantwortlicher ? (
          <div className="catalog-prose-text text-sm text-slate-700 leading-relaxed space-y-2">
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
                    className="rounded catalog-prose-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                  >
                    {email}
                  </a>
                </>
              )}
            </address>
          </div>
        ) : (
          <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
            Die Angaben zum Verantwortlichen sind derzeit nicht hinterlegt.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug text-slate-900">
          3. Hosting
        </h2>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Diese Anwendung wird über GitHub Pages bereitgestellt. GitHub kann
          beim Abruf der Seite technische Verbindungsdaten wie IP-Adresse,
          Zeitpunkte und HTTP-Metadaten nach eigener Verantwortung verarbeiten.
          Weitere Informationen finden Sie im{' '}
          <a
            href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded catalog-prose-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          >
            GitHub Privacy Statement<span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>
          {'.'}
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Rechtsgrundlage für diese Verarbeitung ist unser berechtigtes
          Interesse an einer technisch fehlerfreien Bereitstellung der
          Anwendung nach Art. 6 Abs. 1 lit. f DSGVO.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          GitHub, Inc. hat seinen Sitz in den USA; die Auslieferung kann auch
          über Server-Infrastruktur außerhalb der Europäischen Union erfolgen. GitHub
          ist unter dem EU-U.S. Data Privacy Framework zertifiziert. Grundlage
          der Übermittlung ist damit der Angemessenheitsbeschluss der
          Europäischen Kommission vom 10. Juli 2023. Den Zertifizierungseintrag
          können Sie im{' '}
          <a
            href="https://www.dataprivacyframework.gov"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded catalog-prose-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          >
            Data Privacy Framework<span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>{' '}
          einsehen.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Wir führen selbst keine Zugriffsprotokolle. Auf die von GitHub
          erhobenen Verbindungsdaten haben wir keinen Zugriff; für deren
          Speicherdauer gelten die Angaben im GitHub Privacy Statement.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Die Namensauflösung der Domain gspp-navigator.furater.com erfolgt über
          die Nameserver der Cloudflare, Inc., 101 Townsend St., San Francisco,
          CA 94107, USA. Beim Aufruf der Anwendung fragt ein DNS-Resolver, in
          der Regel der Ihres Internetanbieters oder ein von Ihnen gewählter
          öffentlicher Resolver, bei Cloudflare die Adresse der Domain ab.
          Cloudflare verarbeitet dabei die IP-Adresse dieses Resolvers, den
          angefragten Namen und den Zeitpunkt. Einige öffentliche Resolver
          übermitteln zusätzlich einen gekürzten Adressbereich Ihres
          Internetanschlusses (EDNS Client Subnet). Betreiben Sie einen eigenen
          Resolver, ist dessen Adresse die Ihres Anschlusses. Der Abruf der
          Seite selbst läuft nicht über Cloudflare, sondern direkt zu GitHub.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Cloudflare verarbeitet diese Anfragedaten in unserem Auftrag auf
          Grundlage seines Auftragsverarbeitungsvertrags (Art. 28 DSGVO);
          daraus abgeleitete Netzwerkdaten, etwa zur Abwehr von Angriffen,
          verarbeitet Cloudflare in eigener Verantwortung. Rechtsgrundlage ist
          unser berechtigtes Interesse an einer zuverlässigen Erreichbarkeit
          der Anwendung nach Art. 6 Abs. 1 lit. f DSGVO. Cloudflare ist unter
          dem EU-U.S. Data Privacy Framework zertifiziert; Grundlage der
          Übermittlung ist der Angemessenheitsbeschluss der Europäischen
          Kommission vom 10. Juli 2023. In der Verwaltungsoberfläche von
          Cloudflare können wir Auswertungen der DNS-Anfragen der letzten 30
          Tage einsehen, darunter die IP-Adressen der anfragenden Systeme, in
          der Regel DNS-Resolver. Weitere Informationen finden Sie in der{' '}
          <a
            href="https://www.cloudflare.com/privacypolicy/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded catalog-prose-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          >
            Cloudflare-Datenschutzerklärung<span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>
          {'.'}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug text-slate-900">
          4. Cookies &amp; Tracking
        </h2>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Nach aktuellem Stand setzt die Anwendung selbst keine Cookies für
          Analyse, Werbung oder Nutzerprofile ein. Ebenso werden keine
          Analyse- oder Werbedienste der Anwendung eingebunden.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug text-slate-900">
          5. Lokale Datenspeicherung
        </h2>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Die technische Speicherschnittstelle kann eigene Dokumente auf Wunsch
          lokal im Browser speichern. Die Dokumente verlassen das Gerät dabei nicht.
          Die Anwendung setzt keine Löschfrist und löscht gespeicherte Dokumente
          nicht automatisch. Der Browser kann lokal gespeicherte Daten jedoch ohne
          Rückfrage entfernen, etwa bei knappem Speicherplatz oder wenn Sie diese
          Website längere Zeit nicht nutzen.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Ausgelieferte Dateien können browser- oder netzwerkbedingt
          zwischengespeichert werden und lassen sich über die
          Browser-Einstellungen entfernen.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Im Bereich Informationsverbünde können Sie einen Informationsverbund
          mit allen zugehörigen Dokumenten vollständig löschen und eine
          Sicherungsdatei aller gespeicherten Daten oder eines einzelnen
          Informationsverbunds exportieren. Eine solche Sicherungsdatei können
          Sie wiederherstellen: Die Anwendung prüft sie ausschließlich in Ihrem
          Browser, zeigt vorher den betroffenen Umfang und ersetzt die dort
          gespeicherten Daten einschließlich der Entwürfe erst nach Ihrer
          Bestätigung. An der Station
          Profile legen Sie Profile an oder nehmen eine Profil-Datei auf; die
          Datei wird ausschließlich in Ihrem Browser geprüft und nicht
          hochgeladen. Änderungen an einem Profil sichert die Anwendung
          automatisch als Entwurf in diesem Browser, bis Sie sie ausdrücklich
          speichern. Ein gespeichertes, gültiges Profil können Sie als
          OSCAL-JSON-Datei auf Ihr Gerät exportieren, und Sie können ein
          einzelnes Profil samt Entwurf vollständig löschen. Über die technische
          Schnittstelle lassen sich zudem andere einzelne Dokumente oder
          sämtliche gespeicherten Daten vollständig löschen; Bedienelemente dafür
          sind derzeit nicht verfügbar. Über die Browser-Einstellungen können
          Sie sämtliche lokalen Daten dieser Anwendung entfernen.
          Bereits exportierte Dateien werden dadurch nicht gelöscht; das gilt
          auch für deren Kopien, etwa in Betriebssystem-Backups oder bei Dritten.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          An der Station SSP legen Sie einen System Security Plan an oder lesen
          eine lokale OSCAL-JSON-Datei ein. Die Anwendung prüft die Datei
          ausschließlich in Ihrem Browser und speichert sie im gewählten
          Informationsverbund. Systembeschreibung, Komponenten, Benutzer und
          Anforderungen bearbeiten Sie in diesem Browser; Änderungen sichert die
          Anwendung automatisch als Entwurf, bis Sie sie ausdrücklich speichern.
          Nichts davon wird hochgeladen; Verweise wie die Baseline und
          eingebettete Ressourcen werden nicht abgerufen oder ausgeführt. Ein
          gespeicherter, gültiger SSP lässt sich als OSCAL-JSON-Datei auf Ihr
          Gerät exportieren. Die gespeicherte Kopie bleibt nach dem Schließen
          des Tabs erhalten und ist in der Sicherungsdatei enthalten. Einen
          einzelnen SSP samt Entwurf und Bindungen löschen Sie nach Bestätigung
          über „SSP löschen…“; daneben dienen die Löschung des zugehörigen
          Informationsverbunds oder der lokalen Daten dieser Anwendung über die
          Browser-Einstellungen.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          An der Station Assessment lesen Sie lokale Prüfergebnisse als Assessment-Results-JSON ein. Die Anwendung prüft und speichert die Datei ausschließlich in diesem Browser im gewählten Informationsverbund. Prüfergebnisse, Urheberangaben und Evidenz bleiben nach dem Schließen des Tabs gespeichert und sind in der Sicherungsdatei enthalten. Die Leseansicht verändert die gespeicherte Quelle nicht. Verweise und eingebettete Evidenz werden beim Öffnen der Ansicht nicht abgerufen oder ausgeführt. Vorschau, Download und Hashprüfung einer Evidenzressource starten nur auf Ihre Aktion; „Extern öffnen“ öffnet den angegebenen Link in einem neuen Tab. Die Löschung des Informationsverbunds oder der lokalen Website-Daten entfernt die gespeicherte Kopie.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Im Reiter Prüfung eines Profils können Sie Prüfpunkte und
          Prüfentscheidungen festhalten. Ein Prüfpunkt speichert einen
          Inhalts-Hash und einen strukturellen Vergleich zum vorherigen
          Prüfpunkt. Vom geprüften Inhalt bewahrt der Workspace nur eine
          Vergleichskopie des zuletzt gesetzten Prüfpunkts auf; ältere Stände
          liegen nicht mehr vor. Prüfentscheidungen und Begründungen bleiben im
          Workspace dieses Browsers. Eine Freigabe schreibt Rolle, Partei und
          Begründung in das Profil; diese Angaben sind in der exportierten Datei
          enthalten. Eine elektronische Signatur und eine Identitätsprüfung
          finden nicht statt. Prüfspur und Vergleichsbasis sind in der
          Sicherungsdatei enthalten und werden mit dem Profil oder dem
          Informationsverbund gelöscht.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Eingebettete Evidenzinhalte werden beim Einlesen von Dokumenten nicht
          dekodiert, ausgeführt oder an externe Dienste übertragen. Eine
          Evidenzvorschau ist derzeit nicht in die Oberfläche eingebunden.
          Eine deklarierte Medienart und ein übereinstimmender Hash belegen
          nicht die Unbedenklichkeit einer Datei. Evidenzinhalte und Dateinamen
          werden nicht in die Adresszeile oder Diagnoseausgaben übernommen.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Der Betreiber hat keine Kopie Ihrer gespeicherten Dokumente und kann
          sie nicht wiederherstellen. Die exportierte Sicherungsdatei ist die
          einzige Sicherung. Ohne eine solche Datei
          gehen die Dokumente beim Verlust des Geräts oder Browserprofils verloren.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug text-slate-900">
          6. Unverschlüsselte Speicherung
        </h2>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Gespeicherte Dokumente liegen unverschlüsselt im Browserprofil.
          Personen mit Zugriff auf Ihr Browserprofil oder das entsperrte Gerät
          können die Dokumente lesen. Das betrifft insbesondere die Nutzung auf
          geteilten Geräten sowie Vertretungs- und Administrationszugänge.
          Auch beim Verlust des Geräts können Dritte die Dokumente lesen, wenn
          sie Zugang zum Browserprofil erhalten.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug text-slate-900">
          7. Externe Ressourcen
        </h2>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Die Anwendung bindet keine externen Schriftarten, Analyse- oder
          Werbedienste ein. Benötigte Schriftdateien werden zusammen mit der
          Anwendung ausgeliefert.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug text-slate-900">
          8. Ihre Rechte
        </h2>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Soweit personenbezogene Daten von Ihnen verarbeitet werden, stehen
          Ihnen gegenüber dem Verantwortlichen die folgenden Rechte zu:
        </p>
        <ul className="catalog-prose-text text-sm text-slate-700 leading-relaxed list-disc pl-5 space-y-1">
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
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Sie haben außerdem das Recht, sich bei einer
          Datenschutz-Aufsichtsbehörde zu beschweren (Art. 77 DSGVO). Zuständig
          ist die Aufsichtsbehörde Ihres Aufenthaltsorts, Ihres Arbeitsplatzes
          oder des Orts des mutmaßlichen Verstoßes.
        </p>
        <p className="catalog-prose-text text-sm text-slate-700 leading-relaxed">
          Diese Seite beschreibt den aktuellen technischen Zuschnitt der
          Anwendung und ersetzt keine rechtliche Einzelfallprüfung.
        </p>
      </section>
    </div>
  );
}
