import { useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { ROOT_TYPE_LABELS } from '@/domain/workspaceStations';
import { isVerbundName } from '@/domain/workspaceModel';
import type { RestoreInput, RestorePreview, RestoreScope } from '@/state/workspaceRestore';

/** Gelesene Angaben einer geprüften Sicherungsdatei. */
export interface FileInfo {
  readonly kind: RestorePreview['kind'];
  readonly savedAt: string;
  readonly version: number;
}

const PART_LABELS = {
  verbuende: 'Informationsverbünde',
  documents: 'Dokumente',
  drafts: 'Entwürfe',
  bindings: 'Verknüpfungen',
  reviewTrail: 'Prüfspur-Einträge',
  reviewBaseline: 'Baselines',
} as const;

const DATE_TIME = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDate = (value: string) => DATE_TIME.format(new Date(value));
export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const BUTTON = 'min-h-touch desktop:min-h-0';

export function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

export function fileInfo(preview: RestorePreview): FileInfo {
  const savedAt = preview.kind === 'workspace' ? preview.backup.workspaceMeta[0].savedAt : preview.backup.verbuende[0].savedAt;
  return { kind: preview.kind, savedAt, version: preview.backup.storageSchemaVersion };
}

export function scopeOf(preview: RestorePreview): RestoreScope {
  const documents = preview.backup.documents.map(({ localId, verbundId, rootType }) => ({ localId, verbundId, rootType }));
  return preview.kind === 'workspace' ? { kind: 'workspace', documents } : { kind: 'verbund', verbundId: preview.verbundId, documents };
}

/** Ein bestehender Zielbereich wird ersetzt; ein fehlender Verbund wird nur angelegt. */
export function replacesTarget(preview: RestorePreview): boolean {
  return preview.kind === 'workspace' ? preview.counts.verbuende.target > 0 : preview.existingVerbund !== null;
}

export function doneText(preview: RestorePreview): string {
  const parts = [
    plural(preview.counts.documents.file, 'Dokument', 'Dokumente'),
    plural(preview.counts.drafts.file, 'Entwurf', 'Entwürfe'),
    `Stand der Datei ${formatDate(fileInfo(preview).savedAt)}`,
  ];
  const scope = preview.kind === 'workspace'
    ? ['Gesamter Bestand', plural(preview.counts.verbuende.file, 'Informationsverbund', 'Informationsverbünde')]
    : [`„${preview.name}“`];
  return [...scope, ...parts].join(' · ');
}

export function replacementText(preview: RestorePreview): string {
  const documents = plural(preview.counts.documents.target, 'Dokument', 'Dokumenten');
  const drafts = plural(preview.counts.drafts.target, 'gespeicherten Entwurf', 'gespeicherten Entwürfen');
  if (preview.kind === 'verbund') {
    return preview.existingVerbund
      ? `Ersetzt „${preview.existingVerbund.name}“ mit ${documents} und ${drafts}.`
      : `Legt „${preview.name}“ neu an. Kein vorhandener Bestand wird ersetzt.`;
  }
  if (!replacesTarget(preview)) return 'Der lokale Bestand ist leer. Nichts wird ersetzt.';
  return `Ersetzt ${preview.counts.verbuende.target === 1 ? 'den einen Informationsverbund' : `alle ${preview.counts.verbuende.target} Informationsverbünde`} mit ${documents} und ${drafts}.`;
}

export function Section({ number, title, children }: Readonly<{ number: number; title: string; children: ReactNode }>) {
  return (
    <section className="space-y-3 px-4 py-4 sm:px-6">
      <h2 className="flex items-baseline gap-2 text-base font-semibold leading-snug tabular-nums">
        <span aria-hidden="true" className="tabular-nums text-[var(--color-text-muted)]">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Facts({ rows }: Readonly<{ rows: readonly (readonly [string, string])[] }>) {
  return (
    <dl className="space-y-2 text-sm md:grid md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] md:gap-x-4 md:gap-y-1.5 md:space-y-0">
      {rows.map(([term, value]) => (
        <div key={term} className="md:contents">
          <dt className="text-[var(--color-text-secondary)]">{term}</dt>
          <dd className="min-w-0 break-words tabular-nums text-[var(--color-text-primary)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Meldung mit Titel und Text; Fehler sind Alarm, Prüf- und Ergebnisstand Status. */
export function Message({ title, tone, children }: Readonly<{ title: string; tone: 'alert' | 'status'; children?: ReactNode }>) {
  const danger = tone === 'alert';
  return (
    <div
      role={tone}
      className={`rounded-md border p-4 text-sm ${danger
        ? 'border-[var(--color-danger-border)] bg-[var(--color-danger-surface)]'
        : 'border-[var(--color-border-strong)] bg-[var(--color-surface-base)]'}`}
    >
      <p className={`font-semibold ${danger ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-text-primary)]'}`}>{title}</p>
      {children && <p className="mt-1 leading-relaxed text-[var(--color-text-primary)]">{children}</p>}
    </div>
  );
}

export function Mark({ children, danger = false }: Readonly<{ children: ReactNode; danger?: boolean }>) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium leading-4 ${danger
      ? 'border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]'
      : 'border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] text-[var(--color-text-primary)]'}`}
    >
      {children}
    </span>
  );
}

export function Actions({ children }: Readonly<{ children: ReactNode }>) {
  // Mobil volle Breite, die Hauptaktion oben; ab Tablet rechtsbündig in Lesereihenfolge.
  return <div className="flex flex-col-reverse gap-2 md:flex-row md:flex-wrap md:justify-end">{children}</div>;
}

export function PreviewTable({ preview }: Readonly<{ preview: RestorePreview }>) {
  const parts = (Object.keys(PART_LABELS) as (keyof typeof PART_LABELS)[])
    .filter((part) => preview.kind === 'workspace' || part !== 'verbuende');
  const counts = preview.counts as Readonly<Record<keyof typeof PART_LABELS, { readonly file: number; readonly target: number }>>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--color-border-subtle)] text-xs font-semibold text-[var(--color-text-secondary)]">
          <th scope="col" className="py-2 text-left">Bestandteil</th>
          <th scope="col" className="py-2 pl-3 text-right">Aus der Datei</th>
          <th scope="col" className="py-2 pl-3 text-right">Heute · wird ersetzt</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--color-border-subtle)]">
        {parts.map((part) => (
          <tr key={part}>
            <th scope="row" className="py-2 text-left font-normal">{PART_LABELS[part]}</th>
            <td className="py-2 pl-3 text-right tabular-nums">{counts[part].file}</td>
            <td className="py-2 pl-3 text-right font-semibold tabular-nums">{counts[part].target}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ClarifyRow({ entry, verbundName, failed, writable, onSave, onDiscard, onOpen }: Readonly<{
  entry: RestoreInput;
  verbundName: string;
  failed: boolean;
  writable: boolean;
  onSave: (entry: Extract<RestoreInput, { kind: 'rename' }>) => Promise<void>;
  onDiscard: () => void;
  onOpen: (entry: Extract<RestoreInput, { kind: 'import' }>) => void;
}>) {
  const [saving, setSaving] = useState(false);
  const label = entry.kind === 'rename'
    ? <><span className="font-semibold">Umbenennung</span> · „{entry.name}“ → „{entry.draft}“</>
    : <><span className="font-semibold">Importzuordnung</span> · {ROOT_TYPE_LABELS[entry.rootType]} in „{verbundName}“ · {plural(entry.count, 'Verweis', 'Verweise')}</>;
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words text-sm text-[var(--color-text-primary)]">{label}</p>
        <div className="flex gap-1">
          {entry.kind === 'rename' ? (
            <Button
              variant="secondary"
              size="sm"
              className={BUTTON}
              disabled={!writable || saving || !isVerbundName(entry.draft)}
              onClick={() => { setSaving(true); void onSave(entry).finally(() => setSaving(false)); }}
            >
              Speichern
            </Button>
          ) : (
            <Button variant="secondary" size="sm" className={BUTTON} onClick={() => onOpen(entry)}>Zum Dokument</Button>
          )}
          <Button variant="ghost" size="sm" className={BUTTON} disabled={saving} onClick={onDiscard}>Verwerfen</Button>
        </div>
      </div>
      {failed && <Message tone="alert" title="Nicht gespeichert">Die Eingabe bleibt offen.</Message>}
    </li>
  );
}

/** Stand von „Vorher sichern“; erst eine übergebene Datei zählt als gestarteter Download. */
export type BackupState = 'idle' | 'running' | 'started' | 'failed';

export function PreviewBody({ preview, verbundCount, phase, quota, writable, backup, cancel, onBackup, onConfirm }: Readonly<{
  preview: RestorePreview;
  verbundCount: number;
  phase: 'preview' | 'running' | 'write-failed';
  quota: boolean;
  writable: boolean;
  backup: BackupState;
  cancel: ReactNode;
  onBackup: () => void;
  onConfirm: () => void;
}>) {
  const running = phase === 'running';
  const replaces = replacesTarget(preview);
  const facts: (readonly [string, string])[] = preview.kind === 'workspace'
    ? [
      ['Umfang', 'Gesamter lokaler Bestand'],
      ['Ziel', replaces ? `${plural(preview.counts.verbuende.target, 'Informationsverbund', 'Informationsverbünde')} · Stand ${formatDate(preview.target.savedAt)}` : 'Leer · kein Informationsverbund'],
    ]
    : [
      ['Umfang', `Verbund „${preview.name}“`],
      ['Ziel', preview.existingVerbund ? `Vorhanden · geändert ${formatDate(preview.existingVerbund.savedAt)}` : 'Fehlt · wird neu angelegt'],
      ['Andere Verbünde', `${verbundCount - (preview.existingVerbund ? 1 : 0)} · bleiben unverändert`],
    ];
  const target = preview.kind === 'workspace' ? 'gesamter Bestand' : preview.existingVerbund?.name ?? preview.name;
  let confirmLabel = 'Gesamten Bestand ersetzen';
  if (preview.kind === 'verbund') confirmLabel = replaces ? `„${preview.name}“ ersetzen` : `„${preview.name}“ wiederherstellen`;
  return (
    <>
      <Facts rows={facts} />
      <PreviewTable preview={preview} />
      <p className="text-sm font-semibold text-[var(--color-text-primary)]">{replacementText(preview)}</p>
      {running && <Message tone="status" title="Wiederherstellung läuft…">Alle Aktionen sind bis zum Abschluss gesperrt.</Message>}
      {phase === 'write-failed' && (
        <Message tone="alert" title={quota ? 'Speicher voll' : 'Speicher nicht verfügbar'}>Die Wiederherstellung wurde nicht gespeichert. Der bisherige Bestand ist unverändert.</Message>
      )}
      {backup === 'started' && <p role="status" className="text-right text-xs text-[var(--color-text-secondary)]">Download gestartet</p>}
      {backup === 'failed' && <Message tone="alert" title="Sicherung nicht erstellt">Es wurde keine Datei heruntergeladen. Der Bestand ist unverändert.</Message>}
      <Actions>
        {cancel}
        {replaces && (
          <Button variant="secondary" className={BUTTON} disabled={running || backup === 'running'} aria-label={`Vorher sichern: ${target}`} onClick={onBackup}>Vorher sichern</Button>
        )}
        {/* Auch die Wiederholung nennt den Umfang im zugänglichen Namen. */}
        <Button
          variant={replaces ? 'danger' : 'primary'}
          className={BUTTON}
          disabled={running || !writable}
          aria-label={phase === 'write-failed' ? `Erneut versuchen: ${confirmLabel}` : undefined}
          onClick={onConfirm}
        >
          {phase === 'write-failed' ? 'Erneut versuchen' : confirmLabel}
        </Button>
      </Actions>
    </>
  );
}
