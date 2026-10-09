import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ModalPortal } from '@/components/ModalPortal';
import { useModalDialog } from './useModalDialog';

interface DialogHarnessProps {
  active: boolean;
  includeFocusable?: boolean;
  showTrigger?: boolean;
}

function Dialog({ name, active, includeFocusable = true }: {
  name: string;
  active: boolean;
  includeFocusable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalDialog(ref, active);
  if (!active) return null;
  return (
    <ModalPortal>
      <div data-testid={`${name}-backdrop`} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={name}>
        {includeFocusable && (
          <>
            <button type="button">{`${name}: erste Aktion`}</button>
            <button type="button">{`${name}: letzte Aktion`}</button>
          </>
        )}
      </div>
    </ModalPortal>
  );
}

function DialogHarness({
  active,
  includeFocusable = true,
  showTrigger = true,
}: DialogHarnessProps) {
  return (
    <>
      {showTrigger && <button type="button">Dialog öffnen</button>}
      <Dialog name="Dialog" active={active} includeFocusable={includeFocusable} />
    </>
  );
}

function inertBodyChildren() {
  return Array.from(document.body.children).filter((child) => child.hasAttribute('inert'));
}

describe('useModalDialog', () => {
  afterEach(() => {
    document.body.querySelectorAll('[data-test-sibling]').forEach((el) => el.remove());
  });

  it('restores focus to the trigger when the dialog is deactivated', () => {
    const { rerender } = render(<DialogHarness active={false} />);
    const trigger = screen.getByRole('button', { name: 'Dialog öffnen' });

    trigger.focus();
    rerender(<DialogHarness active />);

    expect(screen.getByRole('button', { name: 'Dialog: erste Aktion' })).toHaveFocus();

    rerender(<DialogHarness active={false} />);

    expect(trigger).toHaveFocus();
  });

  it('does not attempt to restore focus when the trigger was removed', () => {
    const { rerender } = render(<DialogHarness active={false} />);
    const trigger = screen.getByRole('button', { name: 'Dialog öffnen' });

    trigger.focus();
    rerender(<DialogHarness active />);

    expect(() => {
      rerender(<DialogHarness active={false} showTrigger={false} />);
    }).not.toThrow();
    expect(trigger).not.toBeInTheDocument();
  });

  it('keeps tab navigation wrapped inside the dialog', () => {
    const { rerender } = render(<DialogHarness active={false} />);
    screen.getByRole('button', { name: 'Dialog öffnen' }).focus();
    rerender(<DialogHarness active />);

    const first = screen.getByRole('button', { name: 'Dialog: erste Aktion' });
    const last = screen.getByRole('button', { name: 'Dialog: letzte Aktion' });
    const dialog = screen.getByRole('dialog', { name: 'Dialog' });

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('keeps the current focus when the dialog has no focusable element', () => {
    const { rerender } = render(
      <DialogHarness active={false} includeFocusable={false} />,
    );
    const trigger = screen.getByRole('button', { name: 'Dialog öffnen' });

    trigger.focus();
    rerender(<DialogHarness active includeFocusable={false} />);

    expect(trigger).toHaveFocus();

    rerender(<DialogHarness active={false} includeFocusable={false} />);
    expect(trigger).toHaveFocus();
  });

  it('makes every other body child inert while the dialog is open, but not its own layer', () => {
    const { container, rerender } = render(<DialogHarness active={false} />);

    rerender(<DialogHarness active />);

    const layer = screen.getByRole('dialog').parentElement!;
    expect(layer.parentElement).toBe(document.body);
    expect(layer).not.toHaveAttribute('inert');
    expect(screen.getByTestId('Dialog-backdrop').closest('[inert]')).toBeNull();
    expect(container).toHaveAttribute('inert');

    rerender(<DialogHarness active={false} />);

    expect(inertBodyChildren()).toEqual([]);
  });

  it('keeps an inert attribute it did not set itself', () => {
    const sibling = document.createElement('div');
    sibling.dataset.testSibling = '';
    sibling.setAttribute('inert', '');
    document.body.append(sibling);
    const { rerender } = render(<DialogHarness active={false} />);

    rerender(<DialogHarness active />);
    rerender(<DialogHarness active={false} />);

    expect(sibling).toHaveAttribute('inert');
    expect(inertBodyChildren()).toEqual([sibling]);
  });

  it('releases the isolation before focus returns, so the trigger can take focus', () => {
    const { container, rerender } = render(<DialogHarness active={false} />);
    const trigger = screen.getByRole('button', { name: 'Dialog öffnen' });
    trigger.focus();
    rerender(<DialogHarness active />);

    let rootInertWhenFocused: boolean | null = null;
    trigger.addEventListener('focus', () => {
      rootInertWhenFocused = container.hasAttribute('inert');
    });
    rerender(<DialogHarness active={false} />);

    expect(trigger).toHaveFocus();
    expect(rootInertWhenFocused).toBe(false);
  });

  it('keeps only the topmost of overlapping dialogs operable, whichever closes first', () => {
    function Stack({ lower, upper }: { lower: boolean; upper: boolean }) {
      return (
        <>
          <button type="button">Dialog öffnen</button>
          <Dialog name="Unten" active={lower} />
          <Dialog name="Oben" active={upper} />
        </>
      );
    }
    const { container, rerender } = render(<Stack lower={false} upper={false} />);

    rerender(<Stack lower upper={false} />);
    rerender(<Stack lower upper />);

    const lowerLayer = screen.getByRole('dialog', { name: 'Unten', hidden: true }).parentElement!;
    const upperLayer = screen.getByRole('dialog', { name: 'Oben' }).parentElement!;
    expect(container).toHaveAttribute('inert');
    expect(lowerLayer).toHaveAttribute('inert');
    expect(upperLayer).not.toHaveAttribute('inert');

    // Die untere Ebene endet zuerst: Die obere bleibt allein bedienbar.
    rerender(<Stack lower={false} upper />);
    expect(container).toHaveAttribute('inert');
    expect(upperLayer).not.toHaveAttribute('inert');

    rerender(<Stack lower={false} upper={false} />);
    expect(inertBodyChildren()).toEqual([]);

    // Umgekehrte Reihenfolge: Nach der oberen wird die untere wieder bedienbar.
    rerender(<Stack lower upper={false} />);
    rerender(<Stack lower upper />);
    rerender(<Stack lower upper={false} />);
    const reopenedLower = screen.getByRole('dialog', { name: 'Unten' }).parentElement!;
    expect(reopenedLower).not.toHaveAttribute('inert');
    expect(container).toHaveAttribute('inert');

    rerender(<Stack lower={false} upper={false} />);
    expect(inertBodyChildren()).toEqual([]);
  });

  it('releases the isolation on unmount', () => {
    const { rerender, unmount } = render(<DialogHarness active={false} />);
    rerender(<DialogHarness active />);

    unmount();

    expect(inertBodyChildren()).toEqual([]);
  });
});
