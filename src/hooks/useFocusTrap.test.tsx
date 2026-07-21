import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocusTrap } from './useFocusTrap';

interface FocusTrapHarnessProps {
  active: boolean;
  includeFocusable?: boolean;
  showTrigger?: boolean;
}

function FocusTrapHarness({
  active,
  includeFocusable = true,
  showTrigger = true,
}: FocusTrapHarnessProps) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, active);

  return (
    <>
      {showTrigger && <button type="button">Overlay öffnen</button>}
      <div ref={trapRef} data-testid="focus-trap">
        {includeFocusable && (
          <>
            <button type="button">Erste Aktion</button>
            <button type="button">Letzte Aktion</button>
          </>
        )}
      </div>
    </>
  );
}

describe('useFocusTrap', () => {
  it('restores focus to the trigger when the trap is deactivated', () => {
    const { rerender } = render(<FocusTrapHarness active={false} />);
    const trigger = screen.getByRole('button', { name: 'Overlay öffnen' });

    trigger.focus();
    rerender(<FocusTrapHarness active />);

    expect(screen.getByRole('button', { name: 'Erste Aktion' })).toHaveFocus();

    rerender(<FocusTrapHarness active={false} />);

    expect(trigger).toHaveFocus();
  });

  it('does not attempt to restore focus when the trigger was removed', () => {
    const { rerender } = render(<FocusTrapHarness active={false} />);
    const trigger = screen.getByRole('button', { name: 'Overlay öffnen' });

    trigger.focus();
    rerender(<FocusTrapHarness active />);

    expect(() => {
      rerender(<FocusTrapHarness active={false} showTrigger={false} />);
    }).not.toThrow();
    expect(trigger).not.toBeInTheDocument();
  });

  it('keeps tab navigation wrapped inside the trap', () => {
    const { rerender } = render(<FocusTrapHarness active={false} />);
    screen.getByRole('button', { name: 'Overlay öffnen' }).focus();
    rerender(<FocusTrapHarness active />);

    const first = screen.getByRole('button', { name: 'Erste Aktion' });
    const last = screen.getByRole('button', { name: 'Letzte Aktion' });
    const trap = screen.getByTestId('focus-trap');

    last.focus();
    fireEvent.keyDown(trap, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(trap, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('keeps the current focus when the trap has no focusable element', () => {
    const { rerender } = render(
      <FocusTrapHarness active={false} includeFocusable={false} />,
    );
    const trigger = screen.getByRole('button', { name: 'Overlay öffnen' });

    trigger.focus();
    rerender(<FocusTrapHarness active includeFocusable={false} />);

    expect(trigger).toHaveFocus();

    rerender(<FocusTrapHarness active={false} includeFocusable={false} />);
    expect(trigger).toHaveFocus();
  });
});
