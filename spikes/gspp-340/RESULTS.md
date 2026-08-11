# GSPP-340 — Messergebnis Dexie gegen idb

> **SPIKE — NICHT MERGEN.** Dieser Bericht und der zugehörige Vergleichscode bleiben auf dem Spike-Branch. Sie sind Messwerkzeug für [GSPP-340](https://linear.app/grundschutz-plus-plus/issue/GSPP-340), kein produktiver Persistenzvertrag.

## Ergebnis

**Auswahl: Dexie 4.4.4.** Beide Kandidaten erfüllen den gemeinsamen Pflichtvertrag für Migration, Export/Restore, vollständige Löschung und Netzwerkfreiheit. Dexie verlangt in diesem Vergleich 174 kandidatenspezifische Codezeilen, `idb` 222. Die Differenz von 48 Zeilen verteilt sich vor allem auf die sicherheits- und datenschutzrelevante Schema-Migration (+18 Zeilen bei `idb`), das Öffnen und Versionieren (+16) sowie die Index- und Cache-Bereinigung (+10).

Der Nachteil ist ein deutlich größeres Produktionsbundle: Dexie erhöht den gemeinsamen minifizierten Baseline-Build um 36.803 gzip-Bytes, `idb` um 2.991 gzip-Bytes. Diese Differenz von 33.812 Bytes ist materiell. Nach der Prioritätenfolge des Projekts überwiegt trotzdem die geringere langfristige Eigenbau- und Migrationslast: Die Lösch-, Migrations- und Transaktionslogik liegt näher an einem dafür vorgesehenen, versionierten Persistenzmodell und muss nicht in gleichem Umfang über dem dünnen IndexedDB-Wrapper selbst dauerhaft getragen werden.

Die Auswahl ist eine Implementierungsentscheidung im Rahmen von [ADR-5](https://linear.app/grundschutz-plus-plus/issue/ADR-5). Sie ändert nicht die Architekturgrenze aus [ADR-3](https://linear.app/grundschutz-plus-plus/issue/ADR-3): lokale IndexedDB-Persistenz, keine Cloud und vollständige Löschbarkeit. Dexie Cloud wurde weder installiert noch verwendet.

## Gemeinsamer Prüfvertrag

Beide Adapter liefen unverändert gegen dieselbe parametrisierte Chromium-Suite. Geteilt wurden ausschließlich Vertragstypen, synthetische Fixtures, Assertions, Egress-Orakel und Messmethodik. Öffnen/Versionieren, Migration, Transaktionen, CRUD, Export/Restore und Löschung wurden je Kandidat getrennt und idiomatisch implementiert.

Der synthetische Envelope trägt:

- den lokal vergebenen Schlüssel `localId`, getrennt von der OSCAL-Dokument-`uuid`,
- das rohe OSCAL-`source`,
- die daraus abgeleitete `view`,
- einen zeitweiligen `exportDraft`,
- die Speicher-Schemaversion und
- die davon unabhängige OSCAL-Modellversion.

Die Migration verschiebt in Speicher-Schema v2 nur `view` und `exportDraft` unter `derived`. Das OSCAL-Catalog-Root-Modell in `source.catalog` bleibt wertgleich. Insbesondere bleiben sowohl der Envelope-Wert `oscalVersion` als auch `source.catalog.metadata.oscal-version` unverändert. Der vollständige minimale v1-Vertrag wird vor der Transformation geprüft; Lesen, Validieren und Schreiben geschehen atomar in der `versionchange`-Transaktion. Ein während des Upgrades noch commitender v1-Writer wird von beiden Kandidaten verlustfrei mitmigriert. OSCAL selbst definiert weder IndexedDB noch einen Arbeitsbereich; die gemessene Migration liegt ausschließlich in der lokalen Werkzeug-/Persistenzschicht.

## Pflichtnachweise

| Nachweis | Dexie 4.4.4 | idb 8.0.3 |
| --- | --- | --- |
| Migration Speicher-Schema v1 → v2 | Bestanden | Bestanden |
| `metadata.oscal-version` bleibt unverändert | Bestanden | Bestanden |
| Unvollständiger v1-Datensatz scheitert erklärbar | Bestanden | Bestanden |
| Export/Restore semantisch gleich | Bestanden | Bestanden |
| Einzellöschung aus Store, Index und Cache | Bestanden | Bestanden |
| Vollständige Arbeitsbereichslöschung | Bestanden | Bestanden |
| Blockierte Löschung bricht nach 2 Sekunden ab | Bestanden | Bestanden |
| Regulärer Kandidatenlauf ohne Egress | Bestanden | Bestanden |

Der Lifecycle-Negativnachweis läuft je Transport in einem eigenen inneren Chromium-Lauf. Der Testkörper wirft nicht selbst und wartet den Request nicht ab. Ausschließlich der immer aktive `afterEach`-Guard erzeugt den erwarteten Fehler:

- `fetch`: exakt ein `[BROWSER_EGRESS_BLOCKED] GET` gegen eine aus der Loopback-Origin abgeleitete URL,
- `navigator.sendBeacon`: exakt ein `[BROWSER_EGRESS_BLOCKED] POST` gegen eine aus der Loopback-Origin abgeleitete URL.

Ein unerwartet grüner innerer Lauf, ein zusätzlicher Fehler, ein Timeout, ein Signal oder ein Fehler ohne den Marker lässt den äußeren Nachweis scheitern.

## Kandidatenspezifischer Codeumfang

Zählregel: physische, nichtleere und nicht ausschließlich kommentierende TypeScript-Zeilen. Gemeinsame Typen, Fixtures, Tests und Messskripte werden separat ausgewiesen und keinem Kandidaten zugerechnet. Reproduzierbar mit `npm run measure:gspp-340`.

| Funktionsbereich | Dexie | idb | Differenz idb − Dexie |
| --- | ---: | ---: | ---: |
| Scaffolding | 11 | 12 | +1 |
| Schema-Migration | 52 | 70 | +18 |
| Öffnen und Versionieren | 32 | 48 | +16 |
| CRUD | 13 | 15 | +2 |
| Export/Restore | 15 | 15 | 0 |
| Einzel- und Gesamtlöschung | 23 | 23 | 0 |
| Index- und Cache-Bereinigung | 21 | 31 | +10 |
| Transaktions-/Fehlerbehandlung | 7 | 8 | +1 |
| **Gesamt** | **174** | **222** | **+48** |

Der gemeinsam ausgewiesene Mess- und Testcode umfasst 1.004 Zeilen. Er ist bewusst nicht Teil der Kandidatendifferenz.

## Produktionsbundle

Das Messskript erzeugt drei ansonsten identische, mit Vite 8 und Oxc minifizierte ES-Library-Builds in einem temporären Verzeichnis und räumt diese immer auf. Gemessen wird der vollständige Adapter einschließlich der tatsächlich eingebundenen Bibliothek.

| Build | Rohbytes | gzip-Bytes | Rohdelta zur Baseline | gzip-Delta zur Baseline |
| --- | ---: | ---: | ---: | ---: |
| Gemeinsame Baseline | 0 | 20 | 0 | 0 |
| Dexie | 134.950 | 36.823 | +134.950 | +36.803 |
| idb | 9.033 | 3.011 | +9.033 | +2.991 |

Die Werte messen den Spike-Adapter, nicht das noch zu definierende Produktionsschema aus [GSPP-290](https://linear.app/grundschutz-plus-plus/issue/GSPP-290). Sie sind deshalb eine belastbare Kandidatendifferenz, aber keine Vorhersage der endgültigen Chunk-Größe.

## Registry-, Lizenz- und Wartungsstand

Am 2026-08-11 unmittelbar vor der Messung gegen die npm-Registry verifiziert:

| Kandidat | Gepinnte und aktuelle Version | Lizenz | Registry zuletzt geändert | Laufzeitabhängigkeiten | Ungepackte Paketgröße |
| --- | --- | --- | --- | --- | ---: |
| `dexie` | 4.4.4 | Apache-2.0 | 2026-06-16T18:40:48.288Z | keine | 3.234.517 Bytes |
| `idb` | 8.0.3 | ISC | 2025-05-07T08:12:54.691Z | keine | 82.779 Bytes |

Beide Pakete sind im Spike exakt gepinnte `devDependencies`. Dieser Branch führt keine produktive Persistenz ein. Vor einer späteren produktiven Aufnahme gelten weiterhin die vollständigen Zulassungsregeln aus [ADR-5](https://linear.app/grundschutz-plus-plus/issue/ADR-5).

## Sicherheits- und Datenschutzbewertung

- Alle Fixtures sind synthetisch; es werden keine Organisations- oder Personendaten verarbeitet.
- Der Browser-Egress-Guard bleibt über den vollständigen Testlebenszyklus aktiv.
- Einzellöschung prüft Store-Werte, Indexschlüssel und den app-internen Cache auf eine eindeutige Sentinel-Zeichenkette.
- Gesamtlöschung prüft zusätzlich die Abwesenheit der Datenbank über `indexedDB.databases()`.
- Offene Fremdverbindungen führen bei beiden Kandidaten nach zwei Sekunden zu einem erklärbaren Fehler statt zu einem unbefristet hängenden Löschvorgang.

## Grenzen des Ergebnisses

- Der Prüfvertrag ist absichtlich minimal und präjudiziert den Persistenzvertrag aus [GSPP-290](https://linear.app/grundschutz-plus-plus/issue/GSPP-290) nicht.
- Es wurde genau ein Dokument-Store betrachtet. Weitere Stores, Indizes und abgeleitete Caches müssen im späteren Persistenzdesign erneut vollständig in die Löschzusage aufgenommen werden.
- Die Empfehlung bewertet die gemessene Eigenbau- und Bundle-Differenz. Sie ersetzt weder die produktive Datenmodellierung noch eine erneute Zulassungsprüfung der später tatsächlich aufgenommenen Paketversion.
