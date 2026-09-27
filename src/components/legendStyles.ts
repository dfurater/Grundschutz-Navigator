/**
 * Legendenschema der Detailansicht (Owner 26.09.2026): Jede aufklappbare
 * Erklärung – Blocklegende wie Begriffskarte – steht in einer eigenen Karte.
 * Je Eintrag zuerst „Merkmal: Wert“, darunter die Erklärung.
 */
export const legendCardClass =
  'space-y-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] px-3 py-2.5 text-xs leading-relaxed text-slate-600';

/** Zeile „Merkmal: Wert“ (Merkmal fett, Wert als Link). */
export const legendTermClass = 'font-semibold text-slate-800';

export const legendLinkClass =
  'rounded text-primary-main hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]';

/*
 * Abstände aufgeklappter Erklärungen (Owner 26.09.2026): Die Karte steht 6 px
 * unter der Zeile ihres Auslösers (`mt-1.5` an der Karte, Legenden unter der
 * Leiste mit deren Inhaltsabstand) und hält 12 px zum nächsten Inhalt. Nach
 * Gruppen, Blöcken und dem Satz folgt ohnehin mindestens 12 px; nur enge
 * Stapel brauchen die Klassen unten. Markiert wird die Karte über
 * `data-vocab-card`.
 */

/** Enger Stapel (z. B. Listenzeilen mit 6 px): Karten in allen Einträgen außer dem letzten halten 12 px zum nächsten. */
export const tightStackClass = '[&>:not(:last-child)_[data-vocab-card]]:mb-3';

/** Behälter, auf den immer eng weiterer Inhalt folgt (Pfad über dem Titel): Karten darin halten 12 px. */
export const beforeTightContentClass = '[&_[data-vocab-card]]:mb-3';
