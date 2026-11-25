// =============================================================================
// Registrierte Differenzen zwischen unserer Profile-Resolution und den
// BSI-resolved_catalog-Dokumenten (GSPP-291).
//
// Die Einträge sind an den getrackten BSI-Snapshot gebunden und veralten mit
// jeder Rolling Publication. Sie liegen deshalb bewusst unter `src/` und nicht
// beim auswertenden Skript: Eine Snapshot-Migration muss sie mitführen können,
// und der Guard-PR-Typ für manuelle Snapshot-Migrationen lässt als
// Begleitpfade positiv nur `src/**` und `docs/**` zu (GSPP-375, GSPP-376).
//
// Die Auswertungslogik bleibt in `scripts/profileResolutionCorpusOracle.ts` —
// hier stehen ausschließlich Daten.
// =============================================================================

export type BsiCorpusDifference =
  | {
    readonly corpusKey: 'lieferkette' | 'wlan' | 'diva' | 'wlan-gastnetze';
    readonly controlId: string;
    readonly member: 'links';
    readonly href: string;
    readonly reason: string;
  }
  | {
    readonly corpusKey: 'lieferkette' | 'wlan' | 'diva' | 'wlan-gastnetze';
    readonly controlId: string;
    readonly member: 'controls';
    readonly position: 'end';
    readonly reason: string;
  };

const LINK_REASON = 'BSI entfernt internen Fragment-Link; NIST-Orakel bewahrt ihn.';
const ORDER_REASON = 'BSI stellt hochgeleveltes Control ans Ende; NIST bewahrt die Quellposition des Ahnen.';

/** Vollständiges, festes Differenzregister aus der Owner-Konfliktregel. */
export const BSI_PROFILE_RESOLUTION_DIFFERENCES: readonly BsiCorpusDifference[] = Object.freeze([
  { corpusKey: 'lieferkette', controlId: 'DEV.4.3', member: 'links', href: '#TEST.3.1.8', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'DEV.4.2', member: 'links', href: '#DET.5.10.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'DEV.4.2', member: 'links', href: '#TEST.3.1.2', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'KONF.12.1', member: 'links', href: '#DEV.2.6.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'DLS.4.1.2', member: 'links', href: '#BER.1.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.7.4.4.1', member: 'links', href: '#TEST.3.1.8', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.7.4.3', member: 'links', href: '#KONF.2.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.7.4.3', member: 'links', href: '#KONF.10.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.7.2', member: 'links', href: '#TEST.1.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.6.2.1', member: 'links', href: '#ASST.7.3.2', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.5.9.1', member: 'links', href: '#TEST.4.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.4.9', member: 'links', href: '#PERS.3.6.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.4.5', member: 'links', href: '#DEV.1.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.4.5', member: 'links', href: '#DEV.2.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'ASST.5.6', member: 'links', href: '#SENS.8.6', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'KONF.2.4.2', member: 'controls', position: 'end', reason: ORDER_REASON },
  { corpusKey: 'diva', controlId: 'BES.3.2', member: 'links', href: '#BES.1.3', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BES.3.2', member: 'links', href: '#DLS.3.5', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BES.3.3', member: 'links', href: '#DEV.4.2', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BES.4.2', member: 'links', href: '#BES.2.1', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'TEST.3.1', member: 'links', href: '#DET.5.3', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'TEST.3.1.11', member: 'links', href: '#DET.5.2', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'TEST.4.1', member: 'links', href: '#BES.5.9.1', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.1.1', member: 'links', href: '#PERS.4.2', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.2.2', member: 'links', href: '#DET.2.1', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.2.4', member: 'links', href: '#ASST.3.11', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.2.4', member: 'links', href: '#KONF.3.7', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.2.8', member: 'links', href: '#DET.2.1.1', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.2.8', member: 'links', href: '#DET.2.1', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.3.2', member: 'links', href: '#DET.6.2.2', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.4.1', member: 'links', href: '#BER.7.5', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.9.3', member: 'links', href: '#ASST.3.10', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'SENS.10.3', member: 'links', href: '#REA.1.1', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BER.3.6', member: 'links', href: '#SENS.10.5', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BER.3.15', member: 'links', href: '#ASST.7.2', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BER.4.1.1', member: 'links', href: '#PERS.2.2', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BER.4.8', member: 'links', href: '#PERS.6.1', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BER.4.8', member: 'links', href: '#PERS.6.1.1', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BER.5.1', member: 'links', href: '#SENS.4.1.6', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'BER.6.4', member: 'links', href: '#SENS.4.1.3', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'DET.5.7', member: 'links', href: '#DET.5.6', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'DET.5.10.1', member: 'links', href: '#DEV.4.2', reason: LINK_REASON },
  { corpusKey: 'diva', controlId: 'KONF.2.5', member: 'links', href: '#KONF.2.1', reason: LINK_REASON },
  { corpusKey: 'wlan-gastnetze', controlId: 'ARCH.2.4', member: 'links', href: '#ASST.2.1', reason: LINK_REASON },
  { corpusKey: 'wlan-gastnetze', controlId: 'ARCH.4.1', member: 'links', href: '#DET.4.4', reason: LINK_REASON },
  { corpusKey: 'wlan-gastnetze', controlId: 'ARCH.4.1', member: 'links', href: '#DET.3.1.2', reason: LINK_REASON },
  { corpusKey: 'wlan-gastnetze', controlId: 'SENS.7.14', member: 'links', href: '#ASST.4.1', reason: LINK_REASON },
]);
