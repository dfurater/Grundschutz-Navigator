# OSCAL-Versionsmatrix und Migrationspolitik

Dieses Dokument legt verbindlich fest, welche Kombinationen aus OSCAL-Root-Typ
und deklarierter Modellversion der Navigator kennt, welches NIST-Schema für
jede Kombination gilt, woher dieses Schema stammt und wie ein Versionswechsel
abgearbeitet wird.

Es beschreibt **was gegen welches Schema** geprüft wird. **Womit und wo**
geprüft wird, steht im [Validierungsvertrag](OSCAL_VALIDATION.md).

## Verankerung und einzige Quelle der Wahrheit

Die Matrix lebt als Daten in
[`src/domain/oscalVersionMatrix.mjs`](../src/domain/oscalVersionMatrix.mjs),
**nicht** in `sourceRegistry.mjs`. Begründung:

- Die Matrix führt alle **acht** OSCAL-Root-Modelle, auch die vier noch nicht
  registrierten. Das Quellregister ist bewusst auf tatsächlich existierende
  BSI-Upstream-Pfade begrenzt; dort Zellen für Modelle zu führen, zu denen es
  kein Artefakt gibt, würde seine Aussage verwässern.
- Die beiden Register beantworten verschiedene Fragen. Das Quellregister sagt,
  welche Artefakte es gibt und welche Version das konkrete BSI-Dokument
  deklariert. Die Matrix sagt, welche Root×Version-Paare der Standard kennt und
  welches Schema dafür gilt.

Jeder Fakt hat damit genau einen Ort:

| Fakt | Ort |
| --- | --- |
| Root-Typ × Version existiert im Standard | `oscalVersionMatrix.mjs` |
| Schema-Dateiname, Release-Tag, `$id`, SHA-256, Ablageort | `oscalVersionMatrix.mjs` |
| Deklarierte `oscal-version` eines konkreten BSI-Artefakts | `sourceRegistry.mjs` |
| Lifecycle eines Artefakts (`supported`/`preview`/`draft`/`blocked-by-upstream`) | `sourceRegistry.mjs` |

Der Lifecycle wird bewusst **nicht** in die Matrix dupliziert: er ist eine
Eigenschaft des Artefakts, nicht der Root×Version-Zelle. Die Verbindung
stellt `getSchemaPinForArtifact()` her.

`validateSourceRegistry()` kreuzt beide beim Import: eine fehlende, nicht
gepinnte oder für den Root-Typ unmögliche Version lässt das Modul sofort
scheitern.

## Die Matrix

Acht Root-Modelle über vier gepinnte Versionen ergeben 32 Felder, von denen
**30 existieren**. Alle Werte wurden am 2026-08-01 direkt aus den offiziellen
Release-Assets ermittelt und sind über `npm run verify-oscal-schemas`
reproduzierbar.

| Root-Key | 1.1.2 | 1.1.3 | 1.2.1 | 1.2.2 |
| --- | --- | --- | --- | --- |
| `catalog` | ja | ja | ja | ja |
| `profile` | ja | ja | ja | ja |
| `mapping-collection` | **nein** | **nein** | ja | ja |
| `component-definition` | ja | ja | ja | ja |
| `system-security-plan` | ja | ja | ja | ja |
| `assessment-plan` | ja | ja | ja | ja |
| `assessment-results` | ja | ja | ja | ja |
| `plan-of-action-and-milestones` | ja | ja | ja | ja |

### Verbotene Zellen

`mapping-collection` wurde mit OSCAL 1.2.0 eingeführt. In den Releases v1.1.2
und v1.1.3 liefert `oscal_mapping_schema.json` HTTP 404. Ein
`mapping-collection`-Dokument mit einer Version unter 1.2.0 ist deshalb nicht
„schwer validierbar", sondern in sich widersprüchlich und wird mit einer
eigenen Diagnose (`OSCAL_ROOT_VERSION_IMPOSSIBLE`) abgelehnt — auch für
Versionen, die das Projekt gar nicht pinnt.

## Schema-Provenienz

Bezugsmuster:
`https://github.com/usnistgov/OSCAL/releases/download/v<VERSION>/<ASSET>`

Ablageort im Repository: `schemas/oscal/v<VERSION>/<ASSET>`

Seit [GSPP-343](https://linear.app/grundschutz-plus-plus/issue/GSPP-343) liegen
alle 30 existierenden Zellen als Datei dort — zusammen 2 967 207 Bytes. Die
beiden unmöglichen `mapping-collection`-Zellen haben bewusst **keine** Datei.
Eingecheckt wurden sie gemeinsam mit Validator, Paket-Lock, Hashprüfung und
Implementierung, wie der Validierungsvertrag es verlangt.

Die Artefakte stammen unverändert aus den offiziellen NIST-Releases und stehen
unter **CC0 1.0 / Public Domain** mit erbetener Quellennennung
([`LICENSE.md` @ v1.2.2](https://github.com/usnistgov/OSCAL/blob/v1.2.2/LICENSE.md)).
Quelle ist das OSCAL-Projekt von NIST, <https://github.com/usnistgov/OSCAL>.

### Zwei Kommandos, zwei Aufgaben

| Kommando | Netz | Prüft | Läuft in CI |
| --- | --- | --- | --- |
| `npm run verify-oscal-schemas` | nein | die **eingecheckten** Bytes: SHA-256, `$id`, `$schema` = draft-07, und dass unter `schemas/oscal/` keine Datei ohne Pin liegt | ja |
| `npm run sync-oscal-schemas` | ja | einen **frischen Download** gegen dieselben Pins und legt ihn ab | nein |

Der Verify-Lauf (`scripts/verify-oscal-schemas.mjs`) nimmt kein `fetch` in die
Hand; das ist als Test festgehalten. Der Wartungslauf
(`scripts/sync-oscal-schemas.mjs`) bleibt der einzige Ort, an dem ein Schema
über das Netz bezogen werden darf, und läuft nur auf ausdrückliche Anforderung.

`.gitattributes` schließt für `schemas/oscal/**` die Zeilenenden-Normalisierung
aus (`-text`). Ohne diese Zeile würde ein Clone mit `core.autocrlf=true` die
Bytes verändern und die Hashprüfung auf genau dieser Maschine falsch-rot
machen, bei unverändertem Repository-Inhalt.

Die Bytes werden zur Laufzeit **nicht** erneut gehasht. Der Bundler
transformiert sie, und ein im selben Bundle mitgelieferter Sollwert würde sich
selbst bestätigen; die Abgrenzung zur Laufzeitprüfung der
`public/data/`-Artefakte steht in [INTEGRITY.md](./INTEGRITY.md#überblick).

### Die `$id` ist nicht aus dem Dateinamen ableitbar

NIST verwendet bei drei der acht Root-Typen im Asset-Namen einen anderen
Bezeichner als in der `$id`. Eine abgeleitete Prüfung würde dort falsch
fehlschlagen; die `$id` ist deshalb pro Root-Typ explizit gepinnt.

| Asset-Name | `$id`-Bezeichner |
| --- | --- |
| `oscal_component_schema.json` | `oscal-component-definition-schema` |
| `oscal_assessment-plan_schema.json` | `oscal-ap-schema` |
| `oscal_assessment-results_schema.json` | `oscal-ar-schema` |

Die übrigen fünf Root-Typen verwenden denselben Bezeichner in beiden.

### Gepinnte Zellen

| Root-Key | Version | Asset | SHA-256 |
| --- | --- | --- | --- |
| `catalog` | 1.1.2 | `oscal_catalog_schema.json` | `5b069afa4f4ecc38d59914dab56098566d4247d3578a2123c030c80d36fc5104` |
| `catalog` | 1.1.3 | `oscal_catalog_schema.json` | `5e120afbd14c480a9498ab6388857ef32b3b880e458525e966ff7c7f59333d90` |
| `catalog` | 1.2.1 | `oscal_catalog_schema.json` | `c0ae626d6bafe318db68692152d0cbbebf29ba7226b1596a5513cc5d1754504d` |
| `catalog` | 1.2.2 | `oscal_catalog_schema.json` | `fdc559f5dff6848b1ebbe1898a69cc08263479f7c796e2f056412059e7489d0c` |
| `profile` | 1.1.2 | `oscal_profile_schema.json` | `c910ea1a852e9d4ccfb7f6a8d0898b0cd4f137e48f88886412a083c8d87d540a` |
| `profile` | 1.1.3 | `oscal_profile_schema.json` | `d14c99b4bc48cb1ef370cd27a78c23e04bab847e737e11f478b37714db30851b` |
| `profile` | 1.2.1 | `oscal_profile_schema.json` | `3b92e83ef9043af573ca81a451f899adf6855440b0974fb448b9c635fead7983` |
| `profile` | 1.2.2 | `oscal_profile_schema.json` | `04329bd68032f48825f712f79576b3fd00e129e59d3597beb56ed72c17277f66` |
| `mapping-collection` | 1.1.2 | — | **existiert nicht** |
| `mapping-collection` | 1.1.3 | — | **existiert nicht** |
| `mapping-collection` | 1.2.1 | `oscal_mapping_schema.json` | `5b8f6f9b8117bb42ad8466d11d1695f0be9cc31350c2a3aea770614d96d70d3f` |
| `mapping-collection` | 1.2.2 | `oscal_mapping_schema.json` | `45b4f909f72e17fbe8476e2a7f3d9f64ec42dc26ab2fe2d56c6b44fc57346022` |
| `component-definition` | 1.1.2 | `oscal_component_schema.json` | `7b74710940ad39b6b63d4ddccbadf2c7d2e9bf11b07808d41d2aa27a4616e5ce` |
| `component-definition` | 1.1.3 | `oscal_component_schema.json` | `9bde069f8f65ec82ea626348cc40ae5d42b0f74c1a2a8b9289a1604bf521a15c` |
| `component-definition` | 1.2.1 | `oscal_component_schema.json` | `ce95b3b3ea8de87c020ad4a91075241f6f863a77afe212ee828009830d6042d1` |
| `component-definition` | 1.2.2 | `oscal_component_schema.json` | `3b6e0765c44037c4d1bfb2cdb972713917d3eca73e566c0e6c6881a565638830` |
| `system-security-plan` | 1.1.2 | `oscal_ssp_schema.json` | `08d3faeb12f0fab7705dec15fb648c72400c7ab6ac0056222d49d21507e02a69` |
| `system-security-plan` | 1.1.3 | `oscal_ssp_schema.json` | `da5f452b9e7bdf85246b79ed32475cd419321eb600e6928439ae67aef5a63e53` |
| `system-security-plan` | 1.2.1 | `oscal_ssp_schema.json` | `3027ffb23ba94a8ca4e43ce9417cf2b02f27b7c36d8a4ead8fe2905483c6d10a` |
| `system-security-plan` | 1.2.2 | `oscal_ssp_schema.json` | `d7f9bf67101829083472a8f058a5b5ef078e09b3f699ac0c4dbe33a5b0671b6a` |
| `assessment-plan` | 1.1.2 | `oscal_assessment-plan_schema.json` | `43464ad048b711c735934b66015bcf8239782c6263d377a742c6b205ea796ecb` |
| `assessment-plan` | 1.1.3 | `oscal_assessment-plan_schema.json` | `0850be91252390dde740a98fd2f0fc504cd0ba66fe8940c2b6242b7aa2fb36eb` |
| `assessment-plan` | 1.2.1 | `oscal_assessment-plan_schema.json` | `0153e4e0414903c51c13732d4158d955630e33a3ef009d2691cf3e07336136f4` |
| `assessment-plan` | 1.2.2 | `oscal_assessment-plan_schema.json` | `ba265f05982969142cbc3c6ed6bb99e0880081ceb366c152e44fe7e2b08aa125` |
| `assessment-results` | 1.1.2 | `oscal_assessment-results_schema.json` | `d033da70154cf6625ae46a746199e88e58f2928b1387dfac051d381b92f41b0d` |
| `assessment-results` | 1.1.3 | `oscal_assessment-results_schema.json` | `d9e34757f0c12aff61f52b821f0b8f83ba0ba75b3a149a202b08ba82f82bc4c3` |
| `assessment-results` | 1.2.1 | `oscal_assessment-results_schema.json` | `4f9e277a177adbcca9527612ce450a33dc6096773fa229d413d801d196c61985` |
| `assessment-results` | 1.2.2 | `oscal_assessment-results_schema.json` | `d4e1e7e17c6662814882810ad64075266964ee1a575759ce3955302fd74edcd9` |
| `plan-of-action-and-milestones` | 1.1.2 | `oscal_poam_schema.json` | `906725163d767036c6189aec51252109b203214e121fc1acaff494b4d2dfbc04` |
| `plan-of-action-and-milestones` | 1.1.3 | `oscal_poam_schema.json` | `e404043fef9cc6108c0e895932f513043d54f28457b4eb02e74dc0cff1215e16` |
| `plan-of-action-and-milestones` | 1.2.1 | `oscal_poam_schema.json` | `c02062bbc6f5092012286cbc6161b643eb6aecfbb918cb5790be777860da2c11` |
| `plan-of-action-and-milestones` | 1.2.2 | `oscal_poam_schema.json` | `c8f2ce52b3c71299bb0c9e1cd950d48dc79d9f52920c543ac30b3c3f08c2e152` |

Die Releases 1.2.1 und 1.2.2 erzeugen für jeden Root-Typ byte-gleich große
Dateien mit unterschiedlichem Inhalt. Größe allein unterscheidet sie also
nicht; nur der Hash trennt sie.

## Bauzeitgarantie: kein Schemabezug von einer fremden Origin

Kein Schema wird zur Laufzeit von einem fremden Host bezogen. Die Bytes stammen
ausnahmslos aus den eingecheckten, gehashten Dateien unter `schemas/oscal/`;
`github.com` und `csrc.nist.gov` werden zur Laufzeit nie angefragt.

Das ist **nicht** gleichbedeutend mit „kein Netzverkehr“: Der Worker lädt den
Chunk der ausgewählten Zelle zur Laufzeit als Modul **derselben Origin** nach,
damit nicht alle 30 Schemas in einer Datei liegen. Wo diese Grenze im Code und
im Browserorakel verläuft, steht in
[OSCAL_VALIDATION.md](./OSCAL_VALIDATION.md#schemazugriff-ein-lazy-chunk-derselben-origin-kein-externer-bezug).

Die Garantie ruht auf drei Stützen:

1. Es gibt genau einen Ort, der ein Schema beziehen darf:
   [`scripts/sync-oscal-schemas.mjs`](../scripts/sync-oscal-schemas.mjs). Er
   ist nicht Teil von `npm run build`, `npm run dev` oder `npm run
   fetch-catalog` und läuft nur auf ausdrückliche Anforderung.
2. Der Startpunkt muss eine HTTPS-URL auf
   `github.com/usnistgov/OSCAL/releases/download/` ohne Query sein; ein
   manipulierter Pin mit fremdem Host wird vor dem ersten Netzaufruf
   abgewiesen.
3. Die Matrix selbst enthält keinen Ladepfad — `resolveSchemaBinding()` liefert
   nur Metadaten und greift nie auf das Netz zu.

### Redirects werden Hop für Hop validiert

GitHub liefert Release-Assets nicht selbst aus, sondern antwortet mit `302`
auf einen eigenen Asset-Host mit signierter Query:

```
github.com  →302→  release-assets.githubusercontent.com  →200
```

Der Wartungslauf folgt deshalb **nicht** automatisch (`redirect: 'manual'`),
sondern prüft jeden Sprung einzeln gegen eine Allowlist. Erlaubt sind nur die
strenge NIST-Release-Form und die GitHub-Asset-Hosts
`release-assets.githubusercontent.com` und `objects.githubusercontent.com`;
letztere dürfen die signierte Query tragen, aber keine Credentials. Die Kette
ist auf fünf Sprünge begrenzt.

Ein automatisches Folgen wäre nicht ausreichend: die Hash- und
`$id`-Prüfung schützt den **Inhalt**, nicht die **Netzgrenze**. Ein Redirect
von der freigegebenen Release-URL auf einen fremden Host bliebe sonst
unbemerkt, solange die gelieferten Bytes ihre Pins treffen. Wechselt GitHub
den Asset-Host, scheitert der Wartungslauf fail-closed und benennt den
unerwarteten Host, statt ihm still zu folgen.

## Verhalten bei Versionsabweichung

Fail-closed. Es wird niemals gegen eine benachbarte Version validiert, und ein
Dokument wird nie „bestmöglich" interpretiert.

| Fall | Diagnosecode |
| --- | --- |
| Root-Key ist keiner der acht | `OSCAL_ROOT_TYPE_UNKNOWN` |
| `metadata.oscal-version` fehlt oder ist leer | `OSCAL_VERSION_MISSING` |
| Version ist kein `x.y.z` | `OSCAL_VERSION_MALFORMED` |
| Modell existierte in dieser Version noch nicht | `OSCAL_ROOT_VERSION_IMPOSSIBLE` |
| Version ist gültig, aber nicht gepinnt | `OSCAL_ROOT_VERSION_UNSUPPORTED` |
| `$schema` widerspricht der deklarierten Version | `OSCAL_SCHEMA_DIRECTIVE_CONFLICT` |
| Schemadatei trifft ihren Hash nicht | `OSCAL_SCHEMA_HASH_MISMATCH` |
| Schemadatei trifft ihre `$id` nicht | `OSCAL_SCHEMA_ID_MISMATCH` |

Die Prüfreihenfolge ist festgelegt: Root-Typ, dann Versionsform, dann
Modellexistenz, erst dann der Pin. Ein `mapping-collection` mit Version 1.0.4
erhält deshalb die inhaltlich stärkere Diagnose „Modell existierte noch nicht"
statt der unspezifischen „Version nicht gepinnt".

Diagnosen nennen Artefaktschlüssel, Root-Typ, erwartete und gefundene Version
— niemals Dokumentinhalte.

### `metadata.version` ist kein Versionsindikator

`metadata.version` ist die Dokumentversion des Autors, `metadata.oscal-version`
die Modellversion. Nur letztere steuert die Schemaauswahl. Der BSI-Bestand
belegt, warum das wichtig ist: `metadata.version` trägt dort Zeitstempel
(`2026-07-29T06:42:34.226285+00:00`), QA-Marker (`1.0.1-qa`) und freie
Bezeichner (`gsmap-oscal-export-v1`). Keiner davon ist eine OSCAL-Version.

### `$schema` ist zulässig, aber nie Autorität

Siehe [Validierungsvertrag](OSCAL_VALIDATION.md#die-schema-direktive-schema).
Kurz: NIST deklariert `$schema` in jedem Root-Schema ausdrücklich als erlaubte
Property, sie ist aber optional und wertfrei. Allein `metadata.oscal-version`
wählt aus; ein widersprüchliches `$schema` führt zur Ablehnung.

## Migrationspolitik

Beide Fälle sind getrennt zu behandeln.

### Fall A — NIST veröffentlicht ein neues Release

Ein neues NIST-Release erweitert die Matrix **nicht** automatisch. Eine neue
Version wird nur aufgenommen, wenn ein registriertes Artefakt sie tatsächlich
deklariert oder eine Produktentscheidung sie verlangt.

Zwingende Schritte, alle in **einem** Änderungssatz:

1. Für jeden der acht Root-Typen prüfen, ob das Release-Asset existiert. Ein
   404 ist eine verbotene Zelle und wird als solche modelliert, nicht als
   Lücke behandelt.
2. `PINNED_OSCAL_VERSIONS` erweitern und für jede existierende Zelle
   Dateiname, `$id`-Bezeichner, SHA-256 und Größe eintragen.
3. Die `$id` jedes neuen Assets gegen den erwarteten Bezeichner prüfen — NIST
   hat den Slug in der Vergangenheit nicht immer aus dem Dateinamen abgeleitet.
4. `npm run verify-oscal-schemas` läuft grün.
5. Positiv- und Negativorakel ergänzen; die Coverage-Invariante in
   `validateVersionMatrix()` erzwingt Vollständigkeit.
6. Diese Datei und die Tabelle im Validierungsvertrag aktualisieren.

Eine ältere Version wird erst entfernt, wenn kein registriertes Artefakt sie
mehr deklariert. Die Matrix schrumpft nie schneller als der Bestand.

### Fall B — ein BSI-Artefakt wechselt seine Version

Ein Versionswechsel im Upstream ist eine Bestandsänderung, keine
Standardänderung. Er wird im Sync-Lauf **automatisch bemerkt**: sowohl
`scripts/fetch-catalog.mjs` als auch `scripts/catalog-sync-guard.mjs`
vergleichen die gelesene `metadata.oscal-version` gegen die Registry-Erwartung
und brechen bei Abweichung ab.

Zwingende Schritte:

1. Die neue deklarierte Version am gepinnten Snapshot auslesen und dabei
   Git-Blob-SHA und SHA-256 gegen `upstream-manifest.json` verifizieren.
2. Prüfen, ob die Zielversion gepinnt ist. Falls nicht, zuerst Fall A
   abarbeiten — niemals gegen eine Nachbarversion ausweichen.
3. Prüfen, ob die Kombination aus Root-Typ und neuer Version möglich ist.
4. `oscalVersion` des Eintrags in `sourceRegistry.mjs` aktualisieren und den
   Erwartungswert im Kompatibilitätstest mitziehen.
5. Bei einem `supported`-Artefakt zusätzlich den vollständigen Fetch-Lauf und
   die Integritätskette prüfen.

Eine Konvertierung zwischen OSCAL-Versionen findet nicht statt. Der Navigator
liest jedes Dokument gegen die Version, die es selbst deklariert.

## Kompatibilitätstest

`src/domain/sourceRegistry.test.ts` prüft alle **16** registrierten
OSCAL-Artefakte gegen die Matrix: vollständige Abdeckung, exakte
Versionsübereinstimmung mit einem unabhängig ausgeschriebenen Orakel, ein
auflösbarer Schema-Pin pro Artefakt und die Beschränkung auf genau die vier
gepinnten Versionen.

Das Orakel ist bewusst ausgeschrieben und nicht aus der Registry abgeleitet,
damit eine stille Änderung an der Registry auffällt.

## Deklarierte Versionen im Bestand

Ausgelesen am BSI-Snapshot `47de2824a341812438ef3f044b3f65ce2cad6e32`;
Git-Blob-SHA und SHA-256 jedes Dokuments wurden dabei gegen
`upstream-manifest.json` verifiziert.

| Artefakt | Root-Typ | `oscal-version` |
| --- | --- | --- |
| `catalog-gspp` | `catalog` | 1.1.3 |
| `catalog-iso27001-annex-a` | `catalog` | 1.1.3 |
| `catalog-lieferkette` | `catalog` | 1.1.3 |
| `catalog-mindeststandard-tls` | `catalog` | 1.1.3 |
| `catalog-wlan` | `catalog` | 1.1.3 |
| `profile-gspp` | `profile` | 1.1.3 |
| `profile-lieferkette` | `profile` | 1.1.3 |
| `profile-wlan` | `profile` | 1.1.3 |
| `mapping-iso27001-annex-a-zu-gspp` | `mapping-collection` | 1.2.2 |
| `mapping-itgs2023-zu-gspp` | `mapping-collection` | 1.2.1 |
| `component-aws-security-hub` | `component-definition` | 1.1.3 |
| `component-ga-lotse-grundmodul` | `component-definition` | 1.1.2 |
| `component-keycloak` | `component-definition` | 1.2.2 |
| `component-lieferkette` | `component-definition` | 1.1.2 |
| `component-netzarchitektur` | `component-definition` | 1.2.2 |
| `component-passwortrichtlinie` | `component-definition` | 1.1.2 |

Die Component Definitions allein spannen drei Versionen, die beiden Mapping
Collections liegen auf zwei verschiedenen. Ein einzelner „OSCAL-1.1.3-Raw-Typ"
deckt den Bestand nachweislich nicht ab.

## Quellen

Alle abgerufen 2026-08-01.

- [NIST OSCAL Releases](https://github.com/usnistgov/OSCAL/releases)
- [OSCAL 1.2.2](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.2) ·
  [1.2.1](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.1) ·
  [1.1.3](https://github.com/usnistgov/OSCAL/releases/tag/v1.1.3) ·
  [1.1.2](https://github.com/usnistgov/OSCAL/releases/tag/v1.1.2)
- [Versionierte Model Reference](https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/)
- [OSCAL-Validierungsbegriffe](https://pages.nist.gov/OSCAL/learn/concepts/validation/)
- [Beispielkorpus oscal-content](https://github.com/usnistgov/oscal-content)
