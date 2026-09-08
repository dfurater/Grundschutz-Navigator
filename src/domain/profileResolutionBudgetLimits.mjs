/**
 * Arbeitsgrenze der Profile Resolution (GSPP-345).
 *
 * Einzige Quelle der Wahrheit dieses Werts, aus demselben Grund wie
 * `class2ImportLimits.mjs`: Der Messapparat
 * (`scripts/measure-profile-resolution-budget.mjs`) braucht ihn in einer
 * nackten Node-Laufzeit ohne Aliasauflösung und ohne TypeScript. Der
 * Anwendungspfad liest ihn über `profileResolutionBudget.ts` weiter.
 *
 * Die AUSGABEGRENZEN stehen bewusst NICHT hier. Knoten, Tiefe und dekodierte
 * base64-Summe des laufenden Budgets sind dieselben Werte, die die
 * abschließende Postcondition prüft; sie kommen unverändert aus
 * `CLASS_2_IMPORT_LIMITS`. Eine zweite Zahl für dieselbe Grenze hieße, dass
 * laufendes Budget und Postcondition auseinanderlaufen können.
 *
 * Herleitung und Messprotokoll: `docs/OSCAL_VALIDATION.md`, Abschnitt
 * „`WORK_UNIT_LIMIT`". Der Wert ist kostenbasiert belegt — er folgt dem
 * gemessenen Zeitaufwand des ungünstigsten Falls, den die Grenze noch
 * zulässt, NICHT einem Vielfachen der BSI-Korpusgröße. Das Messartefakt liegt
 * unter `docs/measurements/gspp345-work-budget.json`.
 */

/**
 * KOSTENBASIERT HERGELEITET, nicht aus der Korpusgröße abgeleitet.
 *
 * Der Wert ist der größte GEMESSENE Stützpunkt, der den Budgetposten
 * „Sichtbare Wartezeit bis zum Ergebnis" (5 s) noch hält — erhoben am
 * 2026-09-08 in Chromium 151 bei vierfacher CPU-Drosselung als Näherung an
 * Bürohardware, dieselbe Messbasis wie die Ressourcengrenzen aus GSPP-382.
 * Er kostet dort 3,78 s und schöpft den Posten zu 76 % aus; der nächste
 * gemessene Stützpunkt (268 404 128) kostet 7,06 s und reißt ihn.
 *
 * Keine Interpolation, keine Hochrechnung: Der Wert steht auf einer Zahl, die
 * wirklich gemessen wurde. Messartefakt und Protokoll:
 * `docs/measurements/gspp345-work-budget.json` und `docs/OSCAL_VALIDATION.md`.
 *
 * WOGEGEN die Grenze schützt: Bytes begrenzen Arbeit nicht. Ein Profil an der
 * 10-MiB-Bytegrenze, das nur aus Ausschlussselektoren besteht, kauft
 * Milliarden von Arbeitseinheiten — bei der gemessenen Rate Minuten an
 * Rechenzeit für ein Dokument, das Byte-, Knoten- und Tiefengrenze mühelos
 * einhält. Genau diese Lücke schließt der Wert.
 *
 * WOGEGEN sie NICHT wirkt: Die legitime Nutzung liegt weit darunter. Das
 * teuerste der drei registrierten BSI-Profile kostet 206 592 Arbeitseinheiten,
 * rund ein Sechshundertfünfzigstel dieser Grenze (Korpuslauf
 * `scripts/profileResolutionCorpus.test.ts`). Der Kopfraum ist Nachweis, nicht
 * Begründung — die Reihenfolge ist wichtig, weil eine Grenze, die nur den
 * Kopfraum über der legitimen Nutzung belegt, über den Angriffsfall nichts
 * sagt.
 */
export const WORK_UNIT_LIMIT = 134_213_078;
