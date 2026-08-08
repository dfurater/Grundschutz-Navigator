// =============================================================================
// Vertrauensklasse und Ableitungskontext eines OSCAL-Dokuments (ADR-2)
//
// Beides gehört zusammen und ist bewusst von `models.ts` getrennt: Es ist die
// Information, die ein Dokument **nicht** über sich selbst liefert. Der
// Root-Dispatch (GSPP-285) nimmt sie entgegen und führt sie mit — er rät sie
// nicht und leitet sie nie aus dem Dokumentinhalt ab.
// =============================================================================

import type { CatalogKey } from '@/domain/sourceRegistry';

/**
 * Vertrauensklasse eines Dokuments (ADR-2 §10, präzisiert durch ADR-6).
 *
 * Die Klassen werden nie vermischt: Klasse 2 läuft nicht über den
 * Manifest-/Hash-Mechanismus, und die Provenienzanzeige suggeriert für sie
 * keine Verifikation.
 *
 * Klasse 1 ist in zwei Zustände aufgeteilt, weil ihre Definition die
 * Laufzeit-Hashprüfung einschließt: Ein Dokument aus dem Quellregister ist
 * erst dann `verified`, wenn diese Prüfung tatsächlich bestanden wurde.
 * Fehlen die Integritätsmetadaten oder weicht der Hash ab, bleibt es
 * `unverified` — die Anwendung nutzt es weiter, behauptet aber keine
 * Verifikation.
 */
export type TrustClass =
  | 'class-1-verified-public'
  | 'class-1-unverified-public'
  | 'class-2-local-user';

/**
 * Expliziter, typisierter Ableitungskontext jedes OSCAL-Dokuments (ADR-2 §2).
 *
 * Der Kontext ist nicht implizit und nicht global; er wird als Parameter
 * gereicht und ist prüfbar.
 */
export interface OscalDocumentContext {
  /** Vertrauensklasse nach ADR-2 §10; wird entgegengenommen, nie vergeben */
  trustClass: TrustClass;
  /**
   * Upstream-Pfad des Artefakts im Quellregister (ADR-1). Trifft er einen
   * registrierten Eintrag, prüft der Dispatch den gefundenen Root gegen
   * `getExpectedRootType()` und benennt den Artefaktschlüssel in Diagnosen.
   */
  upstreamPath?: string;
  /**
   * Katalogidentität nach ADR-1 — nur für Katalogwurzeln gesetzt. Andere
   * Modelle bringen ihre Identität in eigenen, fokussierten Kontexten mit.
   */
  catalogKey?: CatalogKey;
}

/** Ableitungskontext eines Katalogdokuments: `catalogKey` ist hier Pflicht. */
export interface CatalogDocumentContext extends OscalDocumentContext {
  catalogKey: CatalogKey;
}
