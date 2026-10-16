/**
 * Arbeitsgrenze der Profile Resolution (GSPP-345).
 *
 * Einzige Quelle der Wahrheit dieses Werts, als reines ESM-Modul wie
 * `class2ImportLimits.mjs`. Der Anwendungspfad liest ihn über
 * `profileResolutionBudget.ts`.
 *
 * Die AUSGABEGRENZEN stehen bewusst NICHT hier. Knoten, Tiefe und dekodierte
 * base64-Summe des laufenden Budgets sind dieselben Werte, die die
 * abschließende Postcondition prüft; sie kommen unverändert aus
 * `CLASS_2_IMPORT_LIMITS`. Eine zweite Zahl für dieselbe Grenze hieße, dass
 * laufendes Budget und Postcondition auseinanderlaufen können.
 *
 * Grenzwert, Schutzzweck und prüfende Tests: `docs/OSCAL_VALIDATION.md`,
 * Abschnitt „`WORK_UNIT_LIMIT`".
 */

/**
 * Obergrenze der Arbeitseinheiten eines Auflösungslaufs, summiert über alle
 * sechs Work-Unit-Kategorien.
 *
 * WOGEGEN die Grenze schützt: Bytes begrenzen Arbeit nicht. Jeder Selektor
 * läuft über jede Control-ID des importierten Katalogs, die Arbeit ist also
 * das Produkt aus beiden Zahlen, während die Bytegrenze nur ihre Summe
 * deckelt. Ein Profil, das Byte-, Knoten- und Tiefengrenze einhält, kann so
 * ein Vielfaches dieses Werts an Arbeitseinheiten verlangen.
 * `profileResolutionBudget.enforcement.test.ts` hält am öffentlichen Resolver
 * fest, dass ein solches Profil mit leerer Ausgabe an dieser Grenze abbricht.
 *
 * WOGEGEN sie NICHT wirkt: die legitime Nutzung. Das teuerste der drei
 * registrierten BSI-Profile kostet 207 595 Arbeitseinheiten, rund ein
 * Achtzigstel dieser Grenze; der Korpuslauf
 * `scripts/profileResolutionCorpus.test.ts` verlangt, dass jedes registrierte
 * Profil unter ihr bleibt.
 */
export const WORK_UNIT_LIMIT = 16_763_456;
