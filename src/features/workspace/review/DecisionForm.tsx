import { useId, useState } from 'react';
import { Button } from '@/components/Button';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import type { ReviewReferenceCode } from '@/domain/reviewTrail';
import { INPUT, OscalKey } from '@/features/workspace/profile/ProfileMarks';
import { REVIEW_REFERENCE_TEXT, type DecisionSubmission } from '@/features/workspace/review/reviewView';

export interface DecisionFormProps {
  readonly roles: readonly { readonly id: string; readonly title: string }[];
  readonly parties: readonly { readonly uuid: string; readonly name: string }[];
  /** Genannt, wenn keine Freigabe möglich ist. */
  readonly disabledReason?: string;
  /** Eine Freigabe läuft bereits; weitere Absendungen sind gesperrt. */
  readonly busy?: boolean;
  readonly findingCodes?: readonly ReviewReferenceCode[];
  readonly onSubmit: (input: DecisionSubmission) => void;
}

const NEW = '__new';

/** Erfasst eine Freigabe als Dokumenteintrag; Signatur und Identitätsprüfung finden nicht statt. */
export function DecisionForm({ roles, parties, disabledReason, busy = false, findingCodes = [], onSubmit }: Readonly<DecisionFormProps>) {
  const headingId = useId();
  const roleFieldId = useId();
  const newRoleIdId = useId();
  const newRoleTitleId = useId();
  const partyNameId = useId();
  const reasonFieldId = useId();
  const reasonHintId = useId();
  const disabledReasonId = useId();
  const [roleSelection, setRoleSelection] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [selectedPartyUuids, setSelectedPartyUuids] = useState<readonly string[]>([]);
  const [partyName, setPartyName] = useState('');
  const [reason, setReason] = useState('');
  const blocked = Boolean(disabledReason) || busy;
  const newRole = roleSelection === NEW;
  const roleReady = newRole ? newRoleId.trim() !== '' && newRoleTitle.trim() !== '' : roleSelection !== '';
  const partyReady = selectedPartyUuids.length > 0 || partyName.trim() !== '';
  const ready = !blocked && roleReady && partyReady;

  const toggleParty = (uuid: string, checked: boolean) => {
    setSelectedPartyUuids((current) => checked ? [...current, uuid] : current.filter((entry) => entry !== uuid));
  };

  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    onSubmit({
      roleId: newRole ? newRoleId.trim() : roleSelection,
      ...(newRole ? { roleTitle: newRoleTitle.trim() } : {}),
      partyUuids: parties.map((party) => party.uuid).filter((uuid) => selectedPartyUuids.includes(uuid)),
      ...(partyName.trim() ? { partyName: partyName.trim() } : {}),
      reason: reason.trim(),
    });
  };

  return (
    <form aria-labelledby={headingId} aria-busy={busy} className="space-y-4" onSubmit={submit}>
      <h3 id={headingId} className="text-base font-semibold text-[var(--color-text-primary)]">Freigabe erfassen</h3>
      {disabledReason && (
        <output id={disabledReasonId} className="block rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] p-3 text-sm text-[var(--color-text-primary)]">
          {disabledReason}
        </output>
      )}
      {findingCodes.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Befunde <span className="tabular-nums">{findingCodes.length}</span></p>
          <ul aria-label="Befunde zur Freigabe" className="space-y-0.5 text-sm text-[var(--color-text-primary)]">
            {findingCodes.map((code, index) => <li key={`${code}-${index}`}>{REVIEW_REFERENCE_TEXT[code]}</li>)}
          </ul>
        </div>
      )}
      <fieldset disabled={busy} className="m-0 min-w-0 space-y-4 border-0 p-0">
      <div className="space-y-1">
        <label htmlFor={roleFieldId} className="flex flex-wrap items-baseline gap-2 text-sm font-medium text-[var(--color-text-primary)]">
          Rolle <OscalKey>metadata.roles</OscalKey>
        </label>
        <select id={roleFieldId} className={INPUT} value={roleSelection} required onChange={(event) => setRoleSelection(event.target.value)}>
          <option value="">Rolle wählen</option>
          {roles.map((role, index) => <option key={`${role.id}-${index}`} value={role.id}>{role.title} · {role.id}</option>)}
          <option value={NEW}>Neue Rolle…</option>
        </select>
      </div>
      {newRole && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={newRoleIdId} className="text-sm font-medium text-[var(--color-text-primary)]">Neue Rolle (ID)</label>
            <input id={newRoleIdId} className={INPUT} value={newRoleId} required onChange={(event) => setNewRoleId(event.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor={newRoleTitleId} className="text-sm font-medium text-[var(--color-text-primary)]">Neue Rolle (Bezeichnung)</label>
            <input id={newRoleTitleId} className={INPUT} value={newRoleTitle} required onChange={(event) => setNewRoleTitle(event.target.value)} />
          </div>
        </div>
      )}
      <fieldset className="space-y-1">
        <legend className="flex flex-wrap items-baseline gap-2 text-sm font-medium text-[var(--color-text-primary)]">
          Parteien <OscalKey>metadata.parties</OscalKey>
        </legend>
        {parties.length > 0 && (
          <ul className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-2">
            {parties.map((party, index) => (
              <li key={`${party.uuid}-${index}`}>
                <CheckboxLabel
                  label={party.name}
                  ariaLabel={`${party.name} (${party.uuid})`}
                  title={party.uuid}
                  checked={selectedPartyUuids.includes(party.uuid)}
                  onChange={(checked) => toggleParty(party.uuid, checked)}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-1 pt-1">
          <label htmlFor={partyNameId} className="text-sm font-medium text-[var(--color-text-primary)]">Neue Partei (Name)</label>
          <input id={partyNameId} className={INPUT} value={partyName} placeholder="Organisation" onChange={(event) => setPartyName(event.target.value)} />
          <p className="text-xs text-[var(--color-text-secondary)]">Wird als Organisation in <span className="font-mono">metadata.parties</span> angelegt.</p>
        </div>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={reasonFieldId} className="text-sm font-medium text-[var(--color-text-primary)]">
          Begründung <span className="font-normal text-[var(--color-text-secondary)]">(optional)</span>
        </label>
        <textarea id={reasonFieldId} className={INPUT} rows={4} maxLength={1000} value={reason} aria-describedby={reasonHintId} onChange={(event) => setReason(event.target.value)} />
        <p id={reasonHintId} className="flex flex-wrap justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
          <span>Wird als Anmerkung an der Freigabe gespeichert.</span>
          <span className="tabular-nums">{reason.length}/1000</span>
        </p>
      </div>
      <div className="space-y-2">
        <Button type="submit" className="min-h-touch w-full sm:w-auto desktop:min-h-0" disabled={!ready} aria-describedby={disabledReason ? disabledReasonId : undefined}>
          Freigeben
        </Button>
        <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
          Die Freigabe wird als Aktion in <span className="font-mono">metadata.actions</span> gespeichert. Es findet keine elektronische Signatur und keine Identitätsprüfung statt.
        </p>
      </div>
      </fieldset>
    </form>
  );
}
