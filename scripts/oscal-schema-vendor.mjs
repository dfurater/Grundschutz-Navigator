/**
 * Gemeinsamer Ablageort-Vertrag der gepinnten OSCAL-Schemas (GSPP-283, GSPP-343).
 *
 * Bewusst ein eigenes Modul: Der netzfreie Verify-Lauf
 * (`scripts/verify-oscal-schemas.mjs`) braucht diese Eingrenzung, darf aber
 * nichts aus dem Wartungslauf importieren — dort hängt der Netzpfad daran.
 * Eine Kopie der Containment-Prüfung wäre die schlechtere Antwort: Zwei Orte
 * für dieselbe Sicherheitsregel driften auseinander.
 */

import path from 'node:path';
import { SCHEMA_VENDOR_DIRECTORY } from '../src/domain/oscalVersionMatrix.mjs';
import { REPO_ROOT } from './security-guards.mjs';

/** Hält die Ablage innerhalb des reservierten Schema-Verzeichnisses. */
export function resolveSchemaVendorTarget(vendorPath, { repoRoot = REPO_ROOT } = {}) {
  const vendorRoot = path.resolve(repoRoot, SCHEMA_VENDOR_DIRECTORY);
  const target = path.resolve(repoRoot, vendorPath);
  const relative = path.relative(vendorRoot, target);

  if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
    throw new Error(`Schema-Ablageort liegt außerhalb von ${SCHEMA_VENDOR_DIRECTORY}: ${vendorPath}`);
  }

  return target;
}

/** Der absolute Wurzelpfad des reservierten Schema-Verzeichnisses. */
export function resolveSchemaVendorRoot({ repoRoot = REPO_ROOT } = {}) {
  return path.resolve(repoRoot, SCHEMA_VENDOR_DIRECTORY);
}
