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

    it('verweist auf das Impressum, wenn eine Pflichtangabe fehlt', () => {
      setImpressum({
        VITE_IMPRESSUM_NAME: 'Erika Mustermann',
        VITE_IMPRESSUM_STRASSE: 'Beispielweg 2',
        VITE_IMPRESSUM_PLZ_ORT: '54321 Beispielstadt',
      });

      const { container } = render(<DatenschutzPage />);

      expect(
        screen.getByText(/die im Impressum genannte Person/),
      ).toBeInTheDocument();
      // Gegen den Textinhalt prüfen, nicht per queryByText: der Name stünde in
      // <address> zwischen weiteren Textknoten und würde dort nie exakt matchen.
      expect(container.querySelector('address')).toBeNull();
      expect(container.textContent).not.toMatch(/Erika Mustermann/);
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
