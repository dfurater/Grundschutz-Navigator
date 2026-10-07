/** Reine Entscheidungen der Wischgesten der mobilen Navigationsschublade (`useMobileDrawerSwipe`). */

/** Ab dieser Strecke entscheidet die Richtung, ob die Geste der Schublade gehört. */
export const DIRECTION_SLOP_PX = 10;
/** Schneller geworfen entscheidet die Richtung, nicht die Strecke (px/ms). */
const FLING_VELOCITY = 0.3;
/** Zeitfenster vor dem Loslassen, aus dem die Wurfgeschwindigkeit stammt. */
const VELOCITY_WINDOW_MS = 100;
const RELEASE_MIN_MS = 90;
/** Entspricht `--duration-drawer` (src/index.css). */
const RELEASE_MAX_MS = 220;
/** Der Finger bewegt die Schublade bereits; die Freigabe bremst nur noch ab. */
const RELEASE_EASING = 'cubic-bezier(0, 0, 0.2, 1)';

export interface Sample {
  readonly x: number;
  readonly time: number;
}

function releaseVelocity(samples: readonly Sample[], releaseTime: number) {
  const recent = samples.filter((sample) => releaseTime - sample.time <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent.at(-1)!;
  return last.time > first.time ? (last.x - first.x) / (last.time - first.time) : 0;
}

/**
 * Eine Öffnen-Geste beginnt nur auf der Seite selbst: nicht in festen
 * Ebenen (Sheets, Auswahlleiste) und nicht in Bereichen, die
 * selbst waagerecht scrollen, etwa breiten Tabellen.
 */
export function startsOpenGesture(target: EventTarget | null, shell: HTMLElement) {
  if (!(target instanceof Element) || target.closest('main, header') === null) return false;
  for (let element: Element | null = target; element && element !== shell; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.position === 'fixed') return false;
    if (/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth) return false;
  }
  return true;
}

/**
 * Ausgang einer losgelassenen Geste: Ein Wurf entscheidet die Richtung, sonst
 * die halbe Strecke. Die Freigabe übernimmt die Geschwindigkeit des Fingers;
 * `motion` ist `null`, wenn keine Strecke mehr bleibt.
 */
export function releaseGesture(samples: readonly Sample[], releaseTime: number, offset: number, width: number) {
  const velocity = releaseVelocity(samples, releaseTime);
  const opens = velocity > FLING_VELOCITY || (velocity >= -FLING_VELOCITY && offset > -width / 2);
  const distance = opens ? -offset : width + offset;
  const speed = Math.abs(velocity);
  const duration = speed >= FLING_VELOCITY ? distance / speed : RELEASE_MAX_MS * (distance / width);
  const clamped = Math.round(Math.min(RELEASE_MAX_MS, Math.max(RELEASE_MIN_MS, duration)));
  return { opens, motion: distance >= 1 ? `${clamped}ms ${RELEASE_EASING}` : null };
}
