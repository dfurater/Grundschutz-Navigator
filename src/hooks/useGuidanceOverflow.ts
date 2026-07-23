import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { RefObject } from 'react';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';

const OVERFLOW_TOLERANCE_PX = 1;

export interface UseGuidanceOverflowOptions {
  scopeId: string;
  enabled: boolean;
}

export interface UseGuidanceOverflowResult {
  ref: RefObject<HTMLParagraphElement | null>;
  expanded: boolean;
  hasOverflow: boolean;
  toggleExpanded: () => void;
}

interface GuidanceState {
  scopeId: string;
  expanded: boolean;
  hasOverflow: boolean;
}

export function useGuidanceOverflow({
  scopeId,
  enabled,
}: UseGuidanceOverflowOptions): UseGuidanceOverflowResult {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [guidanceState, setGuidanceState] = useState<GuidanceState>(() => ({
    scopeId,
    expanded: false,
    hasOverflow: false,
  }));
  const hasCurrentScope = guidanceState.scopeId === scopeId;
  const expanded = hasCurrentScope ? guidanceState.expanded : false;
  const hasOverflow = enabled && hasCurrentScope
    ? guidanceState.hasOverflow
    : false;
  const measurementEnabled = enabled && !expanded && hasCurrentScope;

  const measureOverflow = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    const hasOverflow =
      element.scrollHeight - element.clientHeight > OVERFLOW_TOLERANCE_PX;

    setGuidanceState((current) => {
      const expanded = current.scopeId === scopeId
        ? current.expanded
        : false;

      return current.scopeId === scopeId
        && current.hasOverflow === hasOverflow
        ? current
        : { scopeId, expanded, hasOverflow };
    });
  }, [scopeId]);

  useLayoutEffect(() => {
    if (enabled && !hasCurrentScope) {
      measureOverflow();
    }
  }, [enabled, hasCurrentScope, measureOverflow]);

  useLayoutEffect(() => {
    if (!measurementEnabled) return;

    const element = ref.current;
    if (!element) return;

    measureOverflow();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);
    if (element.parentElement) {
      observer.observe(element.parentElement);
    }

    return () => observer.disconnect();
  }, [measureOverflow, measurementEnabled]);

  useGlobalEventListener(
    'window',
    'resize',
    measureOverflow,
    measurementEnabled && typeof ResizeObserver === 'undefined',
  );

  const toggleExpanded = useCallback(() => {
    setGuidanceState((current) => {
      if (current.scopeId !== scopeId) {
        return {
          scopeId,
          expanded: true,
          hasOverflow: false,
        };
      }

      return { ...current, expanded: !current.expanded };
    });
  }, [scopeId]);

  return { ref, expanded, hasOverflow, toggleExpanded };
}
