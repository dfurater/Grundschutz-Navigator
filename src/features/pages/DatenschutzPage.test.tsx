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

  describe('Aussagen, die den heutigen Stand beschreiben', () => {
    it('führt weiterhin aus, dass keine fachlichen Nutzungsdaten im Browser abgelegt werden', () => {
      setImpressum({});

      render(<DatenschutzPage />);

      expect(
        screen.getByText(/speichert die Anwendung keine fachlichen/),
      ).toBeInTheDocument();
    });

    it('macht keine Zusagen zu lokal gespeicherten Nutzerdokumenten, solange es sie nicht gibt', () => {
      setImpressum({});

      const { container } = render(<DatenschutzPage />);

      expect(container.textContent).not.toMatch(/Ihre eigenen Dokumente/);
      expect(container.textContent).not.toMatch(/unverschlüsselt/);
    });
  });
});
