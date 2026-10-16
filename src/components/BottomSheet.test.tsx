import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BottomSheet } from '@/components/BottomSheet';

function content() {
  return <><h2 id="sheet-title">Test-Sheet</h2><button type="button">Aktion</button></>;
}

afterEach(() => { document.documentElement.style.overflow = ''; });

it('renders nothing and leaves scrolling enabled when closed', () => {
  const { container } = render(<BottomSheet open={false} onClose={vi.fn()} labelledBy="sheet-title">{content()}</BottomSheet>);
  expect(container).toBeEmptyDOMElement();
  expect(document.querySelector('[data-modal-layer]')).toBeNull();
  expect(document.documentElement.style.overflow).toBe('');
});

it('isolates the background, names the dialog and restores focus and scrolling after closing', () => {
  document.documentElement.style.overflow = 'scroll';
  const onClose = vi.fn();
  const surface = (open: boolean) => <><button type="button">Öffnen</button><BottomSheet open={open} onClose={onClose} labelledBy="sheet-title">{content()}</BottomSheet></>;
  const view = render(surface(false));
  const trigger = screen.getByRole('button', { name: 'Öffnen' });
  trigger.focus();
  view.rerender(surface(true));
  const dialog = screen.getByRole('dialog', { name: 'Test-Sheet' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveAttribute('aria-labelledby', 'sheet-title');
  expect(view.container).not.toContainElement(dialog);
  expect(view.container).toHaveAttribute('inert');
  expect(screen.getByRole('button', { name: 'Aktion' })).toHaveFocus();
  expect(document.documentElement.style.overflow).toBe('hidden');
  expect(dialog.lastElementChild).toHaveRole('status');
  fireEvent.keyDown(dialog, { key: 'Enter' });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
  view.rerender(surface(false));
  expect(document.querySelector('dialog')).toBeNull();
  expect(view.container).not.toHaveAttribute('inert');
  expect(trigger).toHaveFocus();
  expect(document.documentElement.style.overflow).toBe('scroll');
});

it('closes from the backdrop and releases its scroll lock on unmount', () => {
  const onClose = vi.fn();
  const view = render(<BottomSheet open onClose={onClose} labelledBy="sheet-title">{content()}</BottomSheet>);
  const backdrop = document.querySelector('.fixed.inset-0[aria-hidden="true"]')!;
  expect(backdrop).toHaveStyle({ opacity: '0.3' });
  fireEvent.click(backdrop);
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.documentElement.style.overflow).toBe('');
  expect(document.querySelector('[inert]')).toBeNull();
});

it('enables handle gestures only when draggable is set', () => {
  const onClose = vi.fn();
  const surface = (draggable?: boolean) => <BottomSheet open onClose={onClose} labelledBy="sheet-title" draggable={draggable}>{content()}</BottomSheet>;
  const view = render(surface());
  const dialog = screen.getByRole('dialog');
  const handle = dialog.firstElementChild!;
  expect(handle).not.toHaveClass('cursor-grab', 'touch-none');
  const start = () => {
    const event = new Event('touchstart', { bubbles: true });
    Object.defineProperty(event, 'touches', { value: [{ clientY: 100 }] });
    handle.dispatchEvent(event);
  };
  start();
  expect(dialog.style.transition).toBe('');
  view.rerender(surface(true));
  expect(handle).toHaveClass('cursor-grab', 'active:cursor-grabbing', 'touch-none');
  start();
  expect(dialog.style.transition).toBe('none');
});
