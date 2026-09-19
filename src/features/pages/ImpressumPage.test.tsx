import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImpressumPage } from './ImpressumPage';

/*
 * Für ImpressumPage gab es bis GSPP-419 keinen Test. Die Seite bekommt ihn mit
 * der Entfernung von VITE_IMPRESSUM_TELEFON: Das Feld wurde konditional
 * gerendert und war in keinem Actions-Secret hinterlegt, die Telefonzeile
 * erschien also nie. Ohne Abdeckung wäre „die Seite rendert unverändert" eine
 * Behauptung über eine Zeile geblieben, die niemand ausgeführt hat.
 *
 * Geprüft wird die Zusage, die §5 DDG trägt: Anschrift und elektronische
 * Postadresse. Eine Telefonnummer nennt die Norm nicht als Pflichtangabe.
 */

const IMPRESSUM_KEYS = [
  'VITE_IMPRESSUM_NAME',
  'VITE_IMPRESSUM_STRASSE',
  'VITE_IMPRESSUM_PLZ_ORT',
  'VITE_IMPRESSUM_EMAIL',
] as const;

const VOLLSTAENDIG = {
  VITE_IMPRESSUM_NAME: 'Erika Mustermann',
  VITE_IMPRESSUM_STRASSE: 'Beispielweg 2',
  VITE_IMPRESSUM_PLZ_ORT: '54321 Beispielstadt',
  VITE_IMPRESSUM_EMAIL: 'impressum@example.org',
} as const;

function setImpressum(values: Partial<Record<(typeof IMPRESSUM_KEYS)[number], string>>) {
  for (const key of IMPRESSUM_KEYS) {
    vi.stubEnv(key, values[key] ?? '');
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ImpressumPage', () => {
  it('nennt Anschrift und E-Mail-Adresse, wenn alle Angaben hinterlegt sind', () => {
    setImpressum(VOLLSTAENDIG);

    const { container } = render(<ImpressumPage />);

    // Die Anschrift steht als zusammenhängender Textinhalt in <address>;
    // getByText griffe dort nur bei vollständiger Übereinstimmung.
    const anschrift = container.querySelector('address');

    expect(anschrift).toHaveTextContent('Erika Mustermann');
    expect(anschrift).toHaveTextContent('Beispielweg 2');
    expect(anschrift).toHaveTextContent('54321 Beispielstadt');
    expect(screen.getByRole('link', { name: 'impressum@example.org' })).toHaveAttribute(
      'href',
      'mailto:impressum@example.org',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Angaben gemäß DDG § 5' })).toBeInTheDocument();
  });

  // Regression zu GSPP-419: Die entfernte Telefonzeile darf nicht als
  // leerer Rest zurückbleiben und keine Angabe erfinden.
  it('zeigt keine Telefonzeile im Kontaktabschnitt', () => {
    setImpressum(VOLLSTAENDIG);

    render(<ImpressumPage />);

    const kontakt = screen.getByRole('heading', { level: 2, name: 'Kontakt' }).parentElement;

    expect(kontakt).not.toHaveTextContent(/Telefon/);
  });

  // `hasData` verlangt alle vier Felder. Fehlt eines, blendet die Seite den
  // gesamten Block aus und sagt das ausdrücklich, statt eine Teilangabe zu
  // zeigen, die §5 DDG nicht erfüllt.
  it.each(IMPRESSUM_KEYS)('blendet die Angaben aus, wenn %s fehlt', (fehlend) => {
    const rest = { ...VOLLSTAENDIG };
    delete rest[fehlend];
    setImpressum(rest);

    render(<ImpressumPage />);

    expect(screen.getByText('Impressumsdaten sind derzeit nicht hinterlegt.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Kontakt' })).not.toBeInTheDocument();
  });

  it('trägt den Haftungsausschluss unabhängig von den Impressumsdaten', () => {
    setImpressum({});

    render(<ImpressumPage />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Haftungsausschluss' }),
    ).toBeInTheDocument();
  });
});
