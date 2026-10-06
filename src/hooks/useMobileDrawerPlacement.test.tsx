import { act, render, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import type { TransitionEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMobileDrawerPlacement } from './useMobileDrawerPlacement';

function scrollTo(y: number) {
  Object.defineProperty(globalThis, 'scrollY', { configurable: true, value: y });
}

function ownTransitionEnd(propertyName: string): TransitionEvent<HTMLElement> {
  const element = document.createElement('aside');
  return { target: element, currentTarget: element, propertyName } as unknown as TransitionEvent<HTMLElement>;
}

// Ohne Element prüft der Hook kein Hinausgleiten; die Fälle mit Element setzen es.
const drawerRef: { current: HTMLElement | null } = { current: null };

function nextFrame() {
  return act(() => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); }));
}

function drawerWith(animations: Partial<Animation>[]) {
  const element = document.createElement('aside');
  element.getAnimations = () => animations as Animation[];
  return element;
}

// Wie die neue Seite einer Themenwahl: scrollt im eigenen Layout-Effekt,
// also im selben Commit und vor den Layout-Effekten der Shell.
function ScrollingPage({ open }: { readonly open: boolean }) {
  useLayoutEffect(() => {
    if (!open) scrollTo(0);
  }, [open]);
  return null;
}

function Shell({ open }: { readonly open: boolean }) {
  const placement = useMobileDrawerPlacement(open, false, false, drawerRef);
  return (
    <>
      <ScrollingPage open={open} />
      <button type="button" onClick={placement.captureOffset}>Menü</button>
      <output>{placement.top}</output>
    </>
  );
}

describe('useMobileDrawerPlacement', () => {
  afterEach(() => {
    drawerRef.current = null;
    scrollTo(0);
    document.documentElement.style.overflow = '';
  });

  it('legt die offene Schublade an die beim Öffnen erfasste Dokumentposition und sperrt das Dokument', () => {
    const { result, rerender } = renderHook(
      ({ open }) => useMobileDrawerPlacement(open, false, false, drawerRef),
      { initialProps: { open: false } },
    );
    expect(result.current.top).toBe(0);

    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: true });

    expect(result.current.top).toBe(640);
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('setzt die geschlossene Schublade erst nach dem Hinausgleiten zurück', () => {
    const { result, rerender } = renderHook(
      ({ open }) => useMobileDrawerPlacement(open, false, false, drawerRef),
      { initialProps: { open: false } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: true });
    rerender({ open: false });

    // Während des Hinausgleitens bleibt die Lage, sonst spränge die Schublade.
    expect(result.current.top).toBe(640);
    expect(document.documentElement.style.overflow).toBe('');

    // Transitionen von Nachfahren zählen nicht.
    const foreign = {
      target: document.createElement('div'),
      currentTarget: document.createElement('aside'),
      propertyName: 'translate',
    };
    act(() => result.current.onTransitionEnd(foreign as unknown as TransitionEvent<HTMLElement>));
    expect(result.current.top).toBe(640);

    // Die Breiten-Transition läuft gleichzeitig, darf den Drawer aber nicht
    // vor dem Ende seiner Translate-Transition zurücksetzen.
    act(() => result.current.onTransitionEnd(ownTransitionEnd('width')));
    expect(result.current.top).toBe(640);

    act(() => result.current.onTransitionEnd(ownTransitionEnd('translate')));
    expect(result.current.top).toBe(0);
  });

  it('hält die hinausgleitende Schublade an der Dokumentposition, wenn die neue Seite im selben Commit scrollt', () => {
    const { container, getByRole, rerender } = render(<Shell open={false} />);
    scrollTo(640);
    act(() => getByRole('button').click());
    rerender(<Shell open />);
    expect(container.querySelector('output')?.textContent).toBe('640');

    rerender(<Shell open={false} />);
    expect(globalThis.scrollY).toBe(0);
    expect(container.querySelector('output')?.textContent).toBe('0');
  });

  it('führt die hinausgleitende Schublade mit der Dokumentposition nach, bis sie verschwunden ist', () => {
    const { result, rerender } = renderHook(
      ({ open }) => useMobileDrawerPlacement(open, false, false, drawerRef),
      { initialProps: { open: false } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: true });
    rerender({ open: false });

    scrollTo(320);
    act(() => { globalThis.dispatchEvent(new Event('scroll')); });
    expect(result.current.top).toBe(320);

    act(() => result.current.onTransitionEnd(ownTransitionEnd('translate')));
    expect(result.current.top).toBe(0);

    // Die verschwundene Schublade folgt nicht mehr; sie bleibt oben.
    scrollTo(480);
    act(() => { globalThis.dispatchEvent(new Event('scroll')); });
    expect(result.current.top).toBe(0);
  });

  it('beendet das Hinausgleiten bei abgebrochener Transition', () => {
    const { result, rerender } = renderHook(
      ({ open }) => useMobileDrawerPlacement(open, false, false, drawerRef),
      { initialProps: { open: false } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: true });
    rerender({ open: false });

    act(() => result.current.onTransitionCancel(ownTransitionEnd('translate')));
    scrollTo(320);
    act(() => { globalThis.dispatchEvent(new Event('scroll')); });
    expect(result.current.top).toBe(0);
  });

  it('beendet das Hinausgleiten im nächsten Frame, wenn keine Translate-Transition läuft', async () => {
    const { result, rerender } = renderHook(
      ({ open }) => useMobileDrawerPlacement(open, false, false, drawerRef),
      { initialProps: { open: false } },
    );
    drawerRef.current = drawerWith([{ transitionProperty: 'width' } as Partial<Animation>]);
    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: true });
    rerender({ open: false });
    expect(result.current.top).toBe(640);

    await nextFrame();
    expect(result.current.top).toBe(0);
    scrollTo(320);
    act(() => { globalThis.dispatchEvent(new Event('scroll')); });
    expect(result.current.top).toBe(0);
  });

  it('lässt die Schublade im nächsten Frame weiter folgen, solange ihre Translate-Transition läuft', async () => {
    const { result, rerender } = renderHook(
      ({ open }) => useMobileDrawerPlacement(open, false, false, drawerRef),
      { initialProps: { open: false } },
    );
    drawerRef.current = drawerWith([{ transitionProperty: 'translate' } as Partial<Animation>]);
    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: true });
    rerender({ open: false });

    await nextFrame();
    scrollTo(320);
    act(() => { globalThis.dispatchEvent(new Event('scroll')); });
    expect(result.current.top).toBe(320);
  });

  it('legt die geschlossene Schublade ohne Überblendung sofort oben ab', () => {
    const { result, rerender } = renderHook(
      ({ open }) => useMobileDrawerPlacement(open, false, true, drawerRef),
      { initialProps: { open: true } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());
    expect(result.current.top).toBe(640);

    rerender({ open: false });
    expect(result.current.top).toBe(0);
  });

  it('hält die geschlossene Schublade oben, wenn Reduced Motion danach endet', () => {
    const { result, rerender } = renderHook(
      ({ open, transitionDisabled }) => useMobileDrawerPlacement(open, false, transitionDisabled, drawerRef),
      { initialProps: { open: true, transitionDisabled: true } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: false, transitionDisabled: true });
    rerender({ open: false, transitionDisabled: false });

    expect(result.current.top).toBe(0);
  });

  it('legt die Schublade oben ab, wenn Reduced Motion während des Hinausgleitens beginnt', () => {
    const { result, rerender } = renderHook(
      ({ open, transitionDisabled }) => useMobileDrawerPlacement(open, false, transitionDisabled, drawerRef),
      { initialProps: { open: true, transitionDisabled: false } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: false, transitionDisabled: false });
    expect(result.current.top).toBe(640);

    // Die Transition entfällt; ein `transitionend` käme nicht mehr.
    rerender({ open: false, transitionDisabled: true });
    expect(result.current.top).toBe(0);
  });

  it('legt Schublade und Dokument nach einem Wechsel über md bei offener Schublade nach oben', () => {
    const scrollToSpy = vi.spyOn(globalThis, 'scrollTo').mockImplementation(() => {});
    const { result, rerender } = renderHook(
      ({ persistent }) => useMobileDrawerPlacement(true, persistent, false, drawerRef),
      { initialProps: { persistent: false } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());

    rerender({ persistent: true });
    expect(result.current.top).toBeUndefined();
    expect(document.documentElement.style.overflow).toBe('');

    scrollToSpy.mockClear();
    rerender({ persistent: false });
    expect(result.current.top).toBe(0);
    expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    expect(document.documentElement.style.overflow).toBe('hidden');
    scrollToSpy.mockRestore();
  });
});
