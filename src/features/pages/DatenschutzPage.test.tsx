import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatenschutzPage } from './DatenschutzPage';

const IMPRESSUM_KEYS = [
  'VITE_IMPRESSUM_NAME',
  'VITE_IMPRESSUM_STRASSE',
  'VITE_IMPRESSUM_PLZ_ORT',
  'VITE_IMPRESSUM_EMAIL',
] as const;

function setImpressum(values: Partial<Record<(typeof IMPRESSUM_KEYS)[number], string>>) {
  for (const key of IMPRESSUM_KEYS) {
    vi.stubEnv(key, values[key] ?? '');
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DatenschutzPage', () => {
  describe('Verantwortlicher', () => {
    it('nennt Name und Kontaktdaten, wenn die Impressumsdaten vollständig sind', () => {
      setImpressum({
        VITE_IMPRESSUM_NAME: 'Erika Mustermann',
        VITE_IMPRESSUM_STRASSE: 'Beispielweg 2',
        VITE_IMPRESSUM_PLZ_ORT: '54321 Beispielstadt',
        VITE_IMPRESSUM_EMAIL: 'datenschutz@example.org',
      });

      const { container } = render(<DatenschutzPage />);

      // Die Anschrift steht als zusammenhängender Textinhalt in <address>;
      // getByText würde dort nur bei vollständiger Übereinstimmung greifen.
      const anschrift = container.querySelector('address');

      expect(anschrift).toHaveTextContent('Erika Mustermann');
      expect(anschrift).toHaveTextContent('Beispielweg 2');
      expect(anschrift).toHaveTextContent('54321 Beispielstadt');
      expect(
        screen.getByRole('link', { name: 'datenschutz@example.org' }),
      ).toHaveAttribute('href', 'mailto:datenschutz@example.org');
    });

    it('zeigt die vorhandenen Angaben auch bei fehlender E-Mail-Adresse', () => {
      setImpressum({
        VITE_IMPRESSUM_NAME: 'Erika Mustermann',
        VITE_IMPRESSUM_STRASSE: 'Beispielweg 2',
        VITE_IMPRESSUM_PLZ_ORT: '54321 Beispielstadt',
      });

      const { container } = render(<DatenschutzPage />);
      const anschrift = container.querySelector('address');

      expect(anschrift).toHaveTextContent('Erika Mustermann');
      expect(anschrift).toHaveTextContent('54321 Beispielstadt');
      expect(anschrift).not.toHaveTextContent('E-Mail:');
    });

    // Regression: Der frühere Fallback verwies auf das Impressum. ImpressumPage
    // blendet bei derselben unvollständigen Konfiguration jedoch sämtliche
    // Angaben aus, sodass der Verweis ins Leere lief.
    it('verweist nicht auf das Impressum, das dieselben Angaben ausblendet', () => {
      setImpressum({
        VITE_IMPRESSUM_NAME: 'Erika Mustermann',
        VITE_IMPRESSUM_STRASSE: 'Beispielweg 2',
        VITE_IMPRESSUM_PLZ_ORT: '54321 Beispielstadt',
      });

      const { container } = render(<DatenschutzPage />);

      expect(container.textContent).not.toMatch(/im Impressum/);
    });

    // Regression: Eine Bedingung allein auf den Namen hätte vorhandene
    // Kontaktwege verschwiegen und zugleich behauptet, es sei nichts hinterlegt.
    it('zeigt die E-Mail-Adresse auch ohne hinterlegten Namen', () => {
      setImpressum({ VITE_IMPRESSUM_EMAIL: 'datenschutz@example.org' });

      const { container } = render(<DatenschutzPage />);

      expect(
        screen.getByRole('link', { name: 'datenschutz@example.org' }),
      ).toHaveAttribute('href', 'mailto:datenschutz@example.org');
      expect(container.textContent).not.toMatch(/nicht hinterlegt/);
    });

    it('zeigt eine vorhandene Anschrift auch ohne Namen, ohne führenden Umbruch', () => {
      setImpressum({
        VITE_IMPRESSUM_STRASSE: 'Beispielweg 2',
        VITE_IMPRESSUM_PLZ_ORT: '54321 Beispielstadt',
      });

      const { container } = render(<DatenschutzPage />);
      const anschrift = container.querySelector('address');

      expect(anschrift).toHaveTextContent('Beispielweg 2');
      expect(anschrift?.firstElementChild?.tagName).not.toBe('BR');
      expect(container.textContent).not.toMatch(/nicht hinterlegt/);
    });

    it('sagt es offen, wenn gar keine Angaben hinterlegt sind', () => {
      setImpressum({});

      const { container } = render(<DatenschutzPage />);

      expect(
        screen.getByText(/Angaben zum Verantwortlichen sind derzeit nicht hinterlegt/),
      ).toBeInTheDocument();
      expect(container.querySelector('address')).toBeNull();
      expect(container.textContent).not.toMatch(/im Impressum/);
    });
  });

  describe('Pflichtangaben nach Art. 13 DSGVO', () => {
    it('nennt die Rechtsgrundlage der Hosting-Verarbeitung', () => {
      setImpressum({});

      render(<DatenschutzPage />);

      expect(
        screen.getByText(/Art\. 6 Abs\. 1 lit\. f DSGVO/),
      ).toBeInTheDocument();
    });

    it('weist den Drittlandtransfer samt Übermittlungsgrundlage aus', () => {
      setImpressum({});

      render(<DatenschutzPage />);

      expect(
        screen.getByText(/außerhalb der Europäischen Union/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/EU-U\.S\. Data Privacy Framework/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Data Privacy Framework/ }),
      ).toHaveAttribute('href', 'https://www.dataprivacyframework.gov');
    });

    it('stellt klar, dass der Betreiber keine eigenen Verbindungsdaten speichert', () => {
      setImpressum({});

      render(<DatenschutzPage />);

      expect(
        screen.getByText(/keine Zugriffsprotokolle und speichern\s+keine Verbindungsdaten/),
      ).toBeInTheDocument();
    });

    it('zählt die Betroffenenrechte einzeln auf und nennt das Beschwerderecht', () => {
      setImpressum({});

      render(<DatenschutzPage />);

      const rechte = screen.getByRole('list');
      const eintraege = within(rechte).getAllByRole('listitem');

      expect(eintraege).toHaveLength(6);
      for (const artikel of ['15', '16', '17', '18', '20', '21']) {
        expect(
          within(rechte).getByText(new RegExp(`Art\\. ${artikel} DSGVO`)),
        ).toBeInTheDocument();
      }

      expect(screen.getByText(/Art\. 77 DSGVO/)).toBeInTheDocument();
    });
  });

  describe('Lokale Dokumentenspeicherung', () => {
    it('erklärt die Zwischenspeicherung ausgelieferter Dateien und ihre Entfernung', () => {
      setImpressum({});
      const { container } = render(<DatenschutzPage />);
      expect(container).toHaveTextContent(/Ausgelieferte Dateien können browser- oder netzwerkbedingt zwischengespeichert werden/);
      expect(container).toHaveTextContent(/lassen sich über die Browser-Einstellungen entfernen/);
    });
    it('beschreibt freiwillige Speicherung ohne Löschfrist der Anwendung und die mögliche Entfernung durch den Browser', () => {
      const { container } = render(<DatenschutzPage />);

      expect(container).toHaveTextContent(/eigene Dokumente auf Wunsch lokal im Browser/);
      expect(container).toHaveTextContent(/Dokumente verlassen das Gerät dabei nicht/);
      expect(container).toHaveTextContent(/setzt keine Löschfrist und löscht gespeicherte Dokumente nicht automatisch/);
      expect(container).toHaveTextContent(/Der Browser kann lokal gespeicherte Daten jedoch ohne Rückfrage entfernen/);
      expect(container).not.toHaveTextContent(/Sie bestimmen die Speicherdauer/);
    });

    it('erläutert Löschumfang und Grenzen genau mit den vorhandenen Bedienelementen', () => {
      const { container } = render(<DatenschutzPage />);

      expect(container).toHaveTextContent(/Informationsverbund mit allen zugehörigen Dokumenten vollständig löschen und eine Sicherungsdatei aller gespeicherten Daten exportieren/);
      expect(container).toHaveTextContent(/einzelnes Profil samt Entwurf vollständig löschen/);
      expect(container).toHaveTextContent(/andere einzelne Dokumente oder sämtliche gespeicherten Daten vollständig löschen; Bedienelemente dafür sind derzeit nicht verfügbar/);
      expect(container).toHaveTextContent(/Bereits exportierte Dateien werden dadurch nicht gelöscht/);
    });

    it('zeigt die Risiken unverschlüsselter Speicherung in einem eigenen sichtbaren Abschnitt', () => {
      render(<DatenschutzPage />);
      const heading = screen.getByRole('heading', { level: 2, name: /Unverschlüsselte Speicherung/ });
      const section = heading.closest('section');

      expect(heading).toBeVisible();
      expect(section).toHaveTextContent(/unverschlüsselt/);
      expect(section).toHaveTextContent(/geteilten Geräten/);
      expect(section).toHaveTextContent(/Verlust des Geräts/);
      expect(section).toHaveTextContent(/Zugriff auf Ihr Browserprofil/);
    });

    it('nennt den Export als einzige Sicherung ohne Kopie beim Betreiber', () => {
      const { container } = render(<DatenschutzPage />);

      expect(container).toHaveTextContent(/Betreiber hat keine Kopie/);
      expect(container).toHaveTextContent(/exportierte Sicherungsdatei ist die einzige Sicherung/);
    });

    it('verwendet keine internen Projektbegriffe und nummeriert die Abschnitte fortlaufend', () => {
      const { container } = render(<DatenschutzPage />);

      expect(container.textContent).not.toMatch(/Klasse 1|Klasse 2|Arbeitsbereich/);
      expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent?.trim().split('.')[0]))
        .toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    });
  });
});
