// Aktives Anforderungspaket je Informationsverbund (GSPP-708, BSI-Standard 300-1 § 3.4).
// Die Festlegung benennt die Grundlage; sie sagt nichts über die Vollständigkeit des Inhalts.
import { documentBody } from '@/domain/documentContent';
import { isJsonObject, readString } from '@/domain/jsonGuards';
import { sameStand } from '@/domain/reviewTrail';
import { SOURCE_REGISTRY } from '@/domain/sourceRegistry';
import {
  REQUIREMENT_PACKAGE_ROOTS,
  type DocumentSnapshot, type DocumentStamp, type RequirementPackage, type RequirementPackagePin, type WorkspaceEnvelope,
} from '@/domain/workspaceModel';

/** `stale` trägt den aktuellen Stempel, sofern das Dokument einen lesbaren trägt. */
export type RequirementPackageState =
  | { readonly kind: 'missing' }
  | { readonly kind: 'set'; readonly requirementPackage: RequirementPackage; readonly title?: string }
  | { readonly kind: 'stale'; readonly requirementPackage: RequirementPackage; readonly title?: string; readonly current?: DocumentStamp }
  | { readonly kind: 'unresolvable'; readonly requirementPackage: RequirementPackage };

export function isRequirementPackageRoot(rootType: string): boolean {
  return (REQUIREMENT_PACKAGE_ROOTS as readonly string[]).includes(rootType);
}

/** `metadata.title` des Baselinedokuments, nur für den Seiteninhalt. */
export function packageTitle(document: Pick<WorkspaceEnvelope, 'source' | 'rootType'>): string | undefined {
  const metadata = documentBody(document.source, document.rootType)?.metadata;
  return readString(isJsonObject(metadata) ? metadata.title : undefined);
}

/** Ein Artefaktschlüssel des Quellregisters (`src/domain/sourceRegistry.mjs`, Einträge `kind: 'oscal'`); lokale Prüfung ohne Netzaufruf. */
export function isRegisteredArtifactKey(value: unknown): boolean {
  return SOURCE_REGISTRY.some((entry) => entry.kind === 'oscal' && entry.artifactKey === value);
}

/** Der `class-1`-Quellenstand eines `derivedFrom`: nur vollständig und mit registriertem Artefaktschlüssel. */
export function classOneSource(derived: WorkspaceEnvelope['derivedFrom']): NonNullable<WorkspaceEnvelope['derivedFrom']> | undefined {
  return derived?.artifactKey && derived.snapshotCommit && derived.contentSha256 && isRegisteredArtifactKey(derived.artifactKey) ? derived : undefined;
}

/** Ein `class-1`-Pin entsteht nur aus `classOneSource()`; es wird nichts nachgeladen. */
export function buildRequirementPackage(packageId: string, baseline: Pick<WorkspaceEnvelope, 'localId' | 'derivedFrom'>, stand: DocumentSnapshot): RequirementPackage {
  // Eigene Kopie je Fundstelle: Die Bündelprüfung weist geteilte Objekte (Aliase) zurück.
  const pins: RequirementPackagePin[] = [{ kind: 'local', localId: baseline.localId, stand: structuredClone(stand) }];
  const derived = classOneSource(baseline.derivedFrom);
  if (derived) pins.push({ kind: 'class-1', artifactKey: derived.artifactKey, snapshotCommit: derived.snapshotCommit, contentSha256: derived.contentSha256 });
  return { packageId, baseline: { localId: baseline.localId, stand }, sourcePins: pins };
}

const STAND_FIELDS = [['uuid', 'UUID'], ['version', 'Version'], ['oscal-version', 'OSCAL-Version'], ['last-modified', 'Stand']] as const;

/**
 * Stempelangaben, die dem Dokument für einen Paketstand fehlen (`documentStamp()` in `src/domain/reviewTrail.ts`):
 * `uuid` am Root, `version`, `oscal-version` und `last-modified` in `metadata`. Leer heißt festlegbar.
 */
export function missingStandFields(document: Pick<WorkspaceEnvelope, 'source' | 'rootType'>): string[] {
  const body = documentBody(document.source, document.rootType);
  const metadata = body && isJsonObject(body.metadata) ? body.metadata : undefined;
  return STAND_FIELDS.filter(([field]) => !readString(field === 'uuid' ? body?.uuid : metadata?.[field])).map(([, label]) => label);
}

export function sameStamp(left: DocumentStamp, right: DocumentStamp): boolean {
  return left.rootType === right.rootType && left.uuid === right.uuid && left.lastModified === right.lastModified
    && left.version === right.version && left.oscalVersion === right.oscalVersion;
}

/**
 * Zustand aus Paket und aktuellem Baselinedokument: ohne Paket `missing`, ohne Dokument
 * `unresolvable`, gleicher Stand `set`, sonst `stale`. `current` ist der vollständige Stand
 * des Dokuments oder nur sein Stempel, wenn dieser bereits abweicht.
 */
export function requirementPackageState(
  requirementPackage: RequirementPackage | undefined,
  baseline: { readonly title?: string; readonly current?: DocumentStamp | DocumentSnapshot } | undefined,
): RequirementPackageState {
  if (!requirementPackage) return { kind: 'missing' };
  if (!baseline) return { kind: 'unresolvable', requirementPackage };
  const { title, current } = baseline;
  const stand = requirementPackage.baseline.stand;
  if (current && 'contentHash' in current && sameStand(stand, current)) return { kind: 'set', requirementPackage, ...(title === undefined ? {} : { title }) };
  return { kind: 'stale', requirementPackage, ...(title === undefined ? {} : { title }), ...(current ? { current } : {}) };
}

/** Der `class-1`-Quellenstand des Pakets mit registriertem Artefaktschlüssel; sonst ist der Quellenstand offen. */
export function classOnePin(requirementPackage: RequirementPackage) {
  return requirementPackage.sourcePins.find((pin): pin is Extract<RequirementPackagePin, { kind: 'class-1' }> => pin.kind === 'class-1' && isRegisteredArtifactKey(pin.artifactKey));
}
