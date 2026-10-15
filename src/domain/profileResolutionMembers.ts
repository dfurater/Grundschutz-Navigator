// =============================================================================
// Deskriptorbasierte Mitgliederzugriffe der Profilauflösung
//
// Merge und Modify lesen und kopieren Mitglieder ausschließlich über
// Data-Property-Deskriptoren: Ein Accessor-Slot erscheint als abwesend und
// wird nie ausgeführt.
// =============================================================================

import type { JsonObject } from '@/domain/jsonGuards';
import type { ProfileResolutionBudget, ProfileResolutionWorkUnit } from './profileResolutionBudget';
import { ownDataValue } from './profileResolutionSelection';

/** Array-Wert eines Mitglieds, rein deskriptorbasiert gelesen. */
export function safeArrayMember(node: JsonObject, key: string): readonly unknown[] | undefined {
  const value = ownDataValue(node, key);
  return Array.isArray(value) ? value : undefined;
}

/**
 * Kopiert alle eigenen String-Mitglieder über Data-Property-Deskriptoren.
 * Die Kopie belegt einen Arbeitsknoten; jeder eigene Schlüssel bucht
 * `workUnit`, auch ein Symbol- oder Accessor-Schlüssel.
 */
export function copyOwnDataMembers(
  node: JsonObject,
  budget: ProfileResolutionBudget,
  workUnit: ProfileResolutionWorkUnit,
): JsonObject {
  budget.admitWorkingNode();
  const copy: JsonObject = {};
  for (const key of Reflect.ownKeys(node)) {
    budget.spendWork(workUnit);
    if (typeof key !== 'string') continue;
    const value = ownDataValue(node, key);
    if (value !== undefined) copy[key] = value;
  }
  return copy;
}
