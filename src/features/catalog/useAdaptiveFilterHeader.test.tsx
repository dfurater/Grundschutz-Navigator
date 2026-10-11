import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAdaptiveFilterHeader } from './useAdaptiveFilterHeader';

let availableHeight = 156;
let resize: () => void;
const disconnect = vi.fn();
function Fixture({ adaptive = true }: { readonly adaptive?: boolean }) {
  const { formRef, headingRef, summaryRef, sectionsRef, scrollSummary } = useAdaptiveFilterHeader(adaptive);
  return <form ref={(element) => {
    formRef.current = element;
    if (element) Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => availableHeight });
  }}>
    <div ref={headingRef} data-height="68" data-scroll-summary={scrollSummary} />
    <div ref={summaryRef} data-height="56" />
    <div ref={sectionsRef}><label data-height="88">Filterzeile</label></div>
    <output>{String(scrollSummary)}</output>
  </form>;
}
function geometry() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return { height: Number(this.dataset.height ?? 0) } as DOMRect;
  });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); disconnect.mockReset(); availableHeight = 156; });

it('switches for a constrained row, returns at greater height and disconnects measurement', () => {
  geometry();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const view = render(<Fixture />);
  expect(screen.getByRole('status')).toHaveTextContent('true');
  act(() => resize());
  expect(screen.getByRole('status')).toHaveTextContent('true');
  availableHeight = 800;
  act(() => resize());
  expect(screen.getByRole('status')).toHaveTextContent('false');
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('keeps desktop measurement disabled', () => {
  geometry();
  render(<Fixture adaptive={false} />);
  expect(screen.getByRole('status')).toHaveTextContent('false');
});

it('uses and cleans up the resize fallback when ResizeObserver is unavailable', () => {
  geometry();
  vi.stubGlobal('ResizeObserver', undefined);
  const remove = vi.spyOn(globalThis, 'removeEventListener');
  const view = render(<Fixture />);
  expect(screen.getByRole('status')).toHaveTextContent('true');
  availableHeight = 800;
  act(() => globalThis.dispatchEvent(new Event('resize')));
  expect(screen.getByRole('status')).toHaveTextContent('false');
  view.unmount();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
});
