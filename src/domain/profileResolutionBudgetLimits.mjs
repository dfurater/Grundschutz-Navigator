/**
 * Arbeitsgrenze der Profile Resolution (GSPP-345).
 *
 * Einzige Quelle der Wahrheit dieses Werts, aus demselben Grund wie
 * `class2ImportLimits.mjs`: Der Messapparat
 * (`scripts/measure-class2-budget.mjs`) braucht ihn in einer
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
 * gemessenen Zeitaufwand des ungünstigsten Falls JEDER Work-Unit-Kategorie,
 * NICHT einem Vielfachen der BSI-Korpusgröße. Das Messartefakt liegt
 * unter `docs/measurements/gspp345-work-budget.json`.
 */

/**
 * KOSTENBASIERT HERGELEITET, nicht aus der Korpusgröße abgeleitet.
 *
 * Der Wert ist der größte GEMESSENE Stützpunkt, den ALLE SECHS
 * Work-Unit-Kategorien halten — erhoben am 2026-09-12 in Chromium 151 bei
 * vierfacher CPU-Drosselung als Näherung an Bürohardware, dieselbe Messbasis
 * wie die Ressourcengrenzen aus GSPP-382. Maßgeblich ist der Budgetposten
 * „Sichtbare Wartezeit bis zum Ergebnis" (5 s).
 *
 * WARUM SECHS REIHEN UND NICHT EINE. Alle Kategorien verbrauchen denselben
 * Zähler, aber eine Arbeitseinheit kostet je nach Kategorie unterschiedlich
 * viel Zeit. Die Vorgängerfassung dieses Werts stand auf 134 213 078 und war
 * allein am Selektorpfad gemessen; die `merge-step`-Reihe braucht für
 * dieselbe Einheitenzahl das Achtfache an Zeit und riss den Posten deutlich.
 * Der Wert hier ist das fail-closed Minimum über die Reihen: `merge-step`
 * hält 16 763 456 Einheiten in 2,62 s, der nächste gemessene Stützpunkt
 * (33 546 920) kostet 5,26 s und reißt.
 *
 * `alter-target-lookup` geht nicht in das Minimum ein: Ihr ungünstigstes
 * Steuerdokument erreicht bei voll ausgeschöpfter Byte- und Knotengrenze
 * höchstens 6 232 007 Arbeitseinheiten und kann die Arbeitsgrenze deshalb nie
 * treiben — sie ist bereits durch die Dokumentgrenzen gedeckt.
 *
 * Keine Interpolation, keine Hochrechnung: Der Wert steht auf einer Zahl, die
 * wirklich gemessen wurde. Messartefakt und Protokoll:
 * `docs/measurements/gspp345-work-budget.json` und `docs/OSCAL_VALIDATION.md`.
 *
 * DIESE ZAHL IST NICHT FREI WÄHLBAR. `measureClass2BudgetReport.test.ts`
 * leitet sie bei jedem Testlauf aus dem committeten Artefakt neu her und
 * verlangt Gleichheit; zusätzlich muss der Kandidat des Artefakts echt über
 * ihr liegen, weil ein Lauf nur bis zu seinem eigenen Kandidaten misst und ein
 * Artefakt mit gleichem Kandidaten den Wert deshalb nicht belegen könnte. Wer
 * hier eine Zahl ändert, ohne neu zu messen, macht den Testlauf rot.
 *
 * WOGEGEN die Grenze schützt: Bytes begrenzen Arbeit nicht. Ein Profil an der
 * 10-MiB-Bytegrenze, das nur aus Ausschlussselektoren oder aus Importen
 * besteht, kauft Hunderte Millionen bis Milliarden Arbeitseinheiten — bei den
 * gemessenen Raten Minuten an Rechenzeit für ein Dokument, das Byte-, Knoten-
 * und Tiefengrenze mühelos einhält. Genau diese Lücke schließt der Wert.
 *
 * WOGEGEN sie NICHT wirkt: Die legitime Nutzung liegt weit darunter. Das
 * teuerste der drei registrierten BSI-Profile kostet 207 595 Arbeitseinheiten,
 * rund ein Achtzigstel dieser Grenze (Korpuslauf
 * `scripts/profileResolutionCorpus.test.ts`). Der Kopfraum ist Nachweis, nicht
 * Begründung — die Reihenfolge ist wichtig, weil eine Grenze, die nur den
 * Kopfraum über der legitimen Nutzung belegt, über den Angriffsfall nichts
 * sagt.
 */
export const WORK_UNIT_LIMIT = 16_763_456;
