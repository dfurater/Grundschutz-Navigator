# OSCAL-Validierungsvertrag

Dieser Vertrag gilt für OSCAL-JSON-Artefakte, die der Navigator künftig
importiert, exportiert oder in der Build-Pipeline prüft. Er definiert die
Prüfkette und ihre Lieferkette; er aktiviert noch keinen produktiven Import.
YAML und XML sind nicht unterstützt.

Die Validierung ist von der bestehenden
[Integritätsprüfung](INTEGRITY.md) getrennt: SHA-256 schützt die Übereinstimmung
eines ausgelieferten Artefakts mit seinen Build-Metadaten. Die hier beschriebene
Kette prüft Syntax, Modellstruktur und fachliche Invarianten eines Dokuments.
Keine der beiden Prüfungen ist allein ein Herkunfts-, Vertrauens- oder
Compliance-Nachweis.

## Verbindliche Kette

Jede Stufe läuft nur nach erfolgreichem Abschluss der vorherigen Stufe. Ein
Fehler oder eine technisch nicht verfügbare, aber für die jeweilige Aussage
erforderliche Stufe führt fail-closed zu einem negativen Ergebnis. Diagnosen
werden separat erzeugt und verändern dieses Ergebnis nicht.

„CI“ bezeichnet in diesem Dokument die Build- und Prüfzeit auf einem isolierten
GitHub-Actions-Runner; Browserprüfungen laufen ausschließlich im Modul-Worker.

| Stufe | Werkzeug und Ausführungsort | Pinning und Fehlersemantik |
| --- | --- | --- |
| 1. Größenlimit und JSON-Syntax | Plattformfunktionen (`Uint8Array`, fataler UTF-8-Decoder, `JSON.parse`) im isolierten Worker; dieselbe Reihenfolge in CI | Das Byte-Limit muss vor Decoder und Parser gesetzt sein. Fehlt ein Limit oder wird es überschritten, wird nicht geparst. CI verwendet Node 22 gemäß Workflow und der Mindestversion in `package.json`; die Prüflogik ist über den App-Commit gepinnt. |
| 2. Root-Erkennung | Projekteigener exakter Dispatcher im Worker und in CI | Das Top-Level-Objekt muss genau einen der acht bekannten Root-Keys besitzen. Null, Arrays, mehrere Keys, unbekannte Keys und zusätzliche Keys wie `$schema` werden abgelehnt. Eine Katalog-Interpretation als Fallback ist verboten. |
| 3. JSON-Schema | Browser: `ajv` 8.20.0 im Modul-Worker. CI: zusätzlich `go-oscal` 0.7.1 als unabhängiges Schema- und Upgrade-Orakel | Auswahl ausschließlich über den exakten Root×`oscal-version`-Schlüssel. Fehlende Kombinationen werden abgelehnt. Ajv wird erst nach der OSS-Zulassung aus [ADR-5](https://linear.app/grundschutz-plus-plus/issue/ADR-5) produktiv aufgenommen. Bis Paket-Lock, Schema-Manifest und Hashprüfung vorhanden sind, bleibt der betreffende Importpfad deaktiviert. |
| 4. zusätzliche OSCAL-Constraints | Derzeit **kein zugelassener Validator** für OSCAL 1.2.2; im Browser und in CI als `not-checked` ausgewiesen | Diese Stufe darf weder übersprungen noch als bestanden dargestellt werden. Die zulässige Konformitätsaussage wird deshalb begrenzt. Das konkrete Mapping-Orakel ist als bekannte Lücke registriert. |
| 5. Referenzen und Projektregeln | Projekteigener, kataloggescopter Referenzgraph und explizit versionierte Regeln im Worker und in CI; Vertrag in [GSPP-251](https://linear.app/grundschutz-plus-plus/issue/GSPP-251) | Prüft UUID-/ID-Eindeutigkeit, interne und dokumentübergreifende Referenzen, URI- und Medientypregeln sowie ausdrücklich benannte GRC-Regeln. Externe `href`-Ziele werden klassifiziert, niemals während der Validierung abgerufen. Unbekannte Regeln gelten nicht als bestanden. |

Ajv wurde gegenüber `@hyperjump/json-schema` 1.17.7 ausgewählt. Beide
Kandidaten trafen die Schema-Orakel, aber Hyperjump startete in einem echten
ESM-Web-Worker nicht unverändert: Eine transitive Browserkomponente greift auf
`document.location` zu, das im Worker nicht existiert. Ein
Kompatibilitäts-Shim wird nicht Teil der Produktarchitektur. Der vollständige
Auswahlnachweis ist in
[GSPP-282](https://linear.app/grundschutz-plus-plus/issue/GSPP-282)
nachvollziehbar; der temporäre Harnisch gehört nicht in das Repository.

## Root- und Versionsauswahl

Der Root-Key und `metadata.oscal-version` bilden gemeinsam den Schema-Schlüssel.
Die Projektmatrix umfasst ausschließlich die vier im BSI-Bestand belegten
Versionen:

| Root-Key | 1.1.2 | 1.1.3 | 1.2.1 | 1.2.2 |
| --- | --- | --- | --- | --- |
| `catalog` | ja | ja | ja | ja |
| `profile` | ja | ja | ja | ja |
| `component-definition` | ja | ja | ja | ja |
| `system-security-plan` | ja | ja | ja | ja |
| `assessment-plan` | ja | ja | ja | ja |
| `assessment-results` | ja | ja | ja | ja |
| `plan-of-action-and-milestones` | ja | ja | ja | ja |
| `mapping-collection` | **nein** | **nein** | ja | ja |

`mapping-collection` besitzt in OSCAL 1.1.2 und 1.1.3 kein offizielles
Root-Schema. Eine nicht aufgeführte Version, ein fehlendes Schema oder ein
Hashfehler ist daher immer `OSCAL_ROOT_VERSION_UNSUPPORTED`; es wird niemals
eine Nachbarversion verwendet.

Welche Root×Version-Paare produktiv freigegeben sind, bleibt zusätzlich durch
die Versionsmatrix aus
[GSPP-283](https://linear.app/grundschutz-plus-plus/issue/GSPP-283)
begrenzt. Die obige Tabelle beschreibt nur die technisch vorhandenen
NIST-Schemas und erweitert keine Produktfreigabe.

## Lieferkettenregeln

Es gibt keinen Laufzeit-Netzbezug für Schema, Validator, Constraint-Datei oder
Dokumentreferenz.

| Artefakt | Verbindliche Herkunft und Pinning | Verifikation |
| --- | --- | --- |
| NIST-JSON-Schemas | Offizielle Releases `v1.1.2`, `v1.1.3`, `v1.2.1` und `v1.2.2`; root-spezifische JSON-Schemadatei | Eine maschinenlesbare Allowlist bindet Release, Root, Version, Dateiname und SHA-256. Download ist nur in einem expliziten Wartungslauf erlaubt. Fehlender oder abweichender Hash blockiert Build und Import. |
| Ajv | npm-Paket `ajv` exakt 8.20.0, MIT | `package-lock.json` bindet Tarball und SRI-Integrität. Die OSS-Zulassung prüft Lizenz, Herkunft, Wartung, Transitivabhängigkeiten, Sicherheitslage, Bundle-/Worker-Eignung und Updateweg, bevor das Paket produktiv wird. |
| go-oscal | Offizielles GitHub-Release `v0.7.1`, Apache-2.0 | CI lädt nur das Plattformartefakt des exakten Releases, prüft den von GitHub veröffentlichten Asset-Digest und `checksums.txt` und archiviert die zugehörige SBOM als Build-Nachweis. Die ausführbare Datei wird nicht in dieses Repository eingecheckt. |
| Eigene Regeln | App-Quellcode und Tests | Pinning durch Commit-SHA; jede Regel nennt betroffene Root×Version-Paare und stabile Diagnostic-Codes. |

Schema- und Toolupdates sind atomar: neue Datei beziehungsweise neue Version,
neuer Hash, Positiv- und Negativorakel und Review im selben Änderungssatz.
Ein Update, das die Constraint-Lücke oder Diagnostic-Signaturen verändert,
erfordert auch die Anpassung der Aussagegrenzen beziehungsweise der eng
gebundenen Policy-Einträge.

## Befund zur Constraint-Stufe

NIST unterscheidet offiziell JSON-Wohlgeformtheit und Modellvalidität. Das
OSCAL-Metaschema enthält darüber hinaus Constraints, die nicht vollständig in
das generierte JSON-Schema gelangen. Für OSCAL 1.2.2 wurde kein allgemein
geeigneter, reproduzierbar gepinnter Constraint-Validator gefunden:

| Kandidat | Belegter Befund | Entscheidung |
| --- | --- | --- |
| go-oscal 0.7.1 | Unterstützt die relevanten JSON-Schemas bis 1.2.2 und ist das primäre CI-Schema-/Upgrade-Orakel. Das Constraint-Orakel `relationship: "maps-to"` wird akzeptiert. | Beibehalten für Schema und Upgrade, nicht als vollständiger Constraint-Validator ausgeben. |
| Metaschema OSCAL CLI 3.2.0 | Release bindet liboscal-java 7.2.0 und OSCAL 1.2.1. Ein isolierter Constraint-Lauf akzeptiert `maps-to`; der ungültige Status wird abgelehnt. Eine belastbare 1.2.2-Abdeckung ist nicht belegt. | Nicht in CI aufnehmen; kein zusätzlicher, versionsgerechter Bedarf gegenüber go-oscal erfüllt. |
| Compliance Trestle 4.2.0 | Deklariert OSCAL 1.2.1. Der isolierte Mapping-Lauf akzeptiert sowohl `maps-to` als auch den schemawidrigen Status. | Nicht als Schema- oder Constraint-Orakel verwenden. |
| Originale NIST OSCAL CLI 1.0.3 | Modellstand ist für den unterstützten Bestand zu alt. | Nicht verwenden. |

Solange dieser Negativbefund gilt, darf der Navigator insbesondere nicht
behaupten:

- ein Dokument erfülle alle OSCAL-Metaschema-Constraints;
- ein Dokument sei uneingeschränkt „OSCAL-konform“;
- ein Mapping verwende nach bestandener Schema-Prüfung nur das kontrollierte
  OSCAL-Beziehungsvokabular;
- Schema-Validität belege Referenzintegrität, fachliche Richtigkeit,
  Vertrauenswürdigkeit, Freigabe oder Compliance.

Zulässig sind nur präzise Teilbefunde wie „gültiges JSON“, „gegen das gepinnte
JSON-Schema für Root und Version geprüft“ und „die ausdrücklich benannten
Projektregeln wurden geprüft“. Der Status der Constraint-Stufe muss daneben
sichtbar bleiben.

## Prüftiefen-Landkarte für Mapping 1.2.2

Die unterschiedliche Tiefe entsteht durch die Modellierung im NIST-Metaschema:
`relationship` ist ein Feld, dessen bedingte `allowed-values` nicht in das
JSON-Schema übernommen werden. `method`, `matching-rationale` und `status` sind
Flags; ihre Wertelisten erscheinen als Enum im generierten JSON-Schema.

| JSON-Pfad | JSON-Schema | Zusätzlicher Metaschema-Constraint | Konsequenz |
| --- | --- | --- | --- |
| `/mapping-collection/mappings/*/maps/*/relationship` | Pflichtfeld und `TokenDatatype`, kein Enum | Bei OSCAL-Namespace nur `equivalent-to`, `equal-to`, `subset-of`, `superset-of`, `intersects-with`, `no-relationship` | `maps-to` besteht die Schema-Stufe, obwohl es den OSCAL-Constraint verletzt. |
| `/mapping-collection/provenance/method` und `/mapping-collection/mappings/*/method` | Enum `human`, `automation`, `hybrid` | dieselbe Werteliste | Ungültige Werte scheitern bereits am Schema. |
| `/mapping-collection/provenance/matching-rationale`, optional auf Mapping und Map | Enum `syntactic`, `semantic`, `functional` | dieselbe Werteliste | Ungültige Werte scheitern bereits am Schema. |
| `/mapping-collection/provenance/status` und `/mapping-collection/mappings/*/status` | Enum `complete`, `not-complete`, `draft`, `deprecated`, `superseded` | dieselbe Werteliste | `veröffentlicht` scheitert bereits am Schema. |

Primärquellen sind die
[Mapping-Referenz 1.2.2](https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/mapping/json-reference/),
die [Mapping-Metaschema-Quelle](https://github.com/usnistgov/OSCAL/blob/v1.2.2/src/metaschema/oscal_mapping-common_metaschema.xml#L99-L150)
und die [Wertelisten für Status und Methode](https://github.com/usnistgov/OSCAL/blob/v1.2.2/src/metaschema/oscal_mapping-common_metaschema.xml#L590-L642).

## Diagnostic-Vertrag

Jede Diagnose ist maschinenlesbar und besitzt mindestens:

```json
{
  "code": "OSCAL_SCHEMA_ADDITIONAL_PROPERTY",
  "severity": "error",
  "stage": "json-schema",
  "artifact": {
    "key": "mapping-iso27001-annex-a-zu-gspp",
    "rootType": "mapping-collection",
    "oscalVersion": "1.2.2"
  },
  "path": "/mapping-collection/provenance/qa-reviewed",
  "validator": {
    "name": "go-oscal",
    "version": "0.7.1"
  },
  "signature": "go-oscal@0.7.1|additionalProperties|/mapping-collection/provenance|qa-reviewed",
  "messageKey": "oscal.schema.additionalProperty",
  "params": {
    "keyword": "additionalProperties",
    "propertyName": "qa-reviewed"
  }
}
```

`stage` verwendet die stabilen Werte `resource-limit`, `json-syntax`,
`root-dispatch`, `json-schema`, `oscal-constraint`, `reference` und `domain`.
Der Artefaktkontext kann zusätzlich Lifecycle und Snapshot tragen. Dieses
Grundformat wird von der Referenzprüfung aus
[GSPP-251](https://linear.app/grundschutz-plus-plus/issue/GSPP-251)
wiederverwendet; es entsteht kein zweites Diagnosemodell.

### Redaction

Diagnosen werden aus einer Positivliste konstruiert, nicht aus rohen
Validatorobjekten gefiltert. Erlaubt sind stabile Codes, bekannte
Registry-Schlüssel, Root/Version, strukturelle JSON Pointer, Validatorpin,
Signatur, Message-Key und ausdrücklich freigegebene strukturelle Parameter.

Verboten sind insbesondere:

- `failedValue`, `rawValue` und andere Dokumentwerte;
- Titel, Beschreibungen, Bemerkungen, Evidenzen und Geheimnisse;
- komplette Validator-Meldungen, Stacktraces und lokale Systempfade;
- Dokument- oder Referenz-URLs sowie Request-/Response-Inhalte;
- unvertrauenswürdiges Markup oder dessen HTML-Rendering.

Beispiel: Ein roher Validatorbefund mit `failedValue: "<EVIDENZ>"`, lokalem
Dateipfad und Stacktrace wird ausschließlich als Code, Stufe, sicherer
Strukturpfad und Message-Key ausgegeben. Der Marker, Pfad und Stack erscheinen
weder in Einzeldiagnose noch CI-Zusammenfassung. Kann ein Validatorbefund nicht
sicher normalisiert werden, entsteht stattdessen
`OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED` und das Gate schlägt fehl.

## Bekannte BSI-Schemaabweichungen

Ausnahmen sind ausschließlich CI-Policy. Sie unterdrücken keine Diagnose und
ändern `validationValid: false` niemals in `true`. Separat darf
`policyAccepted: true` nur entstehen, wenn **jede** Diagnose exakt durch einen
Eintrag mit diesen fünf Feldern gedeckt ist:

1. Artefaktschlüssel,
2. Root-Typ,
3. `oscal-version`,
4. normalisierter Feldpfad,
5. Diagnosesignatur einschließlich Validatorpin und strukturellem Fehlermerkmal.

Begründung und Erfassungsdatum sind Pflichtmetadaten. Jede weitere Diagnose,
eine geänderte Signatur oder derselbe Pfad mit einer anderen Fehlerart lässt das
Policy-Gate fehlschlagen.

Der erste bekannte Befund stammt aus einem tatsächlichen go-oscal-0.7.1-Lauf.
Der Validator meldet die zusätzlichen Eigenschaften gemeinsam am
`provenance`-Objekt. Der Adapter zerlegt ausschließlich diese strukturelle
Eigenschaftsliste deterministisch in zwei weiterhin sichtbare Diagnosen:

| Artefakt | Root / Version | Feldpfad und Signatur | Begründung / erfasst |
| --- | --- | --- | --- |
| `mapping-iso27001-annex-a-zu-gspp` | `mapping-collection` / 1.2.2 | `/mapping-collection/provenance/qa-reviewed` — `go-oscal@0.7.1\|additionalProperties\|/mapping-collection/provenance\|qa-reviewed` | bekannte BSI-QA-Erweiterung / 2026-08-01 |
| `mapping-iso27001-annex-a-zu-gspp` | `mapping-collection` / 1.2.2 | `/mapping-collection/provenance/qa-note` — `go-oscal@0.7.1\|additionalProperties\|/mapping-collection/provenance\|qa-note` | bekannte BSI-QA-Erweiterung / 2026-08-01 |

Wenn die Aggregatmeldung nicht exakt aus diesen beiden Eigenschaften besteht,
wird sie nicht zerlegt und nicht von der Policy akzeptiert. Die schemafremden
Felder bleiben im verlustfreien Dokument erhalten.

## Belegte Orakel

Der temporäre Prototyp verwendete ausschließlich checksum-geprüfte Artefakte
des gepinnten BSI-Snapshots; weder Artefakte noch Testharnisch werden im
Repository gehalten.

| Fall | Erwarteter und beobachteter Befund |
| --- | --- |
| reales `catalog-gspp`, OSCAL 1.1.3 | Root-/Versionswahl und Schema-Prüfung bestehen. Eine abgeleitete Variante ohne Pflichtfeld `metadata.title` scheitert an der Schema-Stufe. |
| reales ISO→Grundschutz++-Mapping, OSCAL 1.2.2 | Das unveränderte Artefakt bleibt wegen `qa-reviewed` und `qa-note` schema-invalid; die separate Policy kann nur diese exakten Diagnosen akzeptieren. |
| aus dem realen Mapping abgeleitet, `relationship: "maps-to"` | JSON-Schema besteht; die nicht verfügbare allgemeine Constraint-Stufe bleibt als Lücke sichtbar. |
| aus dem realen Mapping abgeleitet, `status: "veröffentlicht"` | JSON-Schema scheitert. |
| null, mehrere, unbekannte oder zusätzliche Root-Keys | Root-Erkennung scheitert. |
| nicht vorhandenes Root×Version-Paar | Auswahl scheitert ohne Fallback. |
| Dokument über dem konfigurierten Byte-Limit | Ablehnung erfolgt vor Decoder und Parser. |
| Validierung nach initialem Laden im Browser-Worker | Keine Schema- oder Dokumentanfrage wird ausgelöst. |

## Quellen

- [NIST: OSCAL-Validierungsbegriffe](https://pages.nist.gov/OSCAL/learn/concepts/validation/)
- [NIST: OSCAL-Layer und Modelle](https://pages.nist.gov/OSCAL/learn/concepts/layer/)
- [NIST: OSCAL 1.2.2 Release](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.2)
- [NIST: OSCAL 1.2.2 Model Reference](https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/)
- [go-oscal 0.7.1 Release](https://github.com/defenseunicorns/go-oscal/releases/tag/v0.7.1)
- [Metaschema OSCAL CLI 3.2.0 Release](https://github.com/metaschema-framework/oscal-cli/releases/tag/v3.2.0)
- [Compliance Trestle 4.2.0 Release](https://github.com/oscal-compass/compliance-trestle/releases/tag/v4.2.0)
