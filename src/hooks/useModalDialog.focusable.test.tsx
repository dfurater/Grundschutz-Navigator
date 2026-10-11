import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { ModalPortal } from '@/components/ModalPortal';
import { useModalDialog } from './useModalDialog';

describe('useModalDialog: Ziele des Tab-Umlaufs', () => {
  it('wraps tab navigation around hidden and inert targets at both ends', () => {
    function HiddenEndsDialog() {
      const ref = useRef<HTMLDialogElement>(null);
      useModalDialog(ref, true, () => {});
      return (
        <ModalPortal>
          <dialog open ref={ref} aria-modal="true" aria-label="Legende">
            <div inert>
              <a href="#inert-vorn">Inerter Link</a>
            </div>
            <button type="button">Erste sichtbare Aktion</button>
            <button type="button">Letzte sichtbare Aktion</button>
            <dl hidden>
              <dt><a href="#legende">Versteckter Legendenlink</a></dt>
            </dl>
          </dialog>
        </ModalPortal>
      );
    }
    render(<HiddenEndsDialog />);

    const dialog = screen.getByRole('dialog', { name: 'Legende' });
    const first = screen.getByRole('button', { name: 'Erste sichtbare Aktion' });
    const last = screen.getByRole('button', { name: 'Letzte sichtbare Aktion' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
  });
});
