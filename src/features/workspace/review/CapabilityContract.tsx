import { REVIEW_CAPABILITIES, type ReviewCapability } from '@/domain/reviewTrail';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';

const EVENT_TEXT: Readonly<Record<ReviewCapability['event'], string>> = {
  checkpoint: 'Prüfpunkt',
  approved: 'Freigabe',
  reviewed: 'Geprüft',
  'changes-requested': 'Änderungen angefordert',
  withdrawn: 'Rücknahme',
  revision: 'Revision',
};

const CARRIER_TEXT: Readonly<Record<ReviewCapability['carrier'], string>> = {
  workspace: 'Workspace',
  'metadata.actions': 'metadata.actions',
  'metadata.revisions': 'metadata.revisions',
};

function CapabilityList({ label, items }: Readonly<{ label: string; items: readonly ReviewCapability[] }>) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold text-[var(--color-text-primary)]">{label} <span className="tabular-nums">{items.length}</span></h3>
      <ul aria-label={label} className="divide-y divide-[var(--color-border-subtle)]">
        {items.map((item) => (
          <li key={item.event} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
            <span className="text-sm text-[var(--color-text-primary)]">{EVENT_TEXT[item.event]}</span>
            <span className="font-mono text-xs text-[var(--color-text-secondary)]">{CARRIER_TEXT[item.carrier]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Was das Dokument trägt und was den Workspace nicht verlässt; ohne Signaturbehauptung. */
export function CapabilityContract() {
  return (
    <details className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-subtle)]">
      <summary className={`min-h-touch cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-base)] ${FOCUS_RING} focus-visible:ring-inset`}>
        Was das Dokument trägt und was nur der Workspace weiß
      </summary>
      <div className="space-y-3 border-t border-[var(--color-border-default)] px-3 py-3">
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Freigaben stehen in <span className="font-mono text-xs">metadata.actions</span>, Revisionen in <span className="font-mono text-xs">metadata.revisions</span>. Prüfpunkte, Prüfentscheidungen und Rücknahmen speichert nur der Workspace dieses Browsers.
        </p>
        <CapabilityList label="Im Dokument, wird exportiert" items={REVIEW_CAPABILITIES.filter((item) => item.exported)} />
        <CapabilityList label="Nur im Workspace, bleibt lokal" items={REVIEW_CAPABILITIES.filter((item) => !item.exported)} />
        <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">
          Es findet keine elektronische Signatur und keine verbindliche Identitätsprüfung statt.
        </p>
      </div>
    </details>
  );
}
