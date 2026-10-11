import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalPortal } from '@/components/ModalPortal';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';
import { HeaderBar } from './HeaderBar';

function Dialog({ active, onClose }: { active: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref, active, onClose);
  useScrollLock(active);
  return active ? (
    <ModalPortal>
      <dialog open ref={ref} aria-label="Testdialog">
        <button type="button" onClick={onClose}>Schließen</button>
      </dialog>
    </ModalPortal>
  ) : null;
}

function Scene({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <HeaderBar />
      <button type="button" onClick={() => setOpen(true)}>Öffnen</button>
      <Dialog active={open} onClose={() => { onClose(); setOpen(false); }} />
    </MemoryRouter>
  );
}

describe('HeaderBar mit Modal-Lifecycle', () => {
  beforeEach(() => vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList));
  afterEach(() => vi.restoreAllMocks());

  it.each([{ ctrlKey: true }, { metaKey: true }])('fokussiert nach Dialog-Cleanup mit %j und benutzt den aktuellen Schließcallback', async (modifier) => {
    const previousClose = vi.fn();
    const currentClose = vi.fn();
    const { container, rerender } = render(<Scene onClose={previousClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    const close = screen.getByRole('button', { name: 'Schließen' });
    expect(close).toHaveFocus();
    expect(container).toHaveAttribute('inert');
    rerender(<Scene onClose={currentClose} />);
    const search = screen.getByTestId('header-search');
    const inertAtFocus: boolean[] = [];
    const focus = search.focus.bind(search);
    vi.spyOn(search, 'focus').mockImplementation(() => {
      inertAtFocus.push(container.hasAttribute('inert'));
      focus();
    });

    fireEvent.keyDown(close, { key: 'k', ...modifier });

    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(inertAtFocus).toEqual([false]);
    expect(document.documentElement.style.overflow).toBe('');
    expect(currentClose).toHaveBeenCalledOnce();
    expect(previousClose).not.toHaveBeenCalled();
  });

  it('beendet einen ausstehenden Fokusversuch beim Unmount', async () => {
    const { container, unmount } = render(<Scene onClose={() => {}} />);
    const search = screen.getByTestId('header-search');
    const focus = vi.spyOn(search, 'focus');
    container.setAttribute('inert', '');
    fireEvent.keyDown(container, { key: 'k', ctrlKey: true });
    unmount();
    container.removeAttribute('inert');
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
  });
});
