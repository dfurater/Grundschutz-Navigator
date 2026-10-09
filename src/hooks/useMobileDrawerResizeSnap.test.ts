import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishDrawerMotion, useMobileDrawerResizeSnap } from './useMobileDrawerResizeSnap';

class FakeKeyframeEffect {
  readonly target: Element;
  constructor(target: Element) {
    this.target = target;
  }
}

class FakeTransition {
  readonly effect: FakeKeyframeEffect;
  readonly finish = vi.fn();
  constructor(target: Element) {
    this.effect = new FakeKeyframeEffect(target);
  }
}

function shellWithMotion() {
  const shell = document.createElement('div');
  const drawer = shell.appendChild(Object.assign(document.createElement('aside'), { className: 'mobile-nav-drawer' }));
  const page = shell.appendChild(Object.assign(document.createElement('main'), { className: 'mobile-nav-push' }));
  const other = shell.appendChild(document.createElement('div'));
  const transitions = [drawer, page, other].map((target) => new FakeTransition(target));
  const otherAnimation = { finish: vi.fn() };
  shell.getAnimations = () => [...transitions, otherAnimation] as unknown as Animation[];
  return { shell, transitions, otherAnimation };
}

describe('useMobileDrawerResizeSnap', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('beendet nur die Transitionen von Schublade, Seite und Abdunklung', () => {
    vi.stubGlobal('CSSTransition', FakeTransition);
    vi.stubGlobal('KeyframeEffect', FakeKeyframeEffect);
    const { shell, transitions: [drawer, page, other], otherAnimation } = shellWithMotion();

    finishDrawerMotion(shell);
    expect(drawer.finish).toHaveBeenCalledOnce();
    expect(page.finish).toHaveBeenCalledOnce();
    expect(other.finish).not.toHaveBeenCalled();
    expect(otherAnimation.finish).not.toHaveBeenCalled();
  });

  it('bleibt ohne getAnimations wirkungslos', () => {
    expect(() => finishDrawerMotion(document.createElement('div'))).not.toThrow();
  });

  it('stellt die Bewegung nur unter md bei jedem resize sofort', () => {
    vi.stubGlobal('CSSTransition', FakeTransition);
    vi.stubGlobal('KeyframeEffect', FakeKeyframeEffect);
    const { shell, transitions: [drawer] } = shellWithMotion();
    const view = renderHook(({ enabled }) => useMobileDrawerResizeSnap(enabled, { current: shell }), {
      initialProps: { enabled: true },
    });

    globalThis.dispatchEvent(new Event('resize'));
    expect(drawer.finish).toHaveBeenCalledOnce();

    view.rerender({ enabled: false });
    globalThis.dispatchEvent(new Event('resize'));
    expect(drawer.finish).toHaveBeenCalledOnce();
    view.unmount();
  });
});
