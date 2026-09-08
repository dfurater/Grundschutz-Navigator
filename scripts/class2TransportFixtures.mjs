// Wartungsfixtures für den fragmentierten Rückweg (GSPP-386), ohne App-Anbindung.
import { CLASS_2_IMPORT_LIMITS } from '../src/domain/class2ImportLimits.mjs';
import { buildNodeBoundDocumentText } from './class2WorstCaseFixtures.mjs';

function shell() {
  return JSON.parse(buildNodeBoundDocumentText(12));
}

/** Füllt einen einzelnen JSON-String exakt bis zur Byte-Zulassungsgrenze. */
function stringDocument(totalBytes = CLASS_2_IMPORT_LIMITS.maxBytes, unicode = false) {
  const document = shell();
  document.catalog.groups = [{ title: '' }];
  const available = totalBytes - new TextEncoder().encode(JSON.stringify(document)).length;
  if (available < 0) throw new RangeError('Bytebudget trägt die Kataloghülle nicht');
  // 3 + 4 + 6 JSON-Bytes; die letzte Einheit ist ein einzelnes Surrogat.
  const unit = unicode ? '漢😀\ud800' : 'A';
  const unitBytes = new TextEncoder().encode(JSON.stringify(unit)).length - 2;
  document.catalog.groups[0].title = unit.repeat(Math.floor(available / unitBytes))
    + 'A'.repeat(available % unitBytes);
  return JSON.stringify(document);
}

function keyDocument(totalBytes = CLASS_2_IMPORT_LIMITS.maxBytes) {
  const document = shell();
  document.catalog[''] = 0;
  const available = totalBytes - new TextEncoder().encode(JSON.stringify(document)).length;
  if (available < 1) throw new RangeError('Bytebudget trägt den Schlüssel nicht');
  delete document.catalog[''];
  document.catalog['K'.repeat(available)] = 0;
  return JSON.stringify(document);
}

function depthDocument() {
  const document = shell();
  let group = { title: 'Tiefe' };
  // Root auf Tiefe 1, catalog 2, groups 3, erste Gruppe 4.
  // 30 Gruppen enden auf Tiefe 62, ihr Titel auf zulässiger Tiefe 63.
  for (let index = 1; index < 30; index += 1) group = { title: 'Tiefe', groups: [group] };
  document.catalog.groups = [group];
  return JSON.stringify(document);
}

export const CLASS_2_TRANSPORT_FIXTURES = Object.freeze([
  { id: 'string-bound', limit: 'maxBytes', reachesSchemaStage: true,
    label: 'Ein ASCII-String nahe der Bytegrenze', build: (bytes) => stringDocument(bytes) },
  { id: 'unicode-bound', limit: 'maxBytes', reachesSchemaStage: true,
    label: 'Unicode mit Paaren und einzelnen Surrogaten', build: (bytes) => stringDocument(bytes, true) },
  // Die gepinnten OSCAL-Schemas erlauben keine beliebigen Property-Namen.
  // Der Codec prüft deren Erhaltung separat; der echte Import muss ablehnen.
  { id: 'key-bound', limit: 'maxBytes', reachesSchemaStage: true,
    label: 'Langer unbekannter Schlüssel, erwartete Schemaablehnung', build: keyDocument },
  { id: 'valid-depth-bound', limit: 'maxDepth - 1', reachesSchemaStage: true,
    label: 'Tiefer schemagültiger Katalog', build: depthDocument },
]);
