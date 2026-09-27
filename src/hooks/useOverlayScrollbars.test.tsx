import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const destroy = vi.fn();
const overlayScrollbars = vi.fn((...args: unknown[]) => ({ destroy, args }));

vi.mock('overlayscrollbars', () => ({
  OverlayScrollbars: (...args: unknown[]) => overlayScrollbars(...args),
}));

const { OVERLAY_SCROLLBARS_OPTIONS, useOverlayScrollbars } = await import('./useOverlayScrollbars');

function ScrollArea({ enabled }: { readonly enabled?: boolean }) {
  const ref = useOverlayScrollbars<HTMLDivElement>(enabled);
  return <div ref={ref} data-testid="scroll-area" />;
}

describe('useOverlayScrollbars', () => {
  beforeEach(() => {
    destroy.mockClear();
    overlayScrollbars.mockClear();
  });

  it('macht das bestehende Element selbst zum Viewport', () => {
    const { getByTestId } = render(<ScrollArea />);
    const element = getByTestId('scroll-area');

    expect(overlayScrollbars).toHaveBeenCalledTimes(1);
    expect(overlayScrollbars).toHaveBeenCalledWith(
      { target: element, elements: { viewport: element } },
      OVERLAY_SCROLLBARS_OPTIONS,
    );
  });

  it('blendet die Leiste nur beim Scrollen ein, auch vor der ersten Bewegung', () => {
    expect(OVERLAY_SCROLLBARS_OPTIONS.scrollbars).toMatchObject({
      autoHide: 'scroll',
      autoHideSuspend: false,
    });
  });

  it('zerstört die Instanz beim Entfernen des Elements', () => {
    const { unmount } = render(<ScrollArea />);
    unmount();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('lässt das Element ohne Instanz, solange es nicht selbst scrollt', () => {
    const { rerender } = render(<ScrollArea enabled={false} />);
    expect(overlayScrollbars).not.toHaveBeenCalled();

    rerender(<ScrollArea enabled />);
    expect(overlayScrollbars).toHaveBeenCalledTimes(1);

    rerender(<ScrollArea enabled={false} />);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
