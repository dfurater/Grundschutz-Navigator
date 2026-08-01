/**
 * OSCAL-Versionsmatrix: Root-Typ × OSCAL-Version × gepinntes JSON-Schema
 * (GSPP-283).
 *
 * Einzige Quelle der Wahrheit dafür, welche Kombination aus OSCAL-Root-Typ und
 * deklarierter `metadata.oscal-version` der Navigator kennt, welches
 * NIST-Schema dafür gilt und woher dieses Schema stammt. Bewusst getrennt vom
 * Quellregister (`sourceRegistry.mjs`): die Registry beantwortet, welche
 * BSI-Upstream-Pfade existieren und welche Version ein konkretes Artefakt
 * deklariert; diese Matrix beantwortet, welche Root×Version-Paare es im
 * OSCAL-Standard überhaupt gibt. Beide Fakten haben genau einen Ort.
 *
 * Die Matrix führt alle acht OSCAL-Root-Modelle, auch die vier noch nicht
 * registrierten. Reines ESM ohne Node-Abhängigkeiten, damit Build-Skripte und
 * App dieselbe Quelle importieren.
 *
 * Fail-closed: Eine unbekannte, fehlende, fehlgeformte oder nicht gepinnte
 * Version wird abgelehnt. Es wird niemals gegen eine benachbarte Version
 * validiert.
 */

/** NIST-Release-Tag-Präfix; die Herkunft jedes Pins ist `v<VERSION>`. */
const NIST_RELEASE_BASE_URL = 'https://github.com/usnistgov/OSCAL/releases/download';

/** Namespace-Präfix der `$id` jedes offiziellen OSCAL-JSON-Schemas. */
const NIST_SCHEMA_ID_BASE = 'http://csrc.nist.gov/ns/oscal';

/**
 * Ablageort der gepinnten Schemadateien im Repository. Der Pfad ist Teil des
 * Vertrags: die spätere Validierung liest ausschließlich von hier, niemals aus
 * dem Netz. Befüllt wird er durch `scripts/sync-oscal-schemas.mjs`.
 */
export const SCHEMA_VENDOR_DIRECTORY = 'schemas/oscal';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Alle acht OSCAL-Root-Keys über alle drei Layer. Reihenfolge folgt der
 * NIST-Layer-Gliederung (Control, Implementation, Assessment).
 */
export const OSCAL_ROOT_KEYS = Object.freeze([
  'catalog',
  'profile',
  'mapping-collection',
  'component-definition',
  'system-security-plan',
  'assessment-plan',
  'assessment-results',
  'plan-of-action-and-milestones',
]);

/**
 * Die gepinnten OSCAL-Versionen. Umfasst exakt die vier im BSI-Bestand
 * tatsächlich deklarierten Versionen; eine fünfte Version wird nur zusammen
 * mit ihren Schema-Pins und Orakeln aufgenommen (siehe Migrationspolitik in
 * docs/OSCAL_VERSION_MATRIX.md).
 */
export const PINNED_OSCAL_VERSIONS = Object.freeze(['1.1.2', '1.1.3', '1.2.1', '1.2.2']);

/**
 * Verbotene Zellen der Matrix: Root-Modelle, die es vor einer bestimmten
 * OSCAL-Version nicht gab. Ein Dokument mit diesem Root und einer älteren
 * deklarierten Version ist nicht „schwer validierbar", sondern in sich
 * widersprüchlich und wird mit eigener Diagnose abgelehnt.
 *
 * Belegt: `oscal_mapping_schema.json` liefert in den Releases v1.1.2 und
 * v1.1.3 HTTP 404; das Control-Mapping-Modell kam mit OSCAL 1.2.0.
 */
const MODEL_INTRODUCED_IN = Object.freeze({
  'mapping-collection': '1.2.0',
});

/**
 * Schema-Provenienz je Root-Typ.
 *
 * `schemaIdSlug` ist pro Root-Typ explizit gepinnt und **nicht** aus
 * `schemaFileName` ableitbar: NIST verwendet für `component-definition`,
 * `assessment-plan` und `assessment-results` im Asset-Namen einen anderen
 * Bezeichner als in der `$id`. Eine abgeleitete Prüfung würde für drei der
 * acht Root-Typen falsch fehlschlagen.
 *
 * `sha256` und `sizeBytes` wurden am 2026-08-01 direkt aus den offiziellen
 * Release-Assets ermittelt.
 */
const SCHEMA_PINS = new Map(
  [
    [
      'catalog',
      {
        schemaFileName: 'oscal_catalog_schema.json',
        schemaIdSlug: 'oscal-catalog-schema',
        versions: {
          '1.1.2': { sha256: '5b069afa4f4ecc38d59914dab56098566d4247d3578a2123c030c80d36fc5104', sizeBytes: 43204 },
          '1.1.3': { sha256: '5e120afbd14c480a9498ab6388857ef32b3b880e458525e966ff7c7f59333d90', sizeBytes: 45375 },
          '1.2.1': { sha256: 'c0ae626d6bafe318db68692152d0cbbebf29ba7226b1596a5513cc5d1754504d', sizeBytes: 55199 },
          '1.2.2': { sha256: 'fdc559f5dff6848b1ebbe1898a69cc08263479f7c796e2f056412059e7489d0c', sizeBytes: 55199 },
        },
      },
    ],
    [
      'profile',
      {
        schemaFileName: 'oscal_profile_schema.json',
        schemaIdSlug: 'oscal-profile-schema',
        versions: {
          '1.1.2': { sha256: 'c910ea1a852e9d4ccfb7f6a8d0898b0cd4f137e48f88886412a083c8d87d540a', sizeBytes: 53876 },
          '1.1.3': { sha256: 'd14c99b4bc48cb1ef370cd27a78c23e04bab847e737e11f478b37714db30851b', sizeBytes: 56434 },
          '1.2.1': { sha256: '3b92e83ef9043af573ca81a451f899adf6855440b0974fb448b9c635fead7983', sizeBytes: 68517 },
          '1.2.2': { sha256: '04329bd68032f48825f712f79576b3fd00e129e59d3597beb56ed72c17277f66', sizeBytes: 68517 },
        },
      },
    ],
    [
      'mapping-collection',
      {
        schemaFileName: 'oscal_mapping_schema.json',
        schemaIdSlug: 'oscal-mapping-schema',
        versions: {
          '1.2.1': { sha256: '5b8f6f9b8117bb42ad8466d11d1695f0be9cc31350c2a3aea770614d96d70d3f', sizeBytes: 67267 },
          '1.2.2': { sha256: '45b4f909f72e17fbe8476e2a7f3d9f64ec42dc26ab2fe2d56c6b44fc57346022', sizeBytes: 67267 },
        },
      },
    ],
    [
      'component-definition',
      {
        schemaFileName: 'oscal_component_schema.json',
        schemaIdSlug: 'oscal-component-definition-schema',
        versions: {
          '1.1.2': { sha256: '7b74710940ad39b6b63d4ddccbadf2c7d2e9bf11b07808d41d2aa27a4616e5ce', sizeBytes: 67640 },
          '1.1.3': { sha256: '9bde069f8f65ec82ea626348cc40ae5d42b0f74c1a2a8b9289a1604bf521a15c', sizeBytes: 72983 },
          '1.2.1': { sha256: 'ce95b3b3ea8de87c020ad4a91075241f6f863a77afe212ee828009830d6042d1', sizeBytes: 82169 },
          '1.2.2': { sha256: '3b6e0765c44037c4d1bfb2cdb972713917d3eca73e566c0e6c6881a565638830', sizeBytes: 82169 },
        },
      },
    ],
    [
      'system-security-plan',
      {
        schemaFileName: 'oscal_ssp_schema.json',
        schemaIdSlug: 'oscal-ssp-schema',
        versions: {
          '1.1.2': { sha256: '08d3faeb12f0fab7705dec15fb648c72400c7ab6ac0056222d49d21507e02a69', sizeBytes: 92768 },
          '1.1.3': { sha256: 'da5f452b9e7bdf85246b79ed32475cd419321eb600e6928439ae67aef5a63e53', sizeBytes: 96467 },
          '1.2.1': { sha256: '3027ffb23ba94a8ca4e43ce9417cf2b02f27b7c36d8a4ead8fe2905483c6d10a', sizeBytes: 105471 },
          '1.2.2': { sha256: 'd7f9bf67101829083472a8f058a5b5ef078e09b3f699ac0c4dbe33a5b0671b6a', sizeBytes: 105471 },
        },
      },
    ],
    [
      'assessment-plan',
      {
        schemaFileName: 'oscal_assessment-plan_schema.json',
        schemaIdSlug: 'oscal-ap-schema',
        versions: {
          '1.1.2': { sha256: '43464ad048b711c735934b66015bcf8239782c6263d377a742c6b205ea796ecb', sizeBytes: 126071 },
          '1.1.3': { sha256: '0850be91252390dde740a98fd2f0fc504cd0ba66fe8940c2b6242b7aa2fb36eb', sizeBytes: 130380 },
          '1.2.1': { sha256: '0153e4e0414903c51c13732d4158d955630e33a3ef009d2691cf3e07336136f4', sizeBytes: 144885 },
          '1.2.2': { sha256: 'ba265f05982969142cbc3c6ed6bb99e0880081ceb366c152e44fe7e2b08aa125', sizeBytes: 144885 },
        },
      },
    ],
    [
      'assessment-results',
      {
        schemaFileName: 'oscal_assessment-results_schema.json',
        schemaIdSlug: 'oscal-ar-schema',
        versions: {
          '1.1.2': { sha256: 'd033da70154cf6625ae46a746199e88e58f2928b1387dfac051d381b92f41b0d', sizeBytes: 133015 },
          '1.1.3': { sha256: 'd9e34757f0c12aff61f52b821f0b8f83ba0ba75b3a149a202b08ba82f82bc4c3', sizeBytes: 137528 },
          '1.2.1': { sha256: '4f9e277a177adbcca9527612ce450a33dc6096773fa229d413d801d196c61985', sizeBytes: 152147 },
          '1.2.2': { sha256: 'd4e1e7e17c6662814882810ad64075266964ee1a575759ce3955302fd74edcd9', sizeBytes: 152147 },
        },
      },
    ],
    [
      'plan-of-action-and-milestones',
      {
        schemaFileName: 'oscal_poam_schema.json',
        schemaIdSlug: 'oscal-poam-schema',
        versions: {
          '1.1.2': { sha256: '906725163d767036c6189aec51252109b203214e121fc1acaff494b4d2dfbc04', sizeBytes: 129396 },
          '1.1.3': { sha256: 'e404043fef9cc6108c0e895932f513043d54f28457b4eb02e74dc0cff1215e16', sizeBytes: 134388 },
          '1.2.1': { sha256: 'c02062bbc6f5092012286cbc6161b643eb6aecfbb918cb5790be777860da2c11', sizeBytes: 148186 },
          '1.2.2': { sha256: 'c8f2ce52b3c71299bb0c9e1cd950d48dc79d9f52920c543ac30b3c3f08c2e152', sizeBytes: 148186 },
        },
      },
    ],
  ].map(([rootKey, pin]) => [
    rootKey,
    Object.freeze({
      ...pin,
      versions: Object.freeze(
        Object.fromEntries(
          Object.entries(pin.versions).map(([version, cell]) => [version, Object.freeze(cell)]),
        ),
      ),
    }),
  ]),
);

/**
 * Stabile Diagnosecodes der Versionsauswahl. Sie gehören zur Stufe
 * `root-dispatch` des Validierungsvertrags (docs/OSCAL_VALIDATION.md) und
 * dürfen sich nicht stillschweigend ändern: die CI-Policy bindet Diagnosen
 * unter anderem über ihren Code.
 */
export const VERSION_MATRIX_DIAGNOSTIC_CODES = Object.freeze({
  ROOT_TYPE_UNKNOWN: 'OSCAL_ROOT_TYPE_UNKNOWN',
  VERSION_MISSING: 'OSCAL_VERSION_MISSING',
  VERSION_MALFORMED: 'OSCAL_VERSION_MALFORMED',
  ROOT_VERSION_IMPOSSIBLE: 'OSCAL_ROOT_VERSION_IMPOSSIBLE',
  ROOT_VERSION_UNSUPPORTED: 'OSCAL_ROOT_VERSION_UNSUPPORTED',
  SCHEMA_ID_MISMATCH: 'OSCAL_SCHEMA_ID_MISMATCH',
  SCHEMA_HASH_MISMATCH: 'OSCAL_SCHEMA_HASH_MISMATCH',
  SCHEMA_DIRECTIVE_CONFLICT: 'OSCAL_SCHEMA_DIRECTIVE_CONFLICT',
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

export function isKnownOscalRootKey(value) {
  return OSCAL_ROOT_KEYS.includes(value);
}

export function isPinnedOscalVersion(value) {
  return PINNED_OSCAL_VERSIONS.includes(value);
}

/**
 * Baut die erwartete NIST-Bezugs-URL eines Schemas. Nur für den expliziten
 * Wartungslauf; zur Laufzeit wird kein Schema über das Netz bezogen.
 */
export function buildSchemaReleaseUrl(rootKey, version) {
  const pin = SCHEMA_PINS.get(rootKey);
  if (!pin) return null;
  return `${NIST_RELEASE_BASE_URL}/v${version}/${pin.schemaFileName}`;
}

/** Die erwartete `$id` — der maschinenlesbare Selbstnachweis des Schemas. */
export function buildSchemaId(rootKey, version) {
  const pin = SCHEMA_PINS.get(rootKey);
  if (!pin) return null;
  return `${NIST_SCHEMA_ID_BASE}/${version}/${pin.schemaIdSlug}.json`;
}

/** Der repo-relative Ablageort einer gepinnten Schemadatei. */
export function buildSchemaVendorPath(rootKey, version) {
  const pin = SCHEMA_PINS.get(rootKey);
  if (!pin) return null;
  return `${SCHEMA_VENDOR_DIRECTORY}/v${version}/${pin.schemaFileName}`;
}

/**
 * Liefert den vollständigen Schema-Pin einer Matrixzelle oder `null`, wenn die
 * Zelle nicht existiert. Kein Fallback auf eine Nachbarversion.
 */
export function getSchemaPin(rootKey, version) {
  const pin = SCHEMA_PINS.get(rootKey);
  const cell = pin?.versions?.[version];
  if (!cell) return null;

  return Object.freeze({
    rootKey,
    oscalVersion: version,
    schemaFileName: pin.schemaFileName,
    releaseTag: `v${version}`,
    releaseUrl: buildSchemaReleaseUrl(rootKey, version),
    schemaId: buildSchemaId(rootKey, version),
    vendorPath: buildSchemaVendorPath(rootKey, version),
    sha256: cell.sha256,
    sizeBytes: cell.sizeBytes,
  });
}

/**
 * Die OSCAL-Version, ab der ein Root-Modell existiert, oder `null`, wenn das
 * Modell in allen gepinnten Versionen vorhanden ist.
 */
export function getModelIntroducedIn(rootKey) {
  return MODEL_INTRODUCED_IN[rootKey] ?? null;
}

/**
 * Ist die Kombination aus Root-Typ und Version im OSCAL-Standard überhaupt
 * möglich? Unabhängig davon, ob wir die Version pinnen.
 */
export function isImpossibleCombination(rootKey, version) {
  const introducedIn = getModelIntroducedIn(rootKey);
  if (!introducedIn || !VERSION_PATTERN.test(version)) return false;
  return compareVersions(version, introducedIn) < 0;
}

/** Alle existierenden Zellen als flache Liste — Grundlage von Doku und Tests. */
export function listSchemaPins() {
  const pins = [];
  for (const rootKey of OSCAL_ROOT_KEYS) {
    for (const version of PINNED_OSCAL_VERSIONS) {
      const pin = getSchemaPin(rootKey, version);
      if (pin) pins.push(pin);
    }
  }
  return pins;
}

/**
 * Fail-closed Auswahl des gepinnten Schemas für ein Dokument.
 *
 * Prüfreihenfolge ist bewusst festgelegt: Root-Typ, dann Versionsform, dann
 * Modellexistenz, erst danach der Pin. So erhält ein `mapping-collection` mit
 * Version 1.0.4 die inhaltlich richtige Diagnose „Modell existierte noch
 * nicht" statt der unspezifischen „Version nicht gepinnt".
 *
 * `schemaDirective` ist der optionale Top-Level-`$schema`-Wert des Dokuments.
 * NIST deklariert ihn in jedem Root-Schema ausdrücklich als erlaubte Property
 * (`json-schema-directive`, Typ `URIReferenceDatatype`), er ist aber weder
 * Pflichtfeld noch wertbeschränkt und daher **niemals** Versionsautorität.
 * Allein `metadata.oscal-version` wählt das Schema aus. Widerspricht ein
 * vorhandener Direktivwert der gewählten Zelle, wird fail-closed abgelehnt.
 * Abwesenheit signalisiert ausschließlich `undefined`; ein vorhandenes
 * `$schema` mit `null` oder einem Nicht-String ist ungültig, nicht abwesend.
 *
 * @returns {{ok: true, pin: object} | {ok: false, code: string, rootType: string|null, oscalVersion: string|null, expected?: string}}
 */
export function resolveSchemaBinding({ rootType, oscalVersion, schemaDirective } = {}) {
  const codes = VERSION_MATRIX_DIAGNOSTIC_CODES;

  if (!isKnownOscalRootKey(rootType)) {
    return { ok: false, code: codes.ROOT_TYPE_UNKNOWN, rootType: null, oscalVersion: null };
  }

  if (!isNonEmptyString(oscalVersion)) {
    return { ok: false, code: codes.VERSION_MISSING, rootType, oscalVersion: null };
  }
  if (!VERSION_PATTERN.test(oscalVersion)) {
    return { ok: false, code: codes.VERSION_MALFORMED, rootType, oscalVersion: null };
  }

  if (isImpossibleCombination(rootType, oscalVersion)) {
    return {
      ok: false,
      code: codes.ROOT_VERSION_IMPOSSIBLE,
      rootType,
      oscalVersion,
      expected: `>= ${getModelIntroducedIn(rootType)}`,
    };
  }

  const pin = getSchemaPin(rootType, oscalVersion);
  if (!pin) {
    return {
      ok: false,
      code: codes.ROOT_VERSION_UNSUPPORTED,
      rootType,
      oscalVersion,
      expected: PINNED_OSCAL_VERSIONS.join(', '),
    };
  }

  // Nur `undefined` bedeutet „keine Direktive". Ein im Dokument vorhandenes
  // `$schema` muss ein nicht-leerer URI-String sein; `null` ist nach
  // URIReferenceDatatype ungültig und darf nicht als Abwesenheit gelten.
  if (schemaDirective !== undefined) {
    if (!isNonEmptyString(schemaDirective) || schemaDirective !== pin.schemaId) {
      return {
        ok: false,
        code: codes.SCHEMA_DIRECTIVE_CONFLICT,
        rootType,
        oscalVersion,
        expected: pin.schemaId,
      };
    }
  }

  return { ok: true, pin };
}

/**
 * Prüft eine bezogene Schemadatei gegen ihren Pin: erst der Inhaltshash, dann
 * die selbstdeklarierte `$id`. Beide müssen stimmen.
 */
export function verifySchemaArtifact({ rootKey, version, sha256, schemaId }) {
  const codes = VERSION_MATRIX_DIAGNOSTIC_CODES;
  const pin = getSchemaPin(rootKey, version);
  if (!pin) {
    return { ok: false, code: codes.ROOT_VERSION_UNSUPPORTED, rootType: rootKey, oscalVersion: version };
  }
  if (sha256 !== pin.sha256) {
    return {
      ok: false,
      code: codes.SCHEMA_HASH_MISMATCH,
      rootType: rootKey,
      oscalVersion: version,
      expected: pin.sha256,
    };
  }
  if (schemaId !== pin.schemaId) {
    return {
      ok: false,
      code: codes.SCHEMA_ID_MISMATCH,
      rootType: rootKey,
      oscalVersion: version,
      expected: pin.schemaId,
    };
  }
  return { ok: true, pin };
}

/** Strukturinvarianten der Matrix; läuft beim Import. */
export function validateVersionMatrix() {
  if (new Set(OSCAL_ROOT_KEYS).size !== OSCAL_ROOT_KEYS.length) {
    throw new Error('OSCAL_ROOT_KEYS must not contain duplicates');
  }
  if (new Set(PINNED_OSCAL_VERSIONS).size !== PINNED_OSCAL_VERSIONS.length) {
    throw new Error('PINNED_OSCAL_VERSIONS must not contain duplicates');
  }
  for (const version of PINNED_OSCAL_VERSIONS) {
    if (!VERSION_PATTERN.test(version)) {
      throw new Error(`Pinned OSCAL version is malformed: ${version}`);
    }
  }

  const seenFileNames = new Set();
  const seenIdSlugs = new Set();

  for (const rootKey of OSCAL_ROOT_KEYS) {
    const pin = SCHEMA_PINS.get(rootKey);
    if (!pin) {
      throw new Error(`Version matrix is missing schema provenance for root key: ${rootKey}`);
    }
    if (seenFileNames.has(pin.schemaFileName)) {
      throw new Error(`Duplicate schema file name in version matrix: ${pin.schemaFileName}`);
    }
    seenFileNames.add(pin.schemaFileName);
    if (seenIdSlugs.has(pin.schemaIdSlug)) {
      throw new Error(`Duplicate schema id slug in version matrix: ${pin.schemaIdSlug}`);
    }
    seenIdSlugs.add(pin.schemaIdSlug);

    const versions = Object.keys(pin.versions);
    if (versions.length === 0) {
      throw new Error(`Version matrix has no pinned version for root key: ${rootKey}`);
    }

    for (const version of versions) {
      if (!isPinnedOscalVersion(version)) {
        throw new Error(`Version matrix pins an unlisted version for ${rootKey}: ${version}`);
      }
      if (isImpossibleCombination(rootKey, version)) {
        throw new Error(
          `Version matrix pins an impossible combination: ${rootKey} @ ${version}`,
        );
      }
      const cell = pin.versions[version];
      if (!SHA256_PATTERN.test(cell.sha256 ?? '')) {
        throw new Error(`Version matrix cell ${rootKey} @ ${version} has an invalid SHA-256`);
      }
      if (!Number.isSafeInteger(cell.sizeBytes) || cell.sizeBytes <= 0) {
        throw new Error(`Version matrix cell ${rootKey} @ ${version} has an invalid size`);
      }
    }

    // Jede möglich Zelle muss gepinnt sein: eine Lücke wäre eine stille
    // Validierungslücke statt einer bewussten Entscheidung.
    for (const version of PINNED_OSCAL_VERSIONS) {
      const expectedToExist = !isImpossibleCombination(rootKey, version);
      const isPinned = pin.versions[version] !== undefined;
      if (expectedToExist !== isPinned) {
        throw new Error(
          `Version matrix coverage gap: ${rootKey} @ ${version} (expected pinned: ${expectedToExist})`,
        );
      }
    }
  }

  for (const rootKey of Object.keys(MODEL_INTRODUCED_IN)) {
    if (!isKnownOscalRootKey(rootKey)) {
      throw new Error(`MODEL_INTRODUCED_IN references an unknown root key: ${rootKey}`);
    }
    if (!VERSION_PATTERN.test(MODEL_INTRODUCED_IN[rootKey])) {
      throw new Error(`MODEL_INTRODUCED_IN has a malformed version for ${rootKey}`);
    }
  }
}

validateVersionMatrix();
