# Persistenzvertrag für lokale Arbeitsbereiche

Dieser Vertrag legt verbindlich fest, wie der Navigator lokale Nutzerdokumente speichert, versioniert, referenziert, exportiert und löscht — und wo die Grenzen dieses Schutzes liegen.

Welches Schema für ein Dokument gilt, steht in der [Versionsmatrix](OSCAL_VERSION_MATRIX.md); womit und wo validiert wird, im [Validierungsvertrag](OSCAL_VALIDATION.md); wie die Integritätskette der öffentlichen BSI-Artefakte funktioniert, in [INTEGRITY.md](INTEGRITY.md).

## Status: Vorgabe, keine Umsetzung

Es gibt keine Import-UI, keine Persistenz und keinen Arbeitsbereich-Speicher im Code: kein Dexie, keine IndexedDB-Datenbank `gspp-workspace`, keine Stores, kein Envelope, keine Migration. Die Datenschutzseite stellt fest, dass die Anwendung keine fachlichen Nutzungsdaten in `localStorage`, `sessionStorage` oder vergleichbaren Browser-Speichern hält (`src/features/pages/DatenschutzPage.tsx`).

Umgesetzt ist die Eingangsseite des Vertrags:

- Klasse-2-Eingangsgrenze `CLASS_2_IMPORT_LIMITS` (`src/domain/class2ImportLimits.mjs`: `maxBytes` 10 MiB, `maxDepth` 64, `maxNodes` 1 000 000, `maxDecodedBase64Bytes` 4 MiB), fail-closed über `oscalClass2Import.ts` und `oscalImportContract.ts`
- Vertrauensklassen `class-1-verified-public`, `class-1-unverified-public`, `class-2-local-user` (`src/domain/oscalDocumentContext.ts`); die Laufzeit-Hashprüfung stuft auf `class-1-unverified-public` herab ([INTEGRITY.md](INTEGRITY.md))
- Schemawahl ausschließlich über `metadata.oscal-version` (`resolveSchemaBinding` in `src/domain/oscalVersionMatrix.mjs`), ohne Fallback auf eine Nachbarversion
- Lifecycle-Gate im Register: Nur `supported`-Artefakte werden materialisiert und durchlaufen die Laufzeit-Hashprüfung (`src/domain/sourceRegistry.mjs`)
- No-op-Round-trip-Harnisch für die Klasse-2-Pipeline (`src/test/oscalRoundTrip.ts`)

Alles unterhalb dieses Abschnitts ist bindende Vorgabe für die erste Speicherfunktion, kein Ist-Zustand. Wo ein Element bereits eine Code-Grundlage hat, ist sie genannt; der Rest (`derivedFrom`, Stores, Transaktionen, Migration, Löschung, Orakel) wartet auf Umsetzung.

## 0. Was OSCAL vorgibt und was dieses Projekt erfindet

| Herkunft | Gegenstand |
| --- | --- |
| **NIST-Vorgabe** | Die Pflichtmetadaten `title`, `last-modified`, `version`, `oscal-version`; `metadata.revisions` als Ort für Versionsstände; `last-modified` als Speicher-, nicht Bearbeitungszeitpunkt; die je Root-Modell unterschiedliche Persistenz der Dokument-UUID (siehe §5, [Quellen](#quellen)) |
| **Projektentscheidung** | Der Arbeitsbereich als Konstrukt; die Vertrauensklassen 1 und 2; der lokale Speicherschlüssel; die Speicher-Schemaversion; die Bindung von `href`-Werten an lokale Dokumente; Retention, Löschung und Quota-Politik |

**OSCAL kennt weder Persistenz noch einen Arbeitsbereich noch ein Vertrauensmodell.** Die Trennung ist vom Projekt zu tragen, zu implementieren und zu testen.

## 1. Dateninventar und Datenfluss

| Datenart | Ort | Kopien | Zugriff | Löschzeitpunkt |
| --- | --- | --- | --- | --- |
| Originaldokument (`source`) | IndexedDB `gspp-workspace`, Store `documents` | eine dauerhafte | Browserprofil des Geräts | Einzel- oder Gesamtlöschung |
| Read-Model (`view`) | ausschließlich Arbeitsspeicher | keine dauerhafte | laufender Tab | Verlassen der Seite |
| Abgeleitete Indizes | IndexedDB, Indizes der Stores | Teilwerte aus `source` | wie Store | mit dem Store |
| Laufende Bearbeitung / Export-Draft | IndexedDB, Store `drafts` | eine, kurzlebig | wie Store | mit dem Dokument, spätestens beim Verwerfen |
| Referenzbindungen | IndexedDB, Store `bindings` | Verweise, keine Inhalte | wie Store | mit dem Dokument auf beiden Seiten |
| Werkzeughistorie | IndexedDB, Store `toolHistory` (optional, siehe §9) | Zwischenstände | wie Store | mit dem Dokument |
| Arbeitsbereichsmetadaten | IndexedDB, Store `workspaceMeta` | eine | wie Store | Gesamtlöschung |
| Klasse-2-Suchindex | ausschließlich Arbeitsspeicher | abgeleitet | laufender Tab | Verlassen der Seite |
| Exportdatei | Dateisystem des Nutzers | beliebig viele | Nutzer und wer sein Gerät erreicht | **außerhalb der Reichweite der Anwendung** (§12) |

### Freitextfelder als eigene Kategorie

`remarks`, `part.prose` und `description` existieren quer durch alle Root-Modelle und sind inhaltlich nicht eingrenzbar; dort können besondere Kategorien personenbezogener Daten landen. Diese Kategorie wird in Löschung (§12) und Grenzaussagen (§13) mitgeführt.

### Datenfluss

```
Datei des Nutzers
  → Klasse-2-Eingangsgrenze (Größen-, Tiefen-, Knotenlimits; fail-closed)
  → Envelope mit source
  → Store documents
  → view (nur Arbeitsspeicher, jederzeit neu ableitbar)
  → Anzeige
```

Es gibt **keinen** Rückweg aus dem Arbeitsbereich nach außen außer dem vom Nutzer ausgelösten Export. Dokumentinhalte gelangen nicht in URL-Parameter, Filter- oder Suchzustände, Konsolenausgaben, Fehlermeldungen oder Diagnoseansichten. Der URL-Sync der Katalogfilter bleibt auf Klasse 1 beschränkt.

## 2. Strukturelle Trennung der beiden Datenklassen

**Klasse 1 bekommt im Arbeitsbereich keinen Store.** Der Arbeitsbereich kann Klasse-1-Inhalte nicht aufnehmen, weil es keinen Ort dafür gibt ([ADR-3](https://linear.app/grundschutz-plus-plus/issue/ADR-3)).

Öffentliche BSI-Artefakte kommen ausschließlich aus `public/data/` über den Fetch- und Hashpfad aus [INTEGRITY.md](INTEGRITY.md). Im Arbeitsbereich liegt allenfalls ein Verweis (`artifactKey`), niemals ein Inhalt. Daraus folgt:

- Ein Klasse-2-Dokument läuft nie über den Manifest-/Hash-Mechanismus.
- Ein Klasse-2-Dokument erbt keine Provenienz- oder Hashindikatoren.
- Die Anwendung führt Klasse-2-Dokumente dauerhaft als lokal und unverifiziert.

Der letzte Punkt ist eine Modelltatsache: `hash` existiert im OSCAL-Modell ausschließlich unter `back-matter/resource/rlinks/hashes` und beschreibt dort eine *referenzierte* Ressource. Ein Dokument-Selbsthash existiert nicht; ein Verifikationsindikator im Sinne von Klasse 1 ist für ein lokales Dokument **prinzipiell unmöglich**.

## 3. Speichervertrag

### Datenbank und Stores

Eine IndexedDB-Datenbank `gspp-workspace`. Festgelegte Abstraktion: **Dexie** ([GSPP-340](https://linear.app/grundschutz-plus-plus/issue/GSPP-340)); die Wahl ersetzt keine fachliche Regel dieses Vertrags.

| Store | Schlüssel | Inhalt |
| --- | --- | --- |
| `documents` | `localId` | Envelope einschließlich `source` |
| `drafts` | `localId` | laufende Bearbeitung, Export-Draft |
| `bindings` | `[fromLocalId, pointer]` | explizite Referenzbindungen (§7) |
| `toolHistory` | `[localId, sequence]` | Werkzeughistorie, optional (§9) |
| `workspaceMeta` | fester Schlüssel | `storageSchemaVersion`, Zeitstempel |

Indizes auf `documents`: `rootType`, `oscalVersion`, `savedAt`. Indizes tragen ausschließlich Ordnungs- und Filterwerte, niemals Freitext aus Klasse-2-Inhalten.

**Das `view` wird nicht persistiert.** [ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2) bestimmt es als Projektion, nicht als Wahrheit; es wird beim Laden abgeleitet und nur im Arbeitsspeicher gehalten.

### Envelope

| Feld | Bedeutung |
| --- | --- |
| `localId` | lokal vergebener, stabiler Speicherschlüssel (§5) |
| `storageSchemaVersion` | Version der **Speicherstruktur**, nicht des Dokuments (§6) |
| `rootType` | einer der acht OSCAL-Root-Keys |
| `oscalVersion` | Kopie aus `source.<root>.metadata.oscal-version`, für die Schemawahl beim Laden |
| `trustClass` | stets `class-2-local-user` |
| `documentState` | `imported` \| `draft` \| `export-ready` (§4) |
| `derivedFrom` | Herkunft bei Übernahme aus dem Quellregister, sonst nicht gesetzt (§8) |
| `createdAt`, `savedAt` | **Werkzeug**zeitstempel, getrennt von `metadata.last-modified` (§9) |
| `source` | das rohe, verlustfreie OSCAL-Dokument |

Alle Envelope-Felder sind Projektkonstrukte. Keines wird jemals in ein exportiertes OSCAL-Dokument geschrieben, und keines wird jemals aus einem importierten Dokument gelesen.

### Transaktionsgrenzen

Eine fachliche Operation ist genau eine IndexedDB-Transaktion. Es gibt keinen Zustand, in dem ein Dokument gespeichert ist, seine Bindungen aber nicht — oder umgekehrt.

| Operation | umfasst |
| --- | --- |
| Dokument speichern | `documents`, `bindings` (alle in diesem Vorgang geänderten), `drafts` (Verwerfen), `toolHistory` (soweit fortgeschrieben) |
| Autosave eines Entwurfs | `drafts`, `toolHistory` (soweit fortgeschrieben) |
| Übernahme aus dem Quellregister (§8) | `documents`, `bindings` (soweit dabei gesetzt) |
| Dokument löschen | `documents`, `drafts`, `bindings` beider Richtungen, `toolHistory` |
| Backup wiederherstellen | `documents`, `bindings`, `workspaceMeta` |
| Migration | alle Stores, ein einziger `versionchange` |

Indizes gehören zu ihrem Store und werden mit ihm geschrieben. **Regelform statt Aufzählung:** Jede Operation, die eine Bindung anlegt, ändert oder entfernt, führt `bindings` in **derselben** Transaktion wie das betroffene Dokument — auch bei später hinzukommenden Operationen. Bricht eine Transaktion ab, gilt der Vorzustand; es gibt keine Teilübernahme.

### Mengengrenzen und Quota

- Je Dokument gilt die Eingangsgrenze aus `src/domain/class2ImportLimits.mjs` (`maxBytes` 10 MiB, `maxDepth` 64, `maxNodes` 1 000 000). Der Speicher senkt sie nicht und hebt sie nicht an.
- Die Zahl gleichzeitig **gehaltener** `source`-Graphen im Arbeitsspeicher ist begrenzt; nicht angezeigte Dokumente werden entlassen und bei Bedarf neu geladen ([ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2)).
- Bei erschöpftem Browser-Quota wird der Schreibvorgang **abgelehnt**, nicht teilweise ausgeführt. Der Nutzer erhält eine Vorwarnung und den Hinweis auf den Export.
- Es gibt **keine automatische Verdrängung**. Stille Datenverwerfung ist ausgeschlossen.

## 4. Dokumentzustände

Ein `profile` braucht mindestens einen `import`, ein `system-security-plan` braucht `import-profile`, `system-characteristics`, `system-implementation` und `control-implementation`. Es gibt kein gültiges leeres Profil; ein Gate, das nur „valide oder abgelehnt" kennt, blockierte jedes Authoring.

| Zustand | Bedeutung | Validierung |
| --- | --- | --- |
| `imported` | fremdes Dokument, gerade eingelesen | fail-closed, streng |
| `draft` | lokaler Entwurf in Arbeit | Unvollständigkeit zulässig, **nicht exportierbar** |
| `export-ready` | vollständig, exportfähig | voll validiert |

Ein Dokument ohne die Pflichtmetadaten aus §0 erreicht `export-ready` nicht.

## 5. Identitäten

### Der Speicherschlüssel ist nie die Dokument-UUID

`localId` ist ein von der Anwendung vergebener, über die Lebensdauer des Dokuments stabiler Identifikator. Er wird nie exportiert und nie aus einem Dokument gelesen. Die Begründung ist zweistufig:

- Bei `catalog`, `profile`, `component-definition` und `mapping-collection` wechselt die Dokument-UUID beim fachlichen Schreibvorgang; als Primärschlüssel erzeugte sie je Änderung einen neuen Datensatz.
- Bei `system-security-plan`, `assessment-plan`, `assessment-results` und `plan-of-action-and-milestones` ist die UUID zwar stabil gemeint, aber als Klasse-2-Wert unvertraut: duplizierbar durch Kopieren, kollidierbar beim Re-Import, veränderbar durch den Nutzer.

### Root-UUID-Politik je Root-Modell

Verifiziert gegen alle acht Metaschemas im Tag [`v1.2.2`](https://github.com/usnistgov/OSCAL/tree/v1.2.2/src/metaschema) (siehe [Quellen](#quellen)).

| Root-Modell | Deklaration in v1.2.2 | Politik der Anwendung |
| --- | --- | --- |
| `catalog` | `identifier-persistence="change-on-write"` | **neu vergeben** beim fachlichen Schreibvorgang |
| `profile` | `identifier-persistence="change-on-write"` | **neu vergeben** beim fachlichen Schreibvorgang |
| `component-definition` | `identifier-persistence="change-on-write"` | **neu vergeben** beim fachlichen Schreibvorgang |
| `mapping-collection` | kein `prop`; Beschreibung: „This UUID should be changed when this document is revised." | **neu vergeben** beim fachlichen Schreibvorgang |
| `system-security-plan` | per-subject | **nie** neu vergeben |
| `assessment-plan` | per-subject | **nie** neu vergeben |
| `assessment-results` | per-subject | **nie** neu vergeben |
| `plan-of-action-and-milestones` | per-subject, Scope `instance` | **nie** neu vergeben |

Für die vier per-subject-Modelle ist dies eine **Normanforderung**: Ein Neuvergeben bräche die Zusage, dass die UUID dasselbe Subjekt über Revisionen hinweg identifiziert. Die Anwendung übernimmt die vorgefundene UUID unverändert; ist sie abwesend oder syntaktisch ungültig, wird das Dokument nicht als `export-ready` geführt, statt eine UUID zu erfinden. Der Neuvergabezeitpunkt der ersten vier ist der fachliche Schreibvorgang (§9), nicht das Autosave.

## 6. Zwei Versionsbegriffe

| Begriff | Ort | Gehört | Wird verändert durch |
| --- | --- | --- | --- |
| **OSCAL-Modellversion** | `source.<root>.metadata.oscal-version` | dem Dokument | nichts in diesem Vertrag |
| **Speicher-Schemaversion** | `envelope.storageSchemaVersion`, `workspaceMeta` | dem Werkzeug | Migration (§10) |

**Eine Speicher-Migration verändert die `oscal-version` eines Dokuments niemals.** Das ist die tragende Invariante dieses Vertrags und das Migrationsorakel aus §14.

### Dokumente unterschiedlicher OSCAL-Versionen nebeneinander

Der Arbeitsbereich hält Dokumente jeder OSCAL-Version unverändert nebeneinander; es findet **keine Vereinheitlichung** statt. Beim Laden wählt `resolveSchemaBinding({ rootType, oscalVersion })` aus [`oscalVersionMatrix.mjs`](../src/domain/oscalVersionMatrix.mjs) das gepinnte NIST-Schema — umgesetzt, ohne Fallback:

- `metadata.oscal-version` ist die alleinige Versionsautorität. `$schema` ist zulässig, wählt aber nie aus.
- Für eine unmögliche Kombination — etwa `mapping-collection` unterhalb 1.2.0 — wird fail-closed abgelehnt, weil für diese Kombination kein Schema existiert.

## 7. Referenzen und Bindungen

`import-profile`, `import-ssp` und `import-ap` tragen `href`-Werte. Die Abbildung eines `href` auf ein gespeichertes Dokument ist ein Projektkonstrukt.

**Die Bindung ist explizit und liegt im Envelope, nie im Dokument.** Der `href`-Wert in `source` bleibt unverändert — andernfalls bräche der No-op-Round-trip aus ADR-2.

```
BindingTarget = { kind: 'local',   localId:    LocalId }
              | { kind: 'class-1', artifactKey: ArtifactKey }
```

Der zweite Zieltyp ist nötig, weil ein lokaler SSP mit `import-profile` typischerweise auf ein **öffentliches BSI-Profil** zeigt. Gespeichert wird der Verweis, nie der Inhalt. Verbindlich gilt:

- **Kein impliziter Auflösungsversuch.** Ohne gesetzte Bindung wird nicht aufgelöst — weder über die Dokument-UUID noch über Namensähnlichkeit noch über ein anderes Rateverfahren. (Der Referenzgraph löst relative und externe Ziele bereits heute nie auf; siehe [OSCAL_VALIDATION.md](OSCAL_VALIDATION.md#stufe-5--referenzgraph).)
- **Kein Netzwerkfallback.** Ein `href` löst unter keinen Umständen einen Netzwerk- oder Dateizugriff aus.
- **Zeigt eine Bindung auf ein nicht vorhandenes Ziel**, ist das Ergebnis eine benannte, fail-closed Diagnose („Referenz nicht aufgelöst"). Kein Teilergebnis, kein stiller Leerwert.
- Bindungen sind gerichtet und werden bei Löschung **beider** Seiten entfernt.

Die Auflösung über `back-matter` und Dokumentgrenzen liegt in [GSPP-286](https://linear.app/grundschutz-plus-plus/issue/GSPP-286); dieser Vertrag legt nur fest, wie ein Ziel benannt wird.

## 8. Übernahme aus dem Quellregister

### Lifecycle-Gate

**Referenzier- und übernehmbar sind ausschließlich Artefakte mit `lifecycle: 'supported'`** in [`sourceRegistry.mjs`](../src/domain/sourceRegistry.mjs). Artefakte mit `preview`, `draft` oder `blocked-by-upstream` werden nicht angeboten — fail-closed und gegen das Register prüfbar. Code-Grundlage: Nur `supported`-Artefakte werden materialisiert und durchlaufen die Laufzeit-Hashprüfung. Welche Artefakte diesen Zustand erreichen, entscheidet dieser Vertrag **nicht**; das ist Gegenstand der jeweiligen Modell-Issues.

### Zwei Operationen

**Referenzieren.** Das Artefakt bleibt Klasse 1 und dient als Bezugspunkt (`BindingTarget` mit `kind: 'class-1'`). Es wird **nichts kopiert**; die Hashkette bleibt unberührt.

**Übernehmen.** Der Nutzer verwendet ein öffentliches Artefakt als Ausgangspunkt für ein eigenes Dokument. Das erzeugt ein **neues Dokument**:

| Aspekt | Festlegung |
| --- | --- |
| Vertrauensklasse | zwingend `class-2-local-user` — Vertrauen vererbt sich nicht durch Verarbeitung (ADR-2 §10) |
| Root-UUID | **neu vergeben**, soweit das Root-Modell nach §5 `change-on-write` ist; die Übernahme ist ein fachlicher Schreibvorgang |
| `metadata.last-modified` | Zeitpunkt der Übernahme |
| Herkunft | `derivedFrom: { artifactKey, contentSha256, snapshotCommit }` im **Envelope** (bislang Vorgabe ohne Umsetzung im Code) |

`derivedFrom` ist eine **Herkunftsangabe, kein Vertrauensnachweis**. Sie hebt die Vertrauensklasse nicht an, wird nie in ein exportiertes Dokument geschrieben und erzeugt keine Provenienzanzeige im Sinne von Klasse 1.

### Verhältnis zur Kopierregel

Verboten ist die Kopie mit **falscher** Provenienz. Eine Übernahme, die ihre Herkunft wahrheitsgemäß nennt und die Vertrauensklasse herabstuft, macht die Herkunft nachprüfbar, statt sie zu verschleiern.

## 9. Zeitstempel und Revisionen

### Was als fachlicher Schreibvorgang gilt

`metadata.last-modified` ist definiert als „The date and time the document was last **stored for later retrieval**" — ein Speicherzeitpunkt, kein Bearbeitungszeitpunkt.

| Vorgang | `last-modified` | Root-UUID (change-on-write-Modelle) |
| --- | --- | --- |
| Explizites Speichern durch den Nutzer | **fortgeschrieben** | **neu vergeben** |
| Übernahme aus dem Quellregister (§8) | **fortgeschrieben** | **neu vergeben** |
| Autosave eines Entwurfs | unverändert | unverändert |
| Reine Serialisierung (Anzeige, Vorschau) | unverändert | unverändert |
| Speicher-Migration (§10) | unverändert | unverändert |

`createdAt` und `savedAt` im Envelope sind Werkzeugzeitstempel: Sie protokollieren, wann die Anwendung geschrieben hat, werden auch beim Autosave fortgeschrieben und sind kein Dokumentinhalt.

### Revisionen

`metadata.revisions` ist der OSCAL-native Ort für Versionsstände („expected to be in reverse chronological order (i.e. latest first)"). Die Abbildung ist **zweigeteilt**:

- **Fachliche Freigabepunkte**, die der Nutzer bewusst setzt, werden als Eintrag in `metadata.revisions` geschrieben und mitexportiert.
- **Autosave, Undo und Migrationsschritte** bleiben Werkzeughistorie außerhalb des Dokuments — im optionalen Store `toolHistory`. Sie gelangen **nie** in einen Export.

Der Store `toolHistory` ist für [GSPP-315](https://linear.app/grundschutz-plus-plus/issue/GSPP-315) reserviert und für eine erste Umsetzung nicht verpflichtend; wird er angelegt, unterliegt er den Löschregeln aus §12. `metadata.version` ist die **Dokumentversion des Autors** und wird von der Anwendung nicht automatisch fortgeschrieben.

## 10. Migration der Speicherstruktur

### Richtung und Invarianten

Migration ist **ausschließlich vorwärts**. Eine Rückwärtsmigration findet nicht statt. Über jede Migration hinweg gelten unverändert:

1. `source` — bitgleich in seiner kanonischen Serialisierung
2. `source.<root>.metadata.oscal-version`
3. `source.<root>.uuid`
4. `source.<root>.metadata.last-modified`
5. `localId`

Verändert werden dürfen ausschließlich `storageSchemaVersion` und die Speicherstruktur um `source` herum.

### Teilfehler

Eine Migration läuft in genau einer `versionchange`-Transaktion. Schlägt ein Datensatz fehl, wird die **gesamte** Migration abgebrochen; der Vorzustand bleibt bestehen. Ein nicht deutbarer Datensatz wird **nicht stillschweigend verworfen und nicht geraten**: Er lässt die Migration erklärbar scheitern; der Nutzer erhält eine benannte Diagnose und behält Zugriff auf den Vorzustand einschließlich Export.

### Unbekannte neuere Speicher-Schemaversion

Trägt ein Arbeitsbereich eine höhere `storageSchemaVersion` als die geladene Anwendung (älterer Tab, Rollback), gilt:

- **Schreibsperre.** Kein Schreiben, keine Rückwärtsmigration, keine Interpretation unbekannter Strukturen.
- **Lesen und Backup-Export bleiben verfügbar.** Ein Export reicht unbekannte Felder verlustfrei durch, ohne sie zu deuten.
- Der Nutzer erhält eine Meldung mit Handlungsempfehlung.

## 11. Export, Backup und Wiederherstellung

Export und Wiederherstellung müssen vor oder zusammen mit der ersten Speicherfunktion verfügbar sein: Ohne sie ist Geräteverlust endgültiger Datenverlust. Es gibt **zwei getrennte Formate**:

| Format | Inhalt | Zweck |
| --- | --- | --- |
| **Dokumentexport** | reines OSCAL-JSON, **kein** Envelope-Feld, keine Bindung, kein `derivedFrom` | Interoperabilität mit anderen OSCAL-Werkzeugen |
| **Arbeitsbereich-Backup** | projekteigenes Bündel mit Envelopes, Bindungen und `storageSchemaVersion` | Wiederherstellung in dieser Anwendung |

Was das Werkzeug als Dokument verlässt, ist gültiges OSCAL. Das Bündel ist ausdrücklich **kein** OSCAL-Dokument. Verbindlich:

- Ein Dokumentexport ist nur aus `export-ready` möglich (§4).
- **No-op-Round-trip:** Export eines unveränderten Dokuments ergibt semantische Gleichheit zum Import; `uuid` und `last-modified` bleiben unverändert.
- Ein Backup wird beim Wiedereinlesen validiert. Ein Bündel mit höherer `storageSchemaVersion` wird abgelehnt, nicht teilübernommen.
- Der Export ist die **einzige** Datenausleitung und wird stets vom Nutzer ausgelöst.

## 12. Löschung

### Einzelnes Dokument

Eine Transaktion über: `documents`, `drafts`, `bindings` in **beiden** Richtungen, `toolHistory`, sämtliche Indexeinträge dieser Stores, den In-Memory-View-Cache und den Klasse-2-Suchindex.

### Vollständiger Arbeitsbereich

Alle Stores, alle Indizes, alle In-Memory-Ableitungen, danach `deleteDatabase('gspp-workspace')`. Blockierte Löschungen (`onblocked`, weil ein anderer Tab die Datenbank hält) erhalten eine feste Abbruchfrist und eine erklärbare Meldung.

### Vollständige Aufzählung der Löschziele

| Ziel | erfasst durch |
| --- | --- |
| `documents`, `drafts`, `bindings`, `toolHistory`, `workspaceMeta` | Einzel- bzw. Gesamtlöschung |
| Indizes dieser Stores | mit dem jeweiligen Store |
| View-Cache im Arbeitsspeicher | ausdrücklich geleert |
| Klasse-2-Suchindex im Arbeitsspeicher | ausdrücklich geleert |
| App-interne Backups und temporäre Kopien | es gibt sie nicht; die Anwendung legt keine an |

**Die Anwendung führt keine app-internen Backups.** Ein Backup entsteht ausschließlich als vom Nutzer ausgelöste Datei außerhalb der Anwendung.

### Was die Löschung ausdrücklich nicht erfasst

- Bereits exportierte Dateien im Dateisystem des Nutzers
- Kopien im Papierkorb des Betriebssystems oder in dessen Backups
- Kopien, die der Nutzer selbst weitergegeben hat

Diese Grenze wird gegenüber dem Nutzer benannt.

## 13. Grenzen des Schutzes

**Local-first ist eine Aussage über den Verarbeitungsort, keine Schutzzusage.** Der Vertrag legt fest:

- Die Dokumente liegen **unverschlüsselt** im Browserprofil. Wer Zugriff auf das entsperrte Gerät oder das Profil hat, kann sie lesen — geteilte Arbeitsplätze sowie Vertretungs- und Administrationszugänge eingeschlossen.
- Bei Geräteverlust sind die Dokumente für Dritte lesbar, soweit diese Zugang zum Profil erhalten.
- Es existiert keine serverseitige Kopie. Bei Verlust von Gerät oder Browserprofil sind die Daten verloren; eine Wiederherstellung durch den Betreiber ist unmöglich.

Riskante Aktionen — Gesamtlöschung, Wiederherstellung aus einem Backup über Bestandsdaten, Verwerfen eines Entwurfs — verlangen eine ausdrückliche Bestätigung, die den nicht umkehrbaren Teil benennt.

### Verschlüsselung: bewertet und begründet verworfen

Der lokale Speicher wird **nicht** verschlüsselt. Es gibt keine Instanz für Hinterlegung oder Rücksetzung eines Schlüssels; die einzige Quelle wäre eine Nutzer-Passphrase, deren Verlust endgültigen, nicht wiederherstellbaren Datenverlust bedeutete. Gegen die schwerste Restgefahr — Ausführung fremden Codes im eigenen Origin — schützte die Verschlüsselung ohnehin nicht, weil der Klartext zur Laufzeit im Speicher liegt. An ihre Stelle treten die Grenzaussage (§14) und der Export als Schutz- und Wiederherstellungsmaßnahme (§11). Eine spätere Einführung verlangt einen eigenen ADR zur Recovery-Frage ohne Backend.

## 14. Vorgaben an die Datenschutzseite

Dieser Vertrag trifft **keine** datenschutzrechtlichen Aussagen. Die rechtliche Einordnung liegt in [GSPP-341](https://linear.app/grundschutz-plus-plus/issue/GSPP-341) und ist dort verantwortet. Mit der ersten Speicherfunktion bildet die Datenschutzseite ab:

1. Dass eigene Dokumente auf Wunsch im Browser gespeichert werden und das Gerät nicht verlassen.
2. Dass es keine automatische Löschfrist gibt und die Speicherdauer der Nutzer bestimmt.
3. Dass einzelne Dokumente und der gesamte Arbeitsbereich vollständig gelöscht werden können.
4. Dass die Ablage **unverschlüsselt** erfolgt und was daraus für geteilte Geräte und Geräteverlust folgt (§13).
5. Dass es keine Kopie beim Betreiber gibt und der Export deshalb die einzige Sicherung ist.

Die Projektbegriffe „Klasse 1", „Klasse 2" und „Arbeitsbereich" erscheinen im Seitentext nicht.

## 15. Testorakel

Festgelegt hier, ausgeführt in den Implementierungs-Issues. Jedes Orakel benennt, was verglichen wird und wann der Test fehlschlägt.

### Migrationsorakel

Verglichen wird ein gespeichertes Dokument vor und nach einer Speicher-Schema-Migration in: kanonischer Serialisierung von `source`, `source.<root>.metadata.oscal-version`, `source.<root>.uuid`, `source.<root>.metadata.last-modified` und `localId`. *Fehlschlag,* wenn eines dieser fünf Felder abweicht — oder wenn nach einem absichtlich fehlerhaften Datensatz ein teilmigrierter Zustand vorliegt statt des Vorzustands.

### Löschorakel

Ein Fixture trägt eine eindeutige Sentinel-Zeichenkette in `source`, im persistierten Draft und in einem Bindungseintrag. Nach der Löschung wird gesucht in: allen Objekt-Stores per Cursor, allen Indexschlüsseln, dem View-Cache und dem Klasse-2-Suchindex. *Fehlschlag,* wenn die Zeichenkette noch auffindbar ist — oder wenn bei der Einzellöschung ein Kontrolldokument verschwunden ist.

### Round-trip-Orakel

Ein unverändertes Dokument wird importiert, gespeichert, geladen und exportiert. Verglichen wird die kanonische Serialisierung von Export und Ausgangsdokument sowie einzeln `uuid` und `metadata.last-modified`. *Fehlschlag,* wenn die Serialisierungen abweichen, wenn `uuid` oder `last-modified` sich geändert haben, oder wenn ein Envelope-Feld im Export auftaucht.

### Negativkorpus

| Fall | Erwartetes Verhalten | Fehlschlag, wenn |
| --- | --- | --- |
| Abgebrochene Transaktion | vollständiger Vorzustand | ein Teilergebnis persistiert ist |
| Quota-Überschreitung | Schreibvorgang abgelehnt, benannte Diagnose | teilweise geschrieben oder still verworfen |
| Unbekannte neuere `storageSchemaVersion` | Schreibsperre, Lesen und Export möglich | geschrieben, migriert oder vollständig gesperrt |
| `href` auf nicht vorhandenes lokales Dokument | benannte fail-closed Diagnose | Rateverfahren, Netzwerkzugriff oder stiller Leerwert |

### Zusätzliche Invarianten

| Invariante | Fehlschlag, wenn |
| --- | --- |
| `localId ≠ source.<root>.uuid` | ein Speicherschlüssel gleich einer Dokument-UUID ist |
| Kein Klasse-1-Inhalt im Arbeitsbereich | ein Store einen Artefaktinhalt statt eines `artifactKey` trägt |
| Übernahme nur aus `supported` | ein Artefakt mit anderem Lifecycle referenziert oder übernommen werden kann |
| Kein Egress | über die Testlaufzeit ein ausgehender Request entsteht |

Die Egress-Prüfung läuft in der Browser-Lane und ist die Geltungsbedingung der datenschutzrechtlichen Einordnung.

## 16. Abgrenzung

Nicht Gegenstand dieses Vertrags:

- Backend, Synchronisation, geräteübergreifender Zugriff, Zusammenarbeit — nach [ADR-3](https://linear.app/grundschutz-plus-plus/issue/ADR-3) keine Produktziele
- Verschlüsselung des lokalen Speichers — bewertet und verworfen (§13); eine Wiederaufnahme verlangt einen eigenen ADR
- Die Entscheidung, welche BSI-Artefakte `supported` werden (§8)
- Datenschutzrechtliche Aussagen — sie liegen in [GSPP-341](https://linear.app/grundschutz-plus-plus/issue/GSPP-341)
- Die Auswahl der IndexedDB-Abstraktion — entschieden in [GSPP-340](https://linear.app/grundschutz-plus-plus/issue/GSPP-340)

## Quellen

Metaschemas abgerufen und verifiziert am 2026-08-09, Tag `v1.2.2`.

- Metadaten-Metaschema (`revisions`, `version`, `oscal-version`, `last-modified`):
  [oscal_metadata_metaschema.xml @ v1.2.2](https://github.com/usnistgov/OSCAL/blob/v1.2.2/src/metaschema/oscal_metadata_metaschema.xml)
- Root-UUID-Deklarationen der acht Modelle:
  [src/metaschema @ v1.2.2](https://github.com/usnistgov/OSCAL/tree/v1.2.2/src/metaschema)
- Model Reference v1.2.2:
  [pages.nist.gov/OSCAL-Reference/models/v1.2.2](https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/)
