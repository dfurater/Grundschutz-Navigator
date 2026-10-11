import { act, fireEvent, render, screen } from '@testing-library/react';
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

function ScrollFixture() {
  const { formRef, headingRef, summaryRef, sectionsRef, bodyRef, scrollSummary, onScroll } = useAdaptiveFilterHeader(true);
  return <form ref={(element) => {
    formRef.current = element;
    if (element) Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => availableHeight });
  }}>
    <div ref={headingRef} data-height="68" data-scroll-summary={scrollSummary} />
    <div ref={bodyRef} onScroll={onScroll} data-testid="body">
      <div ref={summaryRef} data-height="56" />
      <div ref={sectionsRef} onScroll={onScroll} data-testid="sections"><label data-height="88">Filterzeile</label></div>
    </div>
    <output>{String(scrollSummary)}</output>
  </form>;
}

function scrollGeometry() {
  // Die Sektionen beginnen 56 px unter dem äußeren Bereich und wandern mit dessen Scrollposition.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const body = this.closest('form')?.querySelector<HTMLElement>('[data-testid="body"]');
    const top = this.dataset.testid === 'sections' ? 56 - (body?.scrollTop ?? 0) : 0;
    return { height: Number(this.dataset.height ?? 0), top } as DOMRect;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
}

function scrollTo(testId: string, top: number) {
  const element = screen.getByTestId(testId);
  element.scrollTop = top;
  fireEvent.scroll(element);
}

it('keeps the top visible filter row when scrolling moves from the list to the outer body', () => {
  scrollGeometry();
  availableHeight = 800;
  render(<ScrollFixture />);
  expect(screen.getByRole('status')).toHaveTextContent('false');
  scrollTo('sections', 120);
  availableHeight = 156;
  act(() => resize());
  expect(screen.getByRole('status')).toHaveTextContent('true');
  expect(screen.getByTestId('body').scrollTop).toBe(176);
});

it('keeps the top visible filter row when scrolling moves from the outer body to the list', () => {
  scrollGeometry();
  render(<ScrollFixture />);
  expect(screen.getByRole('status')).toHaveTextContent('true');
  scrollTo('body', 176);
  availableHeight = 800;
  act(() => resize());
  expect(screen.getByRole('status')).toHaveTextContent('false');
  expect(screen.getByTestId('sections').scrollTop).toBe(120);
});

it('leaves an unscrolled list at its start and starts the list at zero while the summary was visible', () => {
  scrollGeometry();
  availableHeight = 800;
  render(<ScrollFixture />);
  availableHeight = 156;
  act(() => resize());
  expect(screen.getByTestId('body').scrollTop).toBe(0);
  scrollTo('body', 20);
  availableHeight = 800;
  act(() => resize());
  expect(screen.getByTestId('sections').scrollTop).toBe(0);
});

it('ignores the scroll position the browser clamps during a resize before measuring', () => {
  scrollGeometry();
  render(<ScrollFixture />);
  expect(screen.getByRole('status')).toHaveTextContent('true');
  const body = screen.getByTestId('body');
  scrollTo('body', 176);
  // Das größere Fenster verkleinert den Scrollweg und begrenzt scrollTop vor der Messung.
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 400 });
  scrollTo('body', 130);
  availableHeight = 800;
  act(() => resize());
  expect(screen.getByRole('status')).toHaveTextContent('false');
  expect(screen.getByTestId('sections').scrollTop).toBe(120);
});

it('refreshes the saved position when a resize keeps the mode', () => {
  scrollGeometry();
  render(<ScrollFixture />);
  const body = screen.getByTestId('body');
  scrollTo('body', 176);
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 120 });
  body.scrollTop = 156;
  act(() => resize());
  expect(screen.getByRole('status')).toHaveTextContent('true');
  scrollTo('body', 166);
  availableHeight = 800;
  act(() => resize());
  expect(screen.getByTestId('sections').scrollTop).toBe(110);
});
