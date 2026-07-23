import { useEffectEvent, useLayoutEffect } from 'react';

type GlobalEventTargetName = 'document' | 'window';

type GlobalEventMap<Target extends GlobalEventTargetName> =
  Target extends 'window' ? WindowEventMap : DocumentEventMap;

export function useGlobalEventListener<
  Target extends GlobalEventTargetName,
  EventName extends keyof GlobalEventMap<Target> & string,
>(
  target: Target,
  eventName: EventName,
  listener: (event: GlobalEventMap<Target>[EventName]) => void,
  enabled = true,
) {
  const onEvent = useEffectEvent(listener);

  useLayoutEffect(() => {
    if (!enabled) return;

    const eventTarget: EventTarget = target === 'window' ? window : document;
    const handleEvent = (event: Event) => {
      onEvent(event as GlobalEventMap<Target>[EventName]);
    };

    eventTarget.addEventListener(eventName, handleEvent);
    return () => eventTarget.removeEventListener(eventName, handleEvent);
  }, [enabled, eventName, target]);
}
