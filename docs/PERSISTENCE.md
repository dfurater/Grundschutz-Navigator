# Persistenzvertrag für lokale Arbeitsbereiche

Dieser Vertrag legt verbindlich fest, wie der Navigator lokale Nutzerdokumente speichert, versioniert, referenziert, exportiert und löscht — und wo die Grenzen dieses Schutzes liegen.

Welches Schema für ein Dokument gilt, steht in der [Versionsmatrix](OSCAL_VERSION_MATRIX.md); womit und wo validiert wird, im [Validierungsvertrag](OSCAL_VALIDATION.md); wie die Integritätskette der öffentlichen BSI-Artefakte funktioniert, in [INTEGRITY.md](INTEGRITY.md).

## Status: Speicheradapter und Backup

`src/adapters/workspaceStore.ts` implementiert die Datenbank `gspp-workspace` mit Dexie 4.4.6. `src/domain/workspaceModel.ts` definiert Informationsverbünde, Envelopes, Entwürfe, Bindungen und die beiden Backup-Formate. `WorkspaceStore.open()` öffnet den Speicher ausdrücklich; der Katalogladepfad öffnet ihn nicht, `WorkspaceProvider` (`src/state/WorkspaceContext.tsx`) öffnet ihn beim ersten Betreten des Bereichs Informationsverbünde. Der Bereich bietet Bedienelemente zum Anlegen, Umbenennen und bestätigten Löschen von Informationsverbünden und zum Export des Gesamt-Backups (`exportBackup()`). Die Station Profile legt Profile an (`addDocument()` im Zustand `draft` mit der ausgehenden Bindung in derselben Transaktion), nimmt Profil-Dateien auf (`addDocument()` im Zustand `imported`), sichert Entwürfe (`autosaveDraft()`), speichert explizit (`saveDocument()` mit dem vollständigen ausgehenden Bindungssatz), exportiert ein `export-ready`-Profil als reines OSCAL-JSON und löscht ein einzelnes Profil nach Bestätigung (`deleteDocument()`). Die Station SSP legt SSPs an (`addDocument()` im Zustand `draft` mit der Baseline-Bindung in derselben Transaktion), nimmt schema-geprüfte lokale SSP-Dateien als `imported` über `addDocument()` auf, sichert Entwürfe (`autosaveDraft()`), speichert explizit (`saveDocument()` mit dem vollständigen ausgehenden Bindungssatz), exportiert ein `export-ready`-SSP als reines OSCAL-JSON und löscht ein einzelnes SSP nach Bestätigung (`deleteDocument()`). Der Reiter Prüfung eines Profils setzt Prüfpunkte (`appendCheckpoint()`, Hash und struktureller Diff), hält Workspace-Entscheidungen fest (`appendDecision()`) und schreibt eine Freigabe über `saveDocument(..., approval)` als Aktion in `metadata.actions`. Bedienelemente zum Aufnehmen weiterer Dokumenttypen, zur Gesamtlöschung und zur Wiederherstellung gibt es nicht; die Datenschutzseite benennt diese Grenze.

`src/adapters/workspaceBackup.ts` prüft Backup-Bytes in `src/workers/workspaceBackup.worker.ts`; jedes enthaltene Dokument außerhalb des Zustands `draft` durchläuft in diesem Worker zusätzlich `processClass2OscalBytes()`, dieselbe Klasse-2-Kette wie `src/workers/oscalImport.worker.ts`. Kompilierte Schemazellen gelten dabei für alle Dokumente eines Bündels. Die Klasse-2-Dokumentgrenzen und die Bündelgrenze stehen in `src/domain/class2ImportLimits.mjs`. Die Schemawahl verwendet `metadata.oscal-version` und die gepinnte Versionsmatrix. Der Speicher schreibt weder Root-UUID noch `metadata.last-modified` fort; diese fachlichen Änderungen liefert der aufrufende Schreibvorgang.

Die Datenbank startet mit Speicher-Schemaversion 1. `src/adapters/workspaceMigration.ts` stellt den geprüften Versionswechsel von 1 auf 2 innerhalb einer `versionchange`-Transaktion bereit; die Produktionsdatenbank registriert Version 1 und Version 2. `src/test/browser/workspaceMigration.browser.test.ts` führt den Versionswechsel in testeigenen Datenbanken aus.

## 0. Was OSCAL vorgibt und was dieses Projekt erfindet

| Herkunft | Gegenstand |
| --- | --- |
| **NIST-Vorgabe** | Die Pflichtmetadaten `title`, `last-modified`, `version`, `oscal-version`; `metadata.revisions` als Ort für Versionsstände; `last-modified` als Speicher-, nicht Bearbeitungszeitpunkt; die je Root-Modell unterschiedliche Persistenz der Dokument-UUID (siehe §5, [Quellen](#quellen)) |
| **Projektentscheidung** | Der Arbeitsbereich als Konstrukt; die Vertrauensklassen 1 und 2; der lokale Speicherschlüssel; die Speicher-Schemaversion; die Bindung von `href`-Werten an lokale Dokumente; Retention, Löschung und Quota-Politik |

**OSCAL kennt weder Persistenz noch einen Arbeitsbereich noch ein Vertrauensmodell.** Die Trennung ist vom Projekt zu tragen, zu implementieren und zu testen.

## 1. Dateninventar und Datenfluss

| Datenart | Ort | Kopien | Zugriff | Löschzeitpunkt |
| --- | --- | --- | --- | --- |
| Informationsverbund | IndexedDB `gspp-workspace`, Store `verbuende` | eine dauerhafte | Browserprofil des Geräts | Verbund- oder Gesamtlöschung |
| Originaldokument (`source`) | IndexedDB `gspp-workspace`, Store `documents` | eine dauerhafte | Browserprofil des Geräts | Dokument-, Verbund- oder Gesamtlöschung |
| Read-Model (`view`) | ausschließlich Arbeitsspeicher | keine dauerhafte | laufender Tab | Verlassen der Seite |
| Abgeleitete Indizes | IndexedDB, Indizes der Stores | `verbundId`, Root-Typ, OSCAL-Version, Werkzeugzeitpunkt und lokale Ziel-ID | wie Store | mit dem Store |
| Laufende Bearbeitung / Export-Draft | IndexedDB, Store `drafts` | eine, kurzlebig | wie Store | mit dem Dokument, spätestens beim Verwerfen |
| Referenzbindungen | IndexedDB, Store `bindings` | Verweise, keine Inhalte | wie Store | mit dem Dokument auf beiden Seiten |
| Prüfspur | IndexedDB, Store `reviewTrail` | Prüfpunkte mit Hash und strukturellem Diff, Workspace-Entscheidungen | wie Store | mit dem Dokument |
| Vergleichsbasis | IndexedDB, Store `reviewBaseline` | eine Quellkopie des zuletzt gesetzten Prüfpunkts | wie Store | mit dem Dokument oder dem nächsten Ersetzen |
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

`WorkspaceStore` hält mehrere Informationsverbünde in einer IndexedDB-Datenbank `gspp-workspace` und verwendet **Dexie** (exakter Pin in `package.json`).

| Store | Schlüssel | Inhalt |
| --- | --- | --- |
| `verbuende` | `verbundId` | Name und Werkzeugzeitstempel des Informationsverbunds |
| `documents` | `localId` | Envelope einschließlich `verbundId` und `source` |
| `drafts` | `localId` | laufende Bearbeitung, Export-Draft |
| `bindings` | `[fromLocalId, pointer]` | explizite Referenzbindungen (§7) |
| `reviewTrail` | `[localId, sequence]` | Prüfpunkte und Workspace-Entscheidungen (§9) |
| `reviewBaseline` | `localId` | Quellkopie des zuletzt gesetzten Prüfpunkts für den nächsten Diff |
| `workspaceMeta` | fester Schlüssel | `storageSchemaVersion`, Zeitstempel |

Indizes auf `documents`: `verbundId`, `rootType`, `oscalVersion`, `savedAt`. `bindings` besitzt den Zielindex `target.localId`; der zusammengesetzte Primärschlüssel lautet `[fromLocalId, pointer]`. `reviewTrail` besitzt den Index `localId`. Namen und Dokumenttitel sind keine Indexschlüssel.

**Das `view` wird nicht persistiert.** [ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2) bestimmt es als Projektion, nicht als Wahrheit; es wird beim Laden abgeleitet und nur im Arbeitsspeicher gehalten.

### Envelope

| Feld | Bedeutung |
| --- | --- |
| `localId` | lokal vergebener, stabiler Speicherschlüssel (§5) |
| `verbundId` | Zugehörigkeit zu genau einem Informationsverbund, mit `crypto.randomUUID()` vergeben |
| `storageSchemaVersion` | Version der **Speicherstruktur**, nicht des Dokuments (§6) |
| `rootType` | einer der acht OSCAL-Root-Keys |
| `oscalVersion` | Kopie aus `source.<root>.metadata.oscal-version`, für die Schemawahl beim Laden |
| `trustClass` | stets `class-2-local-user` |
| `documentState` | `imported` \| `draft` \| `export-ready` (§4) |
| `derivedFrom` | Herkunft bei Übernahme aus dem Quellregister, sonst nicht gesetzt (§8) |
| `createdAt`, `savedAt` | **Werkzeug**zeitstempel, getrennt von `metadata.last-modified` (§9) |
| `backupSavedAt` | nur nach einer Wiederherstellung: der `savedAt`-Wert aus dem Bündel; beide Bündel-Exporte geben ihn wieder als `savedAt` aus, ein echter Schreibvorgang führt ihn nicht mit (§11) |
| `source` | das rohe, verlustfreie OSCAL-Dokument |

Alle Envelope-Felder sind Projektkonstrukte. Keines wird jemals in ein exportiertes OSCAL-Dokument geschrieben, und keines wird jemals aus einem importierten Dokument gelesen.

### Transaktionsgrenzen

Eine fachliche Operation ist genau eine IndexedDB-Transaktion. Es gibt keinen Zustand, in dem ein Dokument gespeichert ist, seine Bindungen aber nicht — oder umgekehrt.

| Operation | umfasst |
| --- | --- |
| Dokument speichern | `documents`, `bindings` (alle in diesem Vorgang geänderten), `drafts` (Verwerfen), `reviewTrail` (nur bei Freigabe), `workspaceMeta` |
| Autosave eines Entwurfs | `drafts`, `workspaceMeta` |
| Dokument aufnehmen | `documents`, Verbundprüfung, `workspaceMeta` und die mitgegebenen ausgehenden `bindings` des neuen Dokuments |
| Dokument ersetzen | `documents`, `drafts`, `reviewBaseline` (Verwerfen), `workspaceMeta`; alle Bindungen bleiben erhalten |
| Prüfpunkt setzen | `documents`, `drafts` (beide lesend), `reviewTrail`, `reviewBaseline`, `workspaceMeta` |
| Workspace-Entscheidung | `documents`, `drafts` (beide lesend), `reviewTrail`, `workspaceMeta` |
| Bindung setzen oder entfernen | `documents`, `bindings`, `workspaceMeta` |
| Verbund anlegen oder umbenennen | `verbuende`, `workspaceMeta` |
| Verbund löschen | `verbuende`, seine `documents`, `drafts`, `bindings` beider Richtungen, `reviewTrail`, `reviewBaseline`, `workspaceMeta` |
| Dokument löschen | `documents`, `drafts`, `bindings` beider Richtungen, `reviewTrail`, `reviewBaseline` |
| Backup exportieren | alle vorhandenen Stores in einer lesenden Transaktion |
| Backup wiederherstellen | `verbuende`, `documents`, `drafts`, `bindings`, `reviewTrail`, `reviewBaseline`, `workspaceMeta`; ersetzt den gesamten Bestand und schreibt den Metazeitstempel fort |
| Verbund-Backup exportieren | `verbuende`, `documents`, `drafts`, `bindings`, `reviewTrail`, `reviewBaseline`, `workspaceMeta` in einer lesenden Transaktion; `workspaceMeta` dient nur der Versionsprüfung |
| Verbund-Backup wiederherstellen | `verbuende`, `documents`, `drafts`, `bindings`, `reviewTrail`, `reviewBaseline`, `workspaceMeta`; ersetzt ausschließlich den enthaltenen Verbund und schreibt den Metazeitstempel fort |
| Migration | alle Stores, ein einziger `versionchange` |

Der Adapter öffnet für jede Schreiboperation genau eine Transaktion über die betroffenen Stores und prüft darin die gespeicherte Schemaversion. `listDocuments()` liest per Cursor und liefert Envelopemetadaten ohne `source`; `getDocument()` lädt einen einzelnen vollständigen Quellgraphen. `saveDocument()`, `setBinding()` und `removeBinding()` verlangen den geladenen Dokumentvergleichswert `expectedSavedAt` und vergleichen ihn innerhalb derselben Transaktion mit dem gespeicherten `savedAt`; bei Abweichung bricht `WORKSPACE_SAVE_CONFLICT` den Vorgang ab. Jede Schreibtransaktion bildet einen Stempel, der mindestens eine Millisekunde nach `workspaceMeta.savedAt` liegt; jedes in ihr geschriebene `savedAt` und das fortgeschriebene `workspaceMeta.savedAt` erhalten diesen Stempel. `workspaceMeta.savedAt` ist damit nie kleiner als ein vergebener Vergleichswert, und jeder neue Vergleichswert liegt über allen zuvor vergebenen. `setBinding()`, `removeBinding()` und das Entfernen eingehender Bindungen bei einer Dokumentlöschung schreiben den Vergleichswert des jeweiligen Ausgangsdokuments innerhalb derselben Transaktion fort; aufrufende Ansichten laden ihn vor einem weiteren Speichern oder Ändern einer Bindung neu. Auch das Entfernen einer bereits fehlenden Bindung verlangt den aktuellen Dokumentvergleichswert. `replaceDocument()` verwendet dieselbe Konfliktprüfung und erhält `localId`, `verbundId`, Herkunft und Bindungen beider Richtungen. `saveDocument()`, `replaceDocument()` und `autosaveDraft()` prüfen zusätzlich `expectedDraftSavedAt` gegen das `savedAt` des gespeicherten Entwurfs; `null` verlangt, dass kein Entwurf existiert. Bei Abweichung bricht `WORKSPACE_SAVE_CONFLICT` den Vorgang ab, und der gespeicherte Entwurf bleibt unverändert. Autosave schreibt `documents.savedAt` nicht fort, deshalb erkennt erst dieser Entwurfsvergleich einen Entwurf, den eine andere Verbindung nach dem Laden gespeichert hat.

Indizes gehören zu ihrem Store und werden mit ihm geschrieben. **Regelform statt Aufzählung:** Jede Operation, die eine Bindung anlegt, ändert oder entfernt, führt `bindings` in **derselben** Transaktion wie das betroffene Dokument — auch bei später hinzukommenden Operationen. Bricht eine Transaktion ab, gilt der Vorzustand; es gibt keine Teilübernahme.

Prüfpunkt, Workspace-Entscheidung und Freigabe prüfen `expectedSavedAt`, `expectedDraftSavedAt` und die erwartete Trail-Sequenz innerhalb derselben Transaktion, die sie schreiben. Ein Prüfpunkt ist für ein Dokument im Zustand `draft` oder mit gespeichertem Entwurf gesperrt (`REVIEW_CHECKPOINT_NOT_ALLOWED`). Eine Freigabe schreibt Aktion, Dokumentzeile und Trail-Zeile gemeinsam; fehlen Rolle oder Partei im Dokument oder sind sie mehrdeutig, bricht der Schreibvorgang mit dem ersten `REVIEW_*`-Befund vor jedem Schreibzugriff ab.

### Mengengrenzen und Quota

- Je Dokument gilt die Eingangsgrenze aus `src/domain/class2ImportLimits.mjs` (`maxBytes` 10 MiB, `maxDepth` 64, `maxNodes` 1 000 000). Der Speicher senkt sie nicht und hebt sie nicht an.
- Die Zahl gleichzeitig **gehaltener** `source`-Graphen im Arbeitsspeicher ist begrenzt; nicht angezeigte Dokumente werden entlassen und bei Bedarf neu geladen ([ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2)).
- Bei erschöpftem Browser-Quota bricht die Transaktion mit `WORKSPACE_QUOTA_EXCEEDED` ab. `estimate()` liefert `navigator.storage.estimate()` zur Darstellung durch die aufrufende Oberfläche; fehlt die Browserfunktion, liefert es `undefined`.
- Die Anwendung verdrängt und löscht keine gespeicherten Daten selbst. Sie ruft `navigator.storage.persist()` nicht auf; die Datenbank liegt im best-effort-Modus, in dem der Browser sie ohne Rückfrage entfernen kann, etwa bei Speicherknappheit oder nach browsereigenen Regeln für länger nicht genutzte Websites. Die Anwendung erkennt eine solche Entfernung nicht. Der Backup-Export ist die einzige Sicherung.

## 4. Dokumentzustände

`addDocument()` akzeptiert als fünftes Argument ein optionales `AbortSignal`. Ein Abbruch nach der Eingangsprüfung oder vor dem ersten Dokument-Schreibauftrag liefert `WORKSPACE_OPERATION_CANCELLED` und erhält den gespeicherten Bestand. Die gemeinsame Dateiaufnahme für Profile und SSPs (`src/features/workspace/WorkspaceFileImport.tsx`) bricht dieses Signal beim Verlassen der Station oder beim Verbundwechsel ab; der Workspace meldet den bewussten Abbruch nicht als Speicherfehler.

Ein `profile` braucht mindestens einen `import`, ein `system-security-plan` braucht `import-profile`, `system-characteristics`, `system-implementation` und `control-implementation`. Es gibt kein gültiges leeres Profil; ein Gate, das nur „valide oder abgelehnt" kennt, blockierte jedes Authoring.

| Zustand | Bedeutung | Validierung |
| --- | --- | --- |
| `imported` | fremdes Dokument, gerade eingelesen | fail-closed, streng |
| `draft` | lokaler Entwurf in Arbeit | Unvollständigkeit zulässig, **nicht exportierbar** |
| `export-ready` | vollständig, exportfähig | voll validiert |

Ein Dokument ohne die Pflichtmetadaten aus §0 erreicht `export-ready` nicht.

Jede Dokumentzeile hält unabhängig vom Zustand die Klasse-2-Dokumentgrenzen und einen Root-Dispatch, dessen Root-Typ und OSCAL-Version mit `rootType` und `oscalVersion` des Envelopes übereinstimmen (`bindsEnvelopeSource()` in `src/adapters/workspaceDraftSource.ts`). `imported` und `export-ready` verlangen beim Aufnehmen und Speichern zusätzlich ein schemagültiges `source` über `importClass2OscalDocument()`, bei der Wiederherstellung über `processClass2OscalBytes()` (§11). `addDocument()` mit `draft` nimmt ein schemaungültiges Dokument auf, etwa ein Profil ohne `import`. `saveDocument()` und `replaceDocument()` prüfen gegen den wirksamen Zielzustand, also den übergebenen `state` oder den gespeicherten `documentState`; ein Wechsel aus `draft` in einen anderen Zustand verlangt ein schemagültiges `source`, sonst bricht `WORKSPACE_DOCUMENT_INVALID` vor dem Schreiben ab.

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

**Die Bindung liegt explizit im Store `bindings`, getrennt vom Dokument.** Der `href`-Wert in `source` bleibt unverändert — andernfalls bräche der No-op-Round-trip aus ADR-2.

```
BindingTarget = { kind: 'local',   localId:    LocalId }
              | { kind: 'class-1', artifactKey: ArtifactKey }
```

Der zweite Zieltyp ist nötig, weil ein lokaler SSP mit `import-profile` typischerweise auf ein **öffentliches BSI-Profil** zeigt. Gespeichert wird der Verweis, nie der Inhalt. Verbindlich gilt:

- **Kein impliziter Auflösungsversuch.** Ohne gesetzte Bindung bleibt die Referenz im Verbundgraphen `not-evaluable`. `buildWorkspaceGraph()` in `src/domain/workspaceGraph.ts` verwendet ausschließlich Bindungen je `fromLocalId`, Referenz-Pointer und unverändertem `href`; absolute URIs bleiben `external` (siehe [OSCAL_VALIDATION.md](OSCAL_VALIDATION.md#dokumentgraph-eines-informationsverbunds)).
- **Kein Netzwerkfallback.** Ein `href` löst unter keinen Umständen einen Netzwerk- oder Dateizugriff aus.
- **Zeigt eine Bindung auf ein nicht vorhandenes Ziel**, ist das Ergebnis eine benannte, fail-closed Diagnose („Referenz nicht aufgelöst"). Kein Teilergebnis, kein stiller Leerwert.
- Bindungen sind gerichtet und werden bei Löschung **beider** Seiten entfernt. Lokale Ziele müssen existieren und dieselbe `verbundId` wie das Ausgangsdokument besitzen; anderenfalls meldet der Adapter `WORKSPACE_DOCUMENT_NOT_FOUND` oder `WORKSPACE_BINDING_CROSS_VERBUND`. `setBinding()` prüft den unveränderten `href` am angegebenen JSON Pointer; unterstützte Klasse-1-Ziele werden gegen das Quellregister geprüft.
- Für die Referenzauflösung gilt: Eine Bindung ist nur gültig, solange der Wert in `source` am `pointer` gleich ihrem gespeicherten `href` ist; bei Abweichung lautet das Auflösungsergebnis „Referenz nicht aufgelöst“: Die Verbundkante endet als `error` mit `OSCAL_WORKSPACE_BINDING_STALE`. `replaceDocument()`, `saveDocument()` ohne `changedBindings` und die Wiederherstellung erhalten auch solche Bindungen unverändert.

`src/domain/workspaceGraphContext.ts` klassifiziert Referenzen mit `createOscalReferenceClassifier()` aus `src/domain/referenceResolution.ts`, dem wiederverwendbaren Einstieg in den Klassifikationskern von `resolveOscalReference()`. Ein Fragment auf eine `back-matter.resource` erhält nur über eine explizite Bindung ein Dokumentziel; `rlinks` werden nicht verfolgt. `class1Artifacts` enthält ausschließlich bereits geladene, hashgeprüfte und im Quellregister unterstützte Artefakte. Der Graph führt keine Speicheroperation aus; transiente Resolutionsergebnisse stehen nur im Rückgabewert.

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
| Herkunft | `derivedFrom: { artifactKey, contentSha256, snapshotCommit }` im **Envelope** (Vorgabe ohne Umsetzung im Code) |

`derivedFrom` ist eine **Herkunftsangabe, kein Vertrauensnachweis**. Sie hebt die Vertrauensklasse nicht an, wird nie in ein exportiertes Dokument geschrieben und erzeugt keine Provenienzanzeige im Sinne von Klasse 1.

### Verhältnis zur Kopierregel

Verboten ist die Kopie mit **falscher** Provenienz. Eine Übernahme, die ihre Herkunft wahrheitsgemäß nennt und die Vertrauensklasse herabstuft, macht die Herkunft nachprüfbar, statt sie zu verschleiern.

## 9. Zeitstempel, Prüfspur und Freigabe

### Was als fachlicher Schreibvorgang gilt

`metadata.last-modified` ist definiert als „The date and time the document was last **stored for later retrieval**" — ein Speicherzeitpunkt, kein Bearbeitungszeitpunkt.

| Vorgang | `last-modified` | Root-UUID (change-on-write-Modelle) |
| --- | --- | --- |
| Explizites Speichern durch den Nutzer | **fortgeschrieben** | **neu vergeben** |
| Freigabe im Prüfablauf | **fortgeschrieben** | **neu vergeben** |
| Prüfpunkt oder Workspace-Entscheidung | unverändert | unverändert |
| Übernahme aus dem Quellregister (§8) | **fortgeschrieben** | **neu vergeben** |
| Autosave eines Entwurfs | unverändert | unverändert |
| Reine Serialisierung (Anzeige, Vorschau) | unverändert | unverändert |
| Speicher-Migration (§10) | unverändert | unverändert |

Für ein `system-security-plan` gelten dieselben Zeilen für `last-modified`; seine Root-UUID bleibt bei jedem Vorgang unverändert (§5). `commitSspSave()` in `src/domain/sspSave.ts` setzt `last-modified` nur, wenn sich der Inhalt gegenüber dem gespeicherten Stand ändert, und lässt die Root-UUID unberührt.

`createdAt` und `savedAt` im Envelope sind Werkzeugzeitstempel. Autosave schreibt `savedAt` im separaten Entwurf und in `workspaceMeta` fort; `documents.savedAt` bleibt dabei der Vergleichswert des expliziten Speicherns. Diese Zeitstempel sind kein Dokumentinhalt.

### Prüfspur und Freigabe

`metadata.revisions` bleibt Dokumentinhalt; die Anwendung schreibt es nicht fort. Ein Revisionseintrag trägt nur `version`, keinen Dokumentinhalt und keine eigene `uuid`; die Anwendung behandelt ihn deshalb weder als Snapshot noch als Rollback-Ziel und sortiert die Liste nicht um.

Prüfpunkte und Workspace-Entscheidungen liegen ausschließlich im Store `reviewTrail` und werden nicht exportiert. Die Spur speichert je Prüfpunkt Inhalts-Hash und strukturellen Diff, nicht den Dokumentinhalt; frühere Dokumentstände sind daraus nicht rekonstruierbar.

Eine Freigabe ist der einzige native Schreibvorgang des Prüfablaufs: Sie trägt eine Aktion vom Typ `approved` im System-Namespace `https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/actions` in `metadata.actions` ein und ergänzt fehlende Rolle und Partei in `metadata.roles`/`metadata.parties`. System-Namespace und Typmenge sind Projektfestlegungen, kein NIST-Vokabular; `approved` ist der einzige Typ. Die Aktion braucht `uuid`, `type`, `system` und genau eine `responsible-parties`-Zeile mit `role-id` und mindestens einer `party-uuids`; die Rolle braucht `id` und `title`, die Partei `uuid`, `type` (hier `organization`) und `name`. Rollen, Parteien und Begründung sind damit im Dokument und im Export enthalten; eine Signatur oder Identitätsprüfung findet nicht statt.

### Inhalts-Hash und Prüfstand

`DocumentSnapshot` bindet `rootType`, Root-`uuid`, `last-modified`, `version`, `oscal-version` und den Inhalts-Hash. `hashVersion: 1` heißt SHA-256 über `sorted-json/1`: Objektschlüssel sortiert, Arrays in Quellreihenfolge, `-0` erhalten; ausgenommen sind nur die Root-`uuid` und die Root-`last-modified`. Jede Änderung eines anderen Werts erzeugt einen anderen Hash. Ein Prüfstand gilt als überholt, sobald einer dieser sechs Werte vom gebundenen Stand abweicht oder der Editor ungespeicherte Eingaben hat.

Jeder Trail-Eintrag trägt den Root-Typ seines eigenen Stands. Ersetzt `replaceDocument()` ein Dokument durch eine andere Root unter derselben `localId`, bleiben die älteren Einträge mit ihrem bisherigen Root-Typ Historie; nur die Vergleichsbasis muss zur aktuellen Root passen. Sicherung und Wiederherstellung nehmen ausschließlich Stände mit `hashVersion: 1` und Algorithmus `sha-256` an; eine unbekannte Hash-Version oder ein unbekannter Algorithmus lässt das Bündel scheitern.

Die Speichergrenze prüft eine Freigabe unabhängig vom Aufrufer: Eine Freigabe in den Zustand `draft` meldet `REVIEW_APPROVAL_BLOCKED`, eine schemawidrige Quelle `REVIEW_APPROVAL_SCHEMA`. In beiden Fällen bleiben Dokument, Entwurf und Trail unverändert.

### Grenzen

Hash und Diff entstehen in `src/workers/reviewTrail.worker.ts` mit derselben Klasse-2-Eingangsgrenze wie der Import (10 MiB, Tiefe 64, 1 000 000 Knoten) und einer Frist von 15 000 ms. Ein Fehlschlag oder Fristablauf schreibt nichts (`REVIEW_TRAIL_WORK_FAILED`); einen Rückfall auf Berechnung im Hauptthread gibt es nicht. Ein Diff führt höchstens `DOCUMENT_DIFF_MAX_ENTRIES` (5 000) Einträge und `DOCUMENT_DIFF_MAX_BYTES` (1 MiB); darüber setzt er `truncated`. Die Einträge nennen Pfad, Art (`added`/`removed`/`changed`) und Wertart, keinen Inhalt. Die Vergleichsbasis ist die Quellkopie des letzten Prüfpunkts, nicht eine Sammlung aller Stände; ein ersetztes Dokument verwirft sie.

`metadata.version` ist die **Dokumentversion des Autors** und wird von der Anwendung nicht automatisch fortgeschrieben. Der Store `toolHistory` wird nicht angelegt.

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

`src/adapters/workspaceMigration.ts` liest und prüft alle Stores der Zielversion zeilenweise per IndexedDB-Cursor. Der gemeinsame Strukturprüfer aus `src/adapters/workspaceBackupStructure.ts` hält Kennungen, Verbundzuordnungen und Bindungsschlüssel für die Querreferenz- und Duplikatprüfung; `source`-Graphen werden nur je Datensatz verarbeitet. Nach vollständiger Prüfung schreiben Cursor die Speicher-Schemaversionen der Dokumente und Metadaten jeweils einzeln und warten vor dem nächsten Datensatz auf den Schreibabschluss.

Eine Migration läuft in genau einer `versionchange`-Transaktion. Schlägt ein Datensatz fehl, wird die **gesamte** Migration abgebrochen; der Vorzustand bleibt bestehen. Ein nicht deutbarer Datensatz wird **nicht stillschweigend verworfen und nicht geraten**: Er lässt die Migration erklärbar scheitern. `WorkspaceStore.open()` meldet `WORKSPACE_MIGRATION_FAILED`; `WorkspaceStore.exportRecoveryBackup()` liefert den unveränderten Vorzustand als Rettungsexport im Format aus §11. Ein normaler Store wird in diesem Zustand nicht geöffnet.

### Unbekannte neuere Speicher-Schemaversion

Trägt ein Arbeitsbereich eine höhere `storageSchemaVersion` als die geladene Anwendung (älterer Tab, Rollback), gilt:

- **Schreibsperre.** Kein Schreiben, keine Rückwärtsmigration, keine Interpretation unbekannter Strukturen.
- **Lesen und Backup-Export bleiben verfügbar.** Ein Export reicht unbekannte Felder verlustfrei durch, ohne sie zu deuten. `WorkspaceStore` löst die bekannten Stores erst bei der jeweiligen Operation auf; fehlt einer davon im neueren Schema, öffnet `WorkspaceStore.open()` die Datenbank, eine Leseoperation auf dem fehlenden Store meldet `WORKSPACE_SCHEMA_NEWER`, und der Gesamtexport bleibt verfügbar. Bei einer neueren Datenbankversion trägt das Gesamt-Backup die Datenbankversion als `storageSchemaVersion`; `workspaceMeta` wird unabhängig von Schlüsselform und Versionsfeldern unverändert exportiert. Für die aktuelle Datenbankversion verlangt der Gesamtexport die bekannte Metazeile mit ganzzahliger, positiver `storageSchemaVersion`.
- Der Nutzer erhält eine Meldung mit Handlungsempfehlung.

## 11. Export, Backup und Wiederherstellung

Der Speicher bietet Gesamt-Backups und Verbund-Backups. Der fachliche Dokumentexport verwendet reines OSCAL-JSON (§4); die Backup-Bündel verwenden die folgenden Projektformate:

| Format | Inhalt | Zweck |
| --- | --- | --- |
| **Dokumentexport** | reines OSCAL-JSON, **kein** Envelope-Feld, keine Bindung, kein `derivedFrom` | Interoperabilität mit anderen OSCAL-Werkzeugen |
| **Arbeitsbereich-Backup** | projekteigenes JSON-Bündel mit `format: "gspp-workspace"`, Verbünden, Envelopes, Entwürfen, Bindungen, Prüfspur, Vergleichsbasis, `workspaceMeta` und `storageSchemaVersion` | Wiederherstellung in dieser Anwendung |
| **Verbund-Backup** | projekteigenes JSON-Bündel mit `format: "gspp-workspace-verbund"`, `storageSchemaVersion`, genau einem Eintrag in `verbuende` und dessen Dokumenten, Entwürfen, Bindungen, Prüfspur und Vergleichsbasis; ohne `workspaceMeta` | Wiederherstellung eines einzelnen Informationsverbunds |

Was das Werkzeug als Dokument verlässt, ist gültiges OSCAL. Das Bündel ist ausdrücklich **kein** OSCAL-Dokument. Verbindlich:

- Ein Dokumentexport ist nur aus `export-ready` möglich (§4).
- **No-op-Round-trip:** Export eines unveränderten Dokuments ergibt semantische Gleichheit zum Import; `uuid` und `last-modified` bleiben unverändert.
- `restoreBackup(bytes, "replace-workspace")` prüft das vollständige Bündel vor der schreibenden Transaktion: fatales UTF-8, Duplicate-Member-Scanner, geschlossene Bündelform, UUIDs, Zeitstempel, eindeutige Schlüssel, Verbundnamen mit mindestens einem Nicht-Leerzeichen, Verbundzugehörigkeit und Bindungsziele. Ein Bündel der Speicherversion 1 wird ohne Prüfspur eingelesen; seine Verbundzeilen behalten ihre Form ohne Versionsfeld, sodass der Re-Export wieder einlesbar ist. Beide Wiederherstellungen rechnen jede Vergleichsbasis im Backup-Worker aus ihrer Quelle nach und vergleichen den vollständigen Stand einschließlich Content-Hash; eine Abweichung meldet `WORKSPACE_BACKUP_INVALID`, ein Rechenfehler `WORKSPACE_BACKUP_WORKER_FAILURE`. Für Version 2 gilt zusätzlich: Trail-Sequenzen steigen je Dokument, jeder `stand` gehört zu seinem Dokument, ein Diff verweist nur auf einen früheren Prüfpunkt desselben Dokuments, und jede Vergleichsbasis gehört zu einem enthaltenen Prüfpunkt. Gespeicherte Artefaktschlüssel und Herkunftsverweise bleiben unabhängig vom aktuellen Register-Lifecycle erhalten; die Wiederherstellung prüft ihre Schlüsselgrammatik und löst keine Referenz auf. `setBinding()` lässt für neue Klasse-1-Bindungen ausschließlich aktuell unterstützte Artefakte zu. Jedes `source` in `documents` mit einem anderen Zustand als `draft` durchläuft im Backup-Worker `processClass2OscalBytes()`; Dokumentzeilen im Zustand `draft` durchlaufen `bindsEnvelopeSource()` (§4), Zeilen in `drafts` die Ressourcen- und Objektgraphgrenzen. Ein Verstoß meldet `WORKSPACE_BACKUP_DOCUMENT_REJECTED` beziehungsweise `WORKSPACE_BACKUP_RESOURCE_REJECTED`. Ein Bündel mit höherer `storageSchemaVersion` wird vollständig abgelehnt.
- `exportVerbundBackup(verbundId)` liest in einer Transaktion genau einen Verbund mit seinen Dokumenten, Entwürfen, Bindungen, Prüfspurzeilen und Vergleichsbasen. Eine unbekannte ID meldet `WORKSPACE_VERBUND_NOT_FOUND`. Der partitionierte Export benötigt ein bekanntes Speicherschema; bei einer neueren Datenbank- oder Metaversion meldet er `WORKSPACE_SCHEMA_NEWER`. Der Gesamtexport erhält unbekannte Stores ohne Interpretation.
- `restoreVerbundBackup(bytes, "replace-verbund")` verwendet denselben Worker und dieselben Quellenprüfungen wie das Gesamt-Backup. Es ersetzt einen vorhandenen Verbund gleicher `verbundId` oder fügt ihn hinzu; andere Verbünde bleiben unverändert. Gehört eine enthaltene `localId` bereits zu einem anderen Verbund, meldet die Transaktion vor dem ersten Schreibzugriff `WORKSPACE_BACKUP_CONFLICT`. Löschen und Wiederherstellen der ausgewählten Datensätze erfolgen gemeinsam in einer Transaktion. `restoreBackup()` lehnt Verbund-Bündel ab; `restoreVerbundBackup()` lehnt Gesamt-Bündel ab. Ein Verbund-Bündel mit mehreren Verbünden oder mit `workspaceMeta` wird ebenfalls abgelehnt.
- Beide Wiederherstellungen schreiben in `savedAt` jeder wiederhergestellten Dokument- und Entwurfszeile und in `workspaceMeta.savedAt` denselben frischen Stempel `V`. Er liegt mindestens eine Millisekunde nach dem bisherigen `workspaceMeta.savedAt` und nach jedem `savedAt` der Verbund-, Dokument- und Entwurfszeilen des Bündels; das `savedAt` der Metazeile des Bündels zählt nicht mit. Die Verbundzeilen behalten ihr `savedAt`. Den `savedAt`-Wert, den das Bündel für eine Dokument- oder Entwurfszeile trägt, bewahrt die Zeile unter `backupSavedAt`; beide Bündel-Exporte geben ihn wieder als `savedAt` aus und lassen das Feld weg. Ein unverändert wiederhergestelltes Verbund-Bündel re-exportiert deshalb bytegleich, ein Gesamt-Bündel bis auf `workspaceMeta.savedAt` unverändert. Jedes echte Schreiben einer Zeile setzt `savedAt` auf den Schreibstempel und führt kein `backupSavedAt` mit. Danach passt weder ein vor der Wiederherstellung vergebener Vergleichswert noch ein im Bündel mitgeführter Wert auf eine wiederhergestellte Zeile. Die Bündelform akzeptiert `backupSavedAt` auf Dokument- und Entwurfszeilen als Zeitstempel; ein mitgeführter Wert wird ignoriert und durch den Wert ersetzt, den das Bündel als `savedAt` der Zeile trägt. Läge `V` nach dem Jahr 9999, lehnt die Wiederherstellung das Bündel mit `WORKSPACE_BACKUP_INVALID` ab. Der Stempel einer Schreibtransaktion liegt höchstens bei `9999-12-31T23:59:59.998Z`; die letzte Millisekunde des Jahres 9999 steht nur `V` zu. Läge ein Schreibstempel später, bricht die Transaktion mit `WORKSPACE_TIMESTAMP_EXHAUSTED` ab; der gespeicherte Bestand bleibt unverändert und exportierbar. Jeder exportierte Zeilenwert liegt damit höchstens bei `9999-12-31T23:59:59.998Z`, und jede exportierte Sicherung lässt sich in einer Datenbank wiederherstellen, deren `workspaceMeta.savedAt` vor `9999-12-31T23:59:59.999Z` liegt.
- `WORKSPACE_BACKUP_MAX_BYTES` beträgt 32 MiB (33 554 432 Bytes) je Gesamt- oder Verbund-Bündel. Die Prüfung greift vor Transferkopie und Worker-Erzeugung. Bündel über dieser Grenze werden nicht eingelesen. Für das gesamte Bündel gelten die Bytegrenze und 1 000 000 Knoten einschließlich Rahmen und aller `source`-Graphen. Jedes Dokument und jeder Entwurf behält separat die Grenzen von 10 MiB, Tiefe 64 und 4 MiB dekodierter Back-matter-base64-Summe. Tiefe und base64-Summe beginnen bei jedem `source` neu. Der Duplicate-Member-Scanner erlaubt mit `WORKSPACE_BACKUP_FRAME_DEPTH` drei zusätzliche Rahmenebenen, insgesamt Tiefe 67. Der Backup-Worker endet nach spätestens `WORKSPACE_BACKUP_WORKER_TIMEOUT_MS` (120 000 ms). Er überträgt ein geprüftes Bündel mit dem quittierten Fragmentprotokoll des OSCAL-Imports (`src/domain/oscalImportTransport.ts`, [OSCAL_VALIDATION.md](./OSCAL_VALIDATION.md)) an den Hauptthread: höchstens 256 Operationen und 32 768 UTF-16-Codeeinheiten je Fragment, ein unquittiertes Fragment zur Zeit. `src/adapters/workspaceBackup.ts` dekodiert mit den Bündelgrenzen (1 000 000 Knoten, Tiefe 67, `WORKSPACE_BACKUP_MAX_BYTES` Codeeinheiten) und prüft nach dem Abschluss die geschlossene Bündelform. Protokollverletzungen, fremde Origins, Worker-Fehler und Timeout melden `WORKSPACE_BACKUP_WORKER_FAILURE`; von einer Ablehnung im Worker übernimmt der Hauptthread nur einen zugelassenen Diagnosecode.
- `src/adapters/workspaceBackup.heap.node.test.ts` misst ein objektdichtes Bündel bei gleichzeitig ausgeschöpfter Byte- und Knotengrenze mit fünf GC-bereinigten Samples des gehaltenen Ergebnisgraphen; die Messung erfasst weder den transienten Spitzenheap noch den Gesamtspeicher mehrerer Browser-Worker. Der Gesamtexport liest einen konsistenten Snapshot aller Stores und erhält unbekannte Felder und zusätzliche Stores neuerer Speicherversionen ohne Interpretation. Liegt der Primärschlüssel eines Stores nicht im Datensatz, schreibt der Gesamtexport dessen Schlüssel in Lesereihenfolge zusätzlich unter `outOfLineKeys.<Store>`. Datumsschlüssel stehen dort als `{ "date": "<ISO-Zeitpunkt>" }`, Binärschlüssel als `{ "binary": "<Base64>" }`, die Zahlenschlüssel `Infinity` und `-Infinity` als `{ "number": "Infinity" }` bzw. `{ "number": "-Infinity" }`, zusammengesetzte Schlüssel als Array dieser Formen. Heißt ein Store `format`, `storageSchemaVersion` oder `outOfLineKeys`, meldet der Gesamtexport `WORKSPACE_SCHEMA_INVALID`. Für die aktuelle Speicherversion prüfen beide Exportwege Gesamtbytes, Gesamtknoten, die getrennten `source`-Grenzen und die Bündelform vor einer erfolgreichen Rückgabe. Die Knotenprüfung startet mit den Rahmenknoten des Bündels und zählt die Knoten jeder Zeile vor deren Serialisierung; überschreitet das Budget die Gesamtgrenze von 1 000 000 Knoten, wird die auslösende Zeile nicht mehr serialisiert und das Einsammeln endet. Eine inkonsistente Bündelform meldet `WORKSPACE_BACKUP_INVALID`. Eine Ressourcenüberschreitung meldet `WORKSPACE_BACKUP_LIMIT_EXCEEDED`; die gespeicherten Daten bleiben erhalten. Ein Gesamtbestand über der Bündelgrenze lässt sich verbundweise sichern, wenn jeder einzelne Verbund in die Grenzen passt. Ein einzelner zu großer Verbund lässt sich über diese Schnittstellen nicht vollständig sichern. `serializeWorkspaceJson()` erhält negative Null als `-0`-Zahlentoken. Nicht endliche Zahlen werden bei Speicherung und Wiederherstellung mit redigierten Diagnosen abgelehnt.
- Der Export ist die **einzige** Datenausleitung und wird stets vom Nutzer ausgelöst.

### Rettungsexport neuerer oder nicht migrierbarer Datenbanken

Bei `db.verno > STORAGE_SCHEMA_VERSION` oder nach `WORKSPACE_MIGRATION_FAILED` liest `src/adapters/workspaceRecoveryStorage.ts` die tatsächlichen `IDBDatabase.objectStoreNames` mit nativen Cursorn in einer einzigen schreibgeschützten Transaktion. Die Store- und Schlüsselsammlungen haben keinen Prototyp; auch `__proto__`, `constructor` und `toString` bleiben eigene Einträge. Die Serialisierung beginnt nach Abschluss der Lesetransaktion. Die aktuelle Datenbankversion verwendet `workspaceBackupStorage.ts` mit ihren Byte-, Knoten- und Strukturprüfungen.

`src/adapters/workspaceRecoveryJson.ts` prüft JSON-Bäume in einer Tiefensuche mit Iteratoren und einer WeakSet-Identitätsmenge vor der Serialisierung; diese Vorprüfung baut keine zweite kodierte Knotenliste auf. Ein JSON-Baum ohne besondere Werte behält das normale Gesamtformat. Enthält der Snapshot besondere Werte, gemeinsame Objektreferenzen, Zyklen oder Arraylücken oder erreicht ein Objekt die Tiefe 128, trägt das Bündel `format: "gspp-workspace"`, die höhere `storageSchemaVersion`, `valueEncoding: "gspp-structured-clone-v1"` und `payload: { root: 0, nodes: [...] }`. Die flache Graphkodierung verarbeitet auch tiefere Bäume iterativ. Der Wurzelknoten enthält das gesamte ursprüngliche Gesamtbündel einschließlich Stores und `outOfLineKeys`. Jede Referenz ist ein nullbasierter Index in `nodes`; Nutzerobjekte und Arrays haben eigene Knoten und können deshalb keine Typmarkierungen vortäuschen.

| Knoten | Bedeutung |
| --- | --- |
| `["value", wert]` | `null`, Zeichenkette, Boolean oder endliche Zahl außer negativer Null |
| `["number", text]`, `["bigint", text]`, `["undefined"]` | `-0`, `NaN`, `Infinity`, `-Infinity`, dezimales BigInt beziehungsweise `undefined` |
| `["object", [[name, referenz], ...]]` | Eigene aufzählbare Objektfelder |
| `["array", länge, [[name, referenz], ...]]` | Arraylänge und vorhandene eigene Einträge einschließlich zusätzlicher Eigenschaften; fehlende Indizes bleiben Lücken |
| `["date", text]` | Millisekunden seit Unix-Epoche als Dezimaltext; `"NaN"` erhält ein ungültiges Datum |
| `["buffer", base64]` | Sämtliche Bytes eines ArrayBuffer mit fester Größe |
| `["view", typ, pufferreferenz, byteOffset, byteLength]` | TypedArray oder DataView mit Typnamen, gemeinsamem Puffer und Ausschnitt in Bytes |
| `["map", [[schlüsselreferenz, wertreferenz], ...]]`, `["set", [referenz, ...]]` | Map- beziehungsweise Set-Einträge in Einfügereihenfolge |
| `["regexp", quelle, flags]` | Regulärer Ausdruck mit seinen IndexedDB-gespeicherten Eigenschaften |

Veränderbare ArrayBuffer und ihre TypedArray-/DataView-Ansichten sowie andere Werttypen, darunter Blob und File, brechen den Export mit `WORKSPACE_STORAGE_FAILED` ab; die Diagnose enthält keine Nutzdaten, und der gespeicherte Bestand bleibt unverändert. Ein Abbruch der nativen Lesetransaktion nach bereits gelesenen Zeilen liefert ebenfalls nur die redigierte Diagnose und kein Teilbackup; Zeilen und Schlüssel bleiben erhalten. Die geladene Anwendung lehnt die Wiederherstellung von Bündeln neuerer Speicherschemas einschließlich Graphbündeln vollständig ab. Die Graphkodierung erweitert weder die OSCAL-Importtypen noch die zugelassenen Werte des aktuellen Speicherschemas.

Die Heap-Messung des objektdichten Bündels bei 33 554 432 Bytes und 1 000 000 Knoten liefert unter Node v22.22.3 / V8 12.4.254.21-node.56 einen Median von 56 000 936 Bytes gehaltenem Ergebnisheap; die Spannweite der fünf Samples beträgt 1 781 424 Bytes.

## 12. Löschung

### Einzelnes Dokument

Eine Transaktion über: `documents`, `drafts`, `bindings` in **beiden** Richtungen, `reviewTrail`, `reviewBaseline`, sämtliche Indexeinträge dieser Stores, den In-Memory-View-Cache und den Klasse-2-Suchindex.

### Ein Informationsverbund

`deleteVerbund(verbundId)` entfernt den Verbund und seine Dokumente, Entwürfe, Bindungen beider Richtungen, Prüfspurzeilen und Vergleichsbasen in einer Transaktion. Dokumente anderer Verbünde bleiben erhalten.

### Vollständiger Arbeitsbereich

`deleteAll("delete-workspace")` schließt die eigene Verbindung und ruft `deleteDatabase('gspp-workspace')` auf. Bei `onblocked` meldet der Adapter nach `WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS` (2 000 ms) `WORKSPACE_DELETE_PENDING`. Der Code bedeutet: Die Löschung ist angefordert, der Bestand ist bis zum Schließen der blockierenden Verbindung weiter vorhanden, und der Browser schließt die Löschung danach ab. Der Browser kann einen gestarteten Löschrequest nicht abbrechen; die eigene Verbindung des Adapters ist bereits geschlossen, ein Export über diese Instanz ist danach nicht möglich. Der Browser reiht jedes weitere Öffnen hinter dem ausstehenden Löschrequest ein; `WorkspaceStore.open()` meldet dann nach `WORKSPACE_OPEN_TIMEOUT_MS` (2 000 ms) `WORKSPACE_OPEN_TIMEOUT`. Endet die Existenzprüfung des abgebrochenen Öffnens erst nach dieser Frist, legt der Adapter keine Datenbank an; kommt die Verbindung erst nach der Frist zustande, schließt er sie sofort wieder. Der Adapter hält weder Quellgraphen noch Views oder Suchindizes als Cache.

### Vollständige Aufzählung der Löschziele

| Ziel | erfasst durch |
| --- | --- |
| `verbuende`, `documents`, `drafts`, `bindings`, `reviewTrail`, `reviewBaseline`, `workspaceMeta` | Dokument-, Verbund- bzw. Gesamtlöschung |
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

### Keine Verschlüsselung

Der lokale Speicher wird **nicht** verschlüsselt. Es gibt keine Instanz für Hinterlegung oder Rücksetzung eines Schlüssels; die einzige Quelle wäre eine Nutzer-Passphrase, deren Verlust endgültigen, nicht wiederherstellbaren Datenverlust bedeutete. Gegen die schwerste Restgefahr — Ausführung fremden Codes im eigenen Origin — schützte die Verschlüsselung ohnehin nicht, weil der Klartext zur Laufzeit im Speicher liegt. An ihre Stelle treten die Grenzaussage (§14) und der Export als Schutz- und Wiederherstellungsmaßnahme (§11). Eine spätere Einführung verlangt einen eigenen ADR zur Recovery-Frage ohne Backend.

## 14. Vorgaben an die Datenschutzseite

Dieser Vertrag trifft **keine** datenschutzrechtlichen Aussagen. Die rechtliche Einordnung liegt in [GSPP-341](https://linear.app/grundschutz-plus-plus/issue/GSPP-341) und ist dort verantwortet. Mit der ersten Speicherfunktion bildet die Datenschutzseite ab:

1. Dass eigene Dokumente auf Wunsch im Browser gespeichert werden und das Gerät nicht verlassen.
2. Dass die Anwendung keine Löschfrist setzt und nichts automatisch löscht, der Browser lokal gespeicherte Daten aber ohne Rückfrage entfernen kann (§3).
3. Dass einzelne Dokumente und der gesamte Arbeitsbereich vollständig gelöscht werden können.
4. Dass die Ablage **unverschlüsselt** erfolgt und was daraus für geteilte Geräte und Geräteverlust folgt (§13).
5. Dass es keine Kopie beim Betreiber gibt und der Export deshalb die einzige Sicherung ist.
6. Dass Prüfspur und Vergleichsbasis lokal bleiben, eine Freigabe Rollen-, Partei- und Begründungsangaben in das exportierte Dokument schreibt und weder Signatur noch Identitätsprüfung stattfinden.

Die Projektbegriffe „Klasse 1", „Klasse 2" und „Arbeitsbereich" erscheinen im Seitentext nicht.

## 15. Testorakel

Die Browsertests `src/test/browser/workspace*.browser.test.ts` prüfen mit nativer IndexedDB unter dem Egress-Guard Schema, Transaktionen, Konflikte, Quota, Backup und Wiederherstellung beider Bündelformate, Löschung und Migration. Die Tests `src/adapters/workspace*.test.ts` prüfen die fail-closed Eingangsgrenzen der Bündel, den Backup-Worker und deterministische IndexedDB-Fehlerfälle mit `fake-indexeddb`. Jedes Orakel benennt, was verglichen wird und wann der Test fehlschlägt.

### Migrationsorakel

Verglichen wird ein gespeichertes Dokument vor und nach einer Speicher-Schema-Migration in: kanonischer Serialisierung von `source`, `source.<root>.metadata.oscal-version`, `source.<root>.uuid`, `source.<root>.metadata.last-modified` und `localId`. *Fehlschlag,* wenn eines dieser fünf Felder abweicht — oder wenn nach einem absichtlich fehlerhaften Datensatz ein teilmigrierter Zustand vorliegt statt des Vorzustands.

### Löschorakel

Ein Fixture trägt eine eindeutige Sentinel-Zeichenkette in `source`, im persistierten Draft und in einem Bindungseintrag. Nach der Löschung wird gesucht in: allen Objekt-Stores per Cursor, allen Indexschlüsseln, dem View-Cache und dem Klasse-2-Suchindex. *Fehlschlag,* wenn die Zeichenkette noch auffindbar ist — oder wenn bei der Einzellöschung ein Kontrolldokument verschwunden ist.

### Round-trip-Orakel

Ein unverändertes Dokument wird importiert, gespeichert, geladen und exportiert. Verglichen wird die kanonische Serialisierung von Export und Ausgangsdokument sowie einzeln `uuid` und `metadata.last-modified`. *Fehlschlag,* wenn die Serialisierungen abweichen, wenn `uuid` oder `last-modified` sich geändert haben, oder wenn ein Envelope-Feld im Export auftaucht.

### Prüfspur-Orakel

Ein Prüfpunkt über einem gespeicherten Dokument lässt `uuid` und `metadata.last-modified` unverändert und schreibt keine Aktion. Eine Freigabe schreibt genau eine Aktion in `metadata.actions` und genau eine Trail-Zeile `approved`; nach einer Inhaltsänderung meldet der gespeicherte Stand `stale`. *Fehlschlag,* wenn ein Prüfpunkt das Dokument ändert, eine Freigabe ohne Trail-Zeile besteht oder ein überholter Stand weiter als freigegeben gilt.

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
- Verschlüsselung des lokalen Speichers (§13); eine Einführung verlangt einen eigenen ADR
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
