import { Fragment, useId, type ReactNode } from 'react';
import { IconArrowLeft, IconCheck, IconInfo, IconX } from '@/components/icons';
import type { DiffEntry, DocumentDiff } from '@/domain/documentDiff';
import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import { projectRevisions, resolveActionReferences } from '@/domain/reviewTrail';
import type { DocumentSnapshot, ReviewCheckpoint, ReviewDecision, ReviewTrailRow } from '@/domain/workspaceModel';
import { documentValidity, ROOT_TYPE_LABELS } from '@/domain/workspaceStations';
import { OscalKey, SECTION_LABEL } from '@/features/workspace/profile/ProfileMarks';
import { CapabilityContract } from '@/features/workspace/review/CapabilityContract';
import {
  REVIEW_BADGE_TEXT,
  REVIEW_DECISION_TEXT,
  reviewReferenceText,
  type ReviewBadge,
  type ReviewView,
} from '@/features/workspace/review/reviewView';

export interface ReviewPanelProps {
  readonly view: ReviewView;
  readonly metadata: unknown;
  readonly rootType: OscalRootKey;
  /** Bedienelemente der Station; sie bleiben von der Anzeige getrennt. */
  readonly actions?: ReactNode;
}

const DIFF_RENDER_LIMIT = 100;
const BADGE_TONE: Readonly<Record<ReviewBadge, string>> = {
  none: 'border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]',
  reviewed: 'border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-secondary)]',
  'changes-requested': 'border-[var(--color-document-draft-border)] bg-[var(--color-document-draft-bg)] text-[var(--color-document-draft-text)]',
  approved: 'border-[var(--color-document-valid-border)] bg-[var(--color-document-valid-bg)] text-[var(--color-document-valid-text)]',
  withdrawn: 'border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]',
  stale: 'border-[var(--color-status-soll-border)] bg-[var(--color-status-soll-bg)] text-[var(--color-status-soll-text)]',
  unverified: 'border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-secondary)]',
};
const DIFF_KIND_TEXT: Readonly<Record<DiffEntry['kind'], string>> = {
  added: 'hinzugefügt',
  removed: 'entfernt',
  changed: 'geändert',
};
const VALUE_KIND_TEXT: Readonly<Record<DiffEntry['valueKind'], string>> = {
  object: 'Objekt',
  array: 'Liste',
  string: 'Text',
  number: 'Zahl',
  boolean: 'Wahrheitswert',
  null: 'Null',
};
function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE');
}
function objects(value: unknown): readonly JsonObject[] {
  return readArray(value).filter(isJsonObject);
}
function metadataFields(metadata: unknown) {
  const source = isJsonObject(metadata) ? metadata : {};
  return { roles: objects(source.roles), parties: objects(source.parties), actions: objects(source.actions) };
}
function roleLabel(roles: readonly JsonObject[], id: string): string {
  const matches = roles.filter((role) => role.id === id);
  return (matches.length === 1 ? readString(matches[0].title) : undefined) ?? id;
}
function partyLabel(parties: readonly JsonObject[], uuid: string): string {
  const matches = parties.filter((party) => party.uuid === uuid);
  return (matches.length === 1 ? readString(matches[0].name) : undefined) ?? uuid;
}
function ReviewBadgeMark({ badge }: Readonly<{ badge: ReviewBadge }>) {
  const Icon = badge === 'approved' || badge === 'reviewed' ? IconCheck : badge === 'changes-requested' ? IconX : badge === 'withdrawn' ? IconArrowLeft : IconInfo;
  return (
    <span data-review-badge={badge} className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium leading-4 ${BADGE_TONE[badge]}`}>
      <Icon className="h-3.5 w-3.5" />
      {REVIEW_BADGE_TEXT[badge]}
    </span>
  );
}
function Layer({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
      <h2 id={id} className="flex h-panel-head items-center border-b border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] px-4 text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}
function Revisions({ metadata }: Readonly<{ metadata: unknown }>) {
  const revisions = projectRevisions(metadata);
  return (
    <div className="space-y-2">
      <h3 className={`${SECTION_LABEL} flex flex-wrap items-baseline gap-2`}>Revisionen <OscalKey>metadata.revisions</OscalKey> <span className="tabular-nums">{revisions.length}</span></h3>
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">Revisionen tragen keinen Inhalt und keine UUID; sie sind keine Rücksetzfunktion.</p>
      {revisions.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Keine Revisionen im Dokument.</p> : (
        <ul aria-label="Revisionen im Dokument" className="divide-y divide-[var(--color-border-subtle)]">
          {revisions.map((revision) => (
            <li key={revision.index} data-revision={revision.version} className="py-2">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-[var(--color-text-primary)]">
                <span className="text-xs tabular-nums text-[var(--color-text-muted)]">Nr. {revision.index + 1}</span>
                <span className="font-mono text-xs">{revision.version}</span>
                {revision.title && <span>{revision.title}</span>}
              </p>
              {(revision.published || revision.lastModified || revision.oscalVersion) && (
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[var(--color-text-secondary)]">
                  {revision.published && <span>Veröffentlicht: {revision.published}</span>}
                  {revision.lastModified && <span>Geändert: {revision.lastModified}</span>}
                  {revision.oscalVersion && <span className="font-mono">OSCAL {revision.oscalVersion}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function ActionRow({ action, metadata }: Readonly<{ action: JsonObject; metadata: unknown }>) {
  const { roles, parties } = metadataFields(metadata);
  const responsible = objects(action['responsible-parties']);
  const findings = resolveActionReferences(action, metadata);
  const type = readString(action.type);
  const system = readString(action.system);
  const date = readString(action.date);
  const remarks = readString(action.remarks);
  return (
    <li className="space-y-1.5 py-2">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="break-all font-mono text-xs text-[var(--color-text-primary)]">{readString(action.uuid) ?? 'ohne UUID'}</span>
        {type && <span className="text-xs text-[var(--color-text-secondary)]">Typ <span className="font-mono">{type}</span></span>}
        {date && <span className="text-xs text-[var(--color-text-secondary)]">Datum <time dateTime={date}>{date}</time></span>}
      </p>
      {system && <p className="break-all font-mono text-2xs text-[var(--color-text-muted)]">{system}</p>}
      {responsible.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Keine verantwortliche Partei vermerkt.</p> : (
        <ul aria-label="Verantwortliche Parteien der Aktion" className="space-y-0.5 text-sm text-[var(--color-text-secondary)]">
          {responsible.map((entry, index) => {
            const roleId = readString(entry['role-id']);
            const partyUuids = readArray(entry['party-uuids']).filter((value): value is string => typeof value === 'string');
            return (
              <li key={index} className="flex flex-wrap items-baseline gap-x-2">
                <span>Rolle: <span className="font-medium text-[var(--color-text-primary)]">{roleId ? roleLabel(roles, roleId) : 'fehlt'}</span>{roleId && <span className="ml-1 font-mono text-xs text-[var(--color-text-muted)]">{roleId}</span>}</span>
                <span>Parteien:</span>
                {partyUuids.length === 0 ? <span>fehlen</span> : partyUuids.map((partyUuid, position) => (
                  <span key={`${partyUuid}-${position}`} className="break-all">{partyLabel(parties, partyUuid)} <span className="font-mono text-xs text-[var(--color-text-muted)]">{partyUuid}</span></span>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      {remarks && <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-text-secondary)]">{remarks}</p>}
      {findings.length > 0 && (
        <ul aria-label="Befunde zur Aktion" className="space-y-0.5 text-sm text-[var(--color-text-primary)]">
          {findings.map((finding, index) => <li key={index}><span className="font-medium">Befund:</span> {reviewReferenceText(finding)}</li>)}
        </ul>
      )}
    </li>
  );
}
function Actions({ metadata }: Readonly<{ metadata: unknown }>) {
  const { actions } = metadataFields(metadata);
  return (
    <div className="space-y-2">
      <h3 className={`${SECTION_LABEL} flex flex-wrap items-baseline gap-2`}>Aktionen <OscalKey>metadata.actions</OscalKey> <span className="tabular-nums">{actions.length}</span></h3>
      {actions.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Keine Aktionen im Dokument.</p> : (
        <ul aria-label="Aktionen im Dokument" className="divide-y divide-[var(--color-border-subtle)]">
          {actions.map((action, index) => <ActionRow key={readString(action.uuid) ?? index} action={action} metadata={metadata} />)}
        </ul>
      )}
    </div>
  );
}
function EntityList({ label, oscalKey, entries, field, nameField }: Readonly<{ label: string; oscalKey: string; entries: readonly JsonObject[]; field: 'id' | 'uuid'; nameField: 'title' | 'name' }>) {
  return (
    <div className="space-y-1">
      <h3 className={`${SECTION_LABEL} flex flex-wrap items-baseline gap-2`}>{label} <OscalKey>{oscalKey}</OscalKey> <span className="tabular-nums">{entries.length}</span></h3>
      {entries.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Keine {label} im Dokument.</p> : (
        <ul aria-label={`${label} im Dokument`} className="divide-y divide-[var(--color-border-subtle)]">
          {entries.map((entry, index) => (
            <li key={`${readString(entry[field]) ?? field}-${index}`} className="py-1.5 text-sm text-[var(--color-text-primary)]">
              <span className="break-all font-mono text-xs">{readString(entry[field]) ?? `ohne ${field}`}</span>
              {readString(entry[nameField]) && <span className="ml-2">{readString(entry[nameField])}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function RolesAndParties({ metadata }: Readonly<{ metadata: unknown }>) {
  const { roles, parties } = metadataFields(metadata);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <EntityList label="Rollen" oscalKey="metadata.roles" entries={roles} field="id" nameField="title" />
      <EntityList label="Parteien" oscalKey="metadata.parties" entries={parties} field="uuid" nameField="name" />
    </div>
  );
}

function Stand({ stand }: Readonly<{ stand: DocumentSnapshot }>) {
  const rows: readonly (readonly [string, string])[] = [
    ['Dokument-UUID', stand.uuid],
    ['Zuletzt geändert', stand.lastModified],
    ['Dokumentversion', stand.version],
    ['OSCAL-Version', stand.oscalVersion],
    ['Inhalt', `${stand.contentHash.algorithm} · v${stand.contentHash.version} · ${stand.contentHash.value}`],
  ];
  return (
    <dl className="grid gap-x-3 gap-y-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-subtle)] p-2 text-sm sm:grid-cols-[auto_1fr]">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-xs text-[var(--color-text-secondary)]">{label}</dt>
          <dd className="break-all font-mono text-xs text-[var(--color-text-primary)]">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Diff({ diff }: Readonly<{ diff: DocumentDiff }>) {
  const shown = diff.entries.slice(0, DIFF_RENDER_LIMIT);
  const hidden = diff.entries.length - shown.length;
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Änderungen</h4>
      <p className="text-sm text-[var(--color-text-secondary)]">
        {diff.baseSequence === null ? 'Vergleich gegen das leere Dokument; noch keine Baseline.' : `Vergleich gegen Prüfpunkt ${diff.baseSequence}.`}{' '}
        <span className="tabular-nums">{diff.entries.length}</span> Einträge.
      </p>
      {shown.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Keine Unterschiede.</p> : (
        <ul aria-label="Änderungen im Prüfpunkt" className="divide-y divide-[var(--color-border-subtle)]">
          {shown.map((entry, index) => (
            <li key={`${entry.path}-${entry.kind}-${index}`} className="space-y-0.5 py-1.5">
              <p className="break-all font-mono text-xs text-[var(--color-text-primary)]">{entry.path}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-secondary)]">
                <span>{DIFF_KIND_TEXT[entry.kind]}</span>
                <span aria-hidden="true">·</span>
                <span>{VALUE_KIND_TEXT[entry.valueKind]}</span>
                {entry.marker && <span className="inline-flex items-center rounded border border-[var(--color-border-strong)] px-1.5 py-0.5 font-medium">Schreibmarker</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && <p className="text-xs tabular-nums text-[var(--color-text-secondary)]">Weitere {hidden} Einträge werden nicht angezeigt.</p>}
      {diff.truncated && <p className="text-sm text-[var(--color-text-primary)]">Das Diff-Ergebnis ist gekürzt; weitere Unterschiede werden nicht angezeigt.</p>}
    </div>
  );
}

function CheckpointDetails({ checkpoint, rootType }: Readonly<{ checkpoint?: ReviewCheckpoint; rootType: OscalRootKey }>) {
  if (!checkpoint) return <p className="text-sm text-[var(--color-text-secondary)]">Keine Prüfpunkte im Workspace.</p>;
  return (
    <div className="space-y-2">
      <h3 className={`${SECTION_LABEL} flex flex-wrap items-baseline gap-2`}>Letzter Prüfpunkt <span className="tabular-nums">{checkpoint.sequence}</span></h3>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-[var(--color-text-secondary)]">
        <span className="font-medium text-[var(--color-text-primary)]">{documentValidity(checkpoint.documentState)}</span>
        <span aria-hidden="true">·</span><time dateTime={checkpoint.createdAt}>{timestamp(checkpoint.createdAt)}</time>
        <span aria-hidden="true">·</span><span>{ROOT_TYPE_LABELS[rootType]}</span>
      </p>
      <Stand stand={checkpoint.stand} />
      <Diff diff={checkpoint.diff} />
    </div>
  );
}

function TrailDecision({ decision }: Readonly<{ decision: ReviewDecision }>) {
  const actionUuid = decision.actionUuid ?? decision.withdraws?.actionUuid;
  return (
    <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      {decision.reason && <><dt className="text-[var(--color-text-secondary)]">Begründung</dt><dd className="whitespace-pre-wrap break-words text-[var(--color-text-primary)]">{decision.reason}</dd></>}
      {decision.roleId && <><dt className="text-[var(--color-text-secondary)]">Rolle</dt><dd className="font-mono text-xs">{decision.roleId}</dd></>}
      {decision.partyUuids && decision.partyUuids.length > 0 && (
        <><dt className="text-[var(--color-text-secondary)]">Parteien</dt><dd className="break-all font-mono text-xs">{decision.partyUuids.join(', ')}</dd></>
      )}
      {decision.withdraws && (
        <><dt className="text-[var(--color-text-secondary)]">Nimmt zurück</dt><dd className="text-[var(--color-text-primary)]">Nr. <span className="tabular-nums">{decision.withdraws.sequence}</span></dd></>
      )}
      {actionUuid && <><dt className="text-[var(--color-text-secondary)]">Aktion</dt><dd className="break-all font-mono text-xs">{actionUuid}</dd></>}
      <dt className="text-[var(--color-text-secondary)]">Gebundener Stand</dt>
      <dd className="break-all font-mono text-xs">{decision.stand.contentHash.value}</dd>
    </dl>
  );
}

function TrailHistory({ trail, rootType }: Readonly<{ trail: readonly ReviewTrailRow[]; rootType: OscalRootKey }>) {
  let latestCheckpoint: ReviewTrailRow | undefined;
  let latestDecision: ReviewTrailRow | undefined;
  for (const row of trail) {
    if (row.kind === 'checkpoint') latestCheckpoint = row;
    else latestDecision = row;
  }
  // Der jüngste Prüfpunkt und die jüngste Entscheidung stehen bereits in den Abschnitten darüber.
  const earlier = trail.filter((row) => row !== latestCheckpoint && row !== latestDecision);
  if (earlier.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className={`${SECTION_LABEL} flex flex-wrap items-baseline gap-2`}>Frühere Einträge <span className="tabular-nums">{earlier.length}</span></h3>
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">Frühere Prüfpunkte und Entscheidungen bleiben mit Begründung und gebundenem Stand lesbar.</p>
      <ol aria-label="Verlauf der Prüfspur" className="divide-y divide-[var(--color-border-subtle)]">
        {[...earlier].reverse().map((row) => (
          <li key={`${row.kind}-${row.sequence}`}>
            <details className="py-2">
              <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-[var(--color-text-primary)]">
                <span className="text-xs tabular-nums text-[var(--color-text-muted)]">Nr. {row.sequence}</span>
                <span>{row.kind === 'checkpoint' ? `Prüfpunkt · ${documentValidity(row.documentState)}` : REVIEW_DECISION_TEXT[row.decision]}</span>
                <time dateTime={row.createdAt} className="text-xs text-[var(--color-text-secondary)]">{timestamp(row.createdAt)}</time>
              </summary>
              <div className="mt-2 space-y-2 pl-2">
                {row.kind === 'checkpoint'
                  ? <><p className="text-xs text-[var(--color-text-secondary)]">{ROOT_TYPE_LABELS[rootType]}</p><Stand stand={row.stand} /><Diff diff={row.diff} /></>
                  : <TrailDecision decision={row} />}
              </div>
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatusSection({ view }: Readonly<{ view: ReviewView }>) {
  const decision = view.latestDecision;
  const actionUuid = decision?.actionUuid ?? decision?.withdraws?.actionUuid;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><h3 className={SECTION_LABEL}>Prüfzustand</h3><ReviewBadgeMark badge={view.badge} /></div>
      {!decision ? <p className="text-sm text-[var(--color-text-secondary)]">Keine lokale Entscheidung.</p> : (
        <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-[var(--color-text-secondary)]">Entscheidung</dt>
          <dd className="text-[var(--color-text-primary)]">{REVIEW_DECISION_TEXT[decision.decision]} · Nr. <span className="tabular-nums">{decision.sequence}</span> · <time dateTime={decision.createdAt}>{timestamp(decision.createdAt)}</time></dd>
          {view.reason && <><dt className="text-[var(--color-text-secondary)]">Begründung</dt><dd className="whitespace-pre-wrap break-words text-[var(--color-text-primary)]">{view.reason}</dd></>}
          {decision.roleId && <><dt className="text-[var(--color-text-secondary)]">Rolle</dt><dd className="font-mono text-xs">{decision.roleId}</dd></>}
          {actionUuid && <><dt className="text-[var(--color-text-secondary)]">Aktion</dt><dd className="break-all font-mono text-xs">{actionUuid}</dd></>}
          <dt className="text-[var(--color-text-secondary)]">Gebundener Stand</dt>
          <dd className="break-all font-mono text-xs">{decision.stand.contentHash.value}</dd>
        </dl>
      )}
    </div>
  );
}

/** Prüfspur eines Dokuments: was im Dokument steht, getrennt von dem, was nur der Workspace hält. */
export function ReviewPanel({ view, metadata, rootType, actions }: Readonly<ReviewPanelProps>) {
  return (
    <div className="space-y-4">
      <Layer title="Im Dokument">
        <Revisions metadata={metadata} />
        <Actions metadata={metadata} />
        <RolesAndParties metadata={metadata} />
      </Layer>
      <Layer title="Nur im Workspace">
        <StatusSection view={view} />
        <CheckpointDetails checkpoint={view.latestCheckpoint} rootType={rootType} />
        {actions}
        <TrailHistory trail={view.trail} rootType={rootType} />
        <CapabilityContract />
      </Layer>
    </div>
  );
}
