import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DecisionForm } from '@/features/workspace/review/DecisionForm';

const roles = [{ id: 'role-approver', title: 'Freigabe' }];
const parties = [
  { uuid: 'party-1', name: 'Alice Beispiel' },
  { uuid: 'party-2', name: 'Bob Beispiel' },
];

function renderForm(overrides: Partial<Parameters<typeof DecisionForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(<DecisionForm roles={roles} parties={parties} onSubmit={onSubmit} {...overrides} />);
  return { onSubmit };
}

describe('DecisionForm', () => {
  it('gibt erst mit Rolle und mindestens einer Partei frei', () => {
    const { onSubmit } = renderForm();
    const submit = screen.getByRole('button', { name: 'Freigeben' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Rolle metadata.roles' }), { target: { value: 'role-approver' } });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice Beispiel (party-1)' }));
    expect(submit).toBeEnabled();

    fireEvent.change(screen.getByRole('textbox', { name: /Begründung/ }), { target: { value: '  Geprüft.  ' } });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ roleId: 'role-approver', partyUuids: ['party-1'], reason: 'Geprüft.' });
  });

  it('nennt den Grund, wenn keine Freigabe möglich ist, und sperrt das Absenden', () => {
    renderForm({ disabledReason: 'Der gespeicherte Stand fehlt.' });
    expect(screen.getByText('Der gespeicherte Stand fehlt.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Rolle metadata.roles' }), { target: { value: 'role-approver' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice Beispiel (party-1)' }));
    expect(screen.getByRole('button', { name: 'Freigeben' })).toBeDisabled();
  });

  it('zeigt Befunde als Text und begrenzt die Begründung auf 1000 Zeichen', () => {
    renderForm({ findingCodes: ['REVIEW_PARTY_MISSING', 'REVIEW_ROLE_AMBIGUOUS'] });
    expect(screen.getByText('Partei fehlt in metadata.parties.')).toBeInTheDocument();
    expect(screen.getByText('Rolle ist in metadata.roles mehrdeutig.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Begründung/ })).toHaveAttribute('maxLength', '1000');
  });

  it('legt fehlende Rolle und Partei mit den schema-pflichtigen Angaben an', () => {
    const { onSubmit } = renderForm({ roles: [], parties: [] });
    const submit = screen.getByRole('button', { name: 'Freigeben' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rolle metadata.roles' }), { target: { value: '__new' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Neue Rolle (ID)' }), { target: { value: 'approver' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Neue Rolle (Bezeichnung)' }), { target: { value: 'Freigabe' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Neue Partei (Name)' }), { target: { value: 'Synthetische Organisation' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({
      roleId: 'approver',
      roleTitle: 'Freigabe',
      partyUuids: [],
      partyName: 'Synthetische Organisation',
      reason: '',
    });
  });

  it('sperrt das Absenden während einer laufenden Freigabe', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<DecisionForm roles={roles} parties={parties} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Rolle metadata.roles' }), { target: { value: 'role-approver' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice Beispiel (party-1)' }));
    const submit = screen.getByRole('button', { name: 'Freigeben' });
    expect(submit).toBeEnabled();
    rerender(<DecisionForm roles={roles} parties={parties} busy onSubmit={onSubmit} />);
    expect(submit).toBeDisabled();
    expect(screen.getByRole('form', { name: 'Freigabe erfassen' })).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
