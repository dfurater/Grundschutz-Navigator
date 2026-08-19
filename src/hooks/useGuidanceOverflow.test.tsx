import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGuidanceOverflow } from './useGuidanceOverflow';

interface GuidanceHarnessProps {
  scopeId: string;
  enabled: boolean;
  guidance?: string;
}

function GuidanceHarness({
  scopeId,
  enabled,
  guidance = 'Hinweis',
}: GuidanceHarnessProps) {
  const {
    ref,
    expanded,
    hasOverflow,
    toggleExpanded,
  } = useGuidanceOverflow({ scopeId, enabled });

  return (
    <div>
      <p ref={ref}>{guidance}</p>
      <output data-testid="expanded">{String(expanded)}</output>
      <output data-testid="has-overflow">{String(hasOverflow)}</output>
      <button type="button" onClick={toggleExpanded}>Umschalten</button>
    </div>
  );
}

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function mockElementHeights(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
    .mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockReturnValue(clientHeight);
}

afterEach(() => {
  ResizeObserverMock.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useGuidanceOverflow', () => {
  it('does not report overflow when the guidance text exactly fits', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    mockElementHeights(120, 120);

    render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);

    expect(screen.getByTestId('has-overflow')).toHaveTextContent('false');
  });

  it('tolerates one physical pixel of height difference', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    mockElementHeights(121, 120);

    render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);

    expect(screen.getByTestId('has-overflow')).toHaveTextContent('false');
  });

  it('reports overflow when the text exceeds the tolerance', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    mockElementHeights(122, 120);

    render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);

    expect(screen.getByTestId('has-overflow')).toHaveTextContent('true');
  });

  it('observes the paragraph and its parent and remeasures after an observer callback', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    let scrollHeight = 120;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(() => scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(120);

    render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);

    const observer = ResizeObserverMock.instances[0]!;
    const paragraph = screen.getByText('Hinweis');
    expect(observer.observe).toHaveBeenCalledWith(paragraph);
    expect(observer.observe).toHaveBeenCalledWith(paragraph.parentElement);
    expect(screen.getByTestId('has-overflow')).toHaveTextContent('false');

    scrollHeight = 122;
    act(() => observer.trigger());

    expect(screen.getByTestId('has-overflow')).toHaveTextContent('true');
  });

  it('remeasures when guidance content changes within the same scope', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    let scrollHeight = 120;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(() => scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(120);

    const view = render(
      <GuidanceHarness
        scopeId="gspp:TOP.1.1"
        enabled
        guidance="Kurzer Hinweis"
      />,
    );
    expect(screen.getByTestId('has-overflow')).toHaveTextContent('false');

    scrollHeight = 240;
    view.rerender(
      <GuidanceHarness
        scopeId="gspp:TOP.1.1"
        enabled
        guidance="Ein deutlich längerer Hinweis"
      />,
    );

    expect(screen.getByTestId('has-overflow')).toHaveTextContent('true');
  });

  it('resets expansion and overflow synchronously when the scope changes', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    mockElementHeights(122, 120);

    const view = render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Umschalten' }));
    expect(screen.getByTestId('expanded')).toHaveTextContent('true');

    view.rerender(<GuidanceHarness scopeId="wlan:WLAN.9.1" enabled={false} />);

    expect(screen.getByTestId('expanded')).toHaveTextContent('false');
    expect(screen.getByTestId('has-overflow')).toHaveTextContent('false');
  });

  it('does not revive expansion after a disabled scope roundtrip without interaction', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    mockElementHeights(122, 120);

    const view = render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Umschalten' }));
    expect(screen.getByTestId('expanded')).toHaveTextContent('true');

    view.rerender(<GuidanceHarness scopeId="wlan:WLAN.9.1" enabled={false} />);
    view.rerender(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled={false} />);

    expect(screen.getByTestId('expanded')).toHaveTextContent('false');
    expect(screen.getByTestId('has-overflow')).toHaveTextContent('false');
  });

  it('disconnects the old observer and measures the new scope when enabled', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    let scrollHeight = 122;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(() => scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(120);

    const view = render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);
    const oldObserver = ResizeObserverMock.instances[0]!;
    expect(screen.getByTestId('has-overflow')).toHaveTextContent('true');

    scrollHeight = 120;
    view.rerender(<GuidanceHarness scopeId="wlan:WLAN.9.1" enabled />);

    const newObserver = ResizeObserverMock.instances[1]!;
    expect(oldObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(newObserver.observe).toHaveBeenCalledWith(screen.getByText('Hinweis'));
    expect(screen.getByTestId('expanded')).toHaveTextContent('false');
    expect(screen.getByTestId('has-overflow')).toHaveTextContent('false');
  });

  it('disconnects its observer when expanded, resumes observing when collapsed, and cleans up on unmount', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    mockElementHeights(122, 120);

    const view = render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);
    const observer = ResizeObserverMock.instances[0]!;

    fireEvent.click(screen.getByRole('button', { name: 'Umschalten' }));
    expect(observer.disconnect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Umschalten' }));
    const collapsedObserver = ResizeObserverMock.instances[1]!;
    expect(collapsedObserver.observe).toHaveBeenCalledWith(screen.getByText('Hinweis'));
    view.unmount();
    expect(collapsedObserver.disconnect).toHaveBeenCalledTimes(1);
  });

  it('uses the window resize fallback only while enabled and collapsed', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    let scrollHeight = 120;
    mockElementHeights(scrollHeight, 120);
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');

    const view = render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(screen.getByTestId('has-overflow')).toHaveTextContent('false');

    scrollHeight = 122;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(scrollHeight);
    fireEvent.resize(window);
    expect(screen.getByTestId('has-overflow')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('button', { name: 'Umschalten' }));
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

    view.rerender(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled={false} />);
    expect(screen.getByTestId('has-overflow')).toHaveTextContent('false');
  });

  it('cleans up and replaces the window fallback when the scope changes', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    mockElementHeights(120, 120);
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');

    const view = render(<GuidanceHarness scopeId="gspp:TOP.1.1" enabled />);
    const resizeSubscriptions = () => addEventListener.mock.calls.filter(
      ([eventName]) => eventName === 'resize',
    );
    const firstListener = resizeSubscriptions()[0]?.[1];

    view.rerender(<GuidanceHarness scopeId="wlan:WLAN.9.1" enabled />);

    expect(removeEventListener).toHaveBeenCalledWith('resize', firstListener);
    expect(resizeSubscriptions()).toHaveLength(2);

    const secondListener = resizeSubscriptions()[1]?.[1];
    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith('resize', secondListener);
  });
});
