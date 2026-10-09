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
/**
 * Anfangssteigung der Freigabekurve ohne Begrenzung der Dauer: 2 ist das
 * gleichmäßige Abbremsen bis zum Stillstand (quadratisches Ease-out).
 */
const NATURAL_SLOPE = 2;
/** Steiler beginnt die Kurve nicht, sonst schösse sie über das Ziel hinaus. */
const MAX_SLOPE = 3;

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
 * Nach einem Breitenwechsel gleicht die Schublade ihre Breite noch per
 * Transition an. Eine Geste, die jetzt beginnt, übernähme die Zwischenbreite;
 * sie beginnt deshalb erst danach. jsdom kennt `getAnimations` nicht.
 */
export function widthSettling(drawer: Element) {
  return drawer.getAnimations?.().some(
    (animation) => animation instanceof CSSTransition && animation.transitionProperty === 'width',
  ) ?? false;
}

/** Eingabefelder, in denen waagerechtes Ziehen Schreibmarke oder Auswahl bewegt. */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false" i])';

/**
 * Eine Öffnen-Geste beginnt nur auf der Seite selbst: nicht in festen
 * Ebenen (Sheets, Auswahlleiste), nicht in Eingabefeldern und nicht in
 * Bereichen, die selbst waagerecht scrollen, etwa breiten Tabellen.
 */
export function startsOpenGesture(target: EventTarget | null, shell: HTMLElement) {
  if (!(target instanceof Element) || target.closest('main, header') === null) return false;
  if (target.closest(EDITABLE_SELECTOR) !== null) return false;
  for (let element: Element | null = target; element && element !== shell; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.position === 'fixed') return false;
    if (/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth) return false;
  }
  return true;
}

/**
 * Endsteigung zur Anfangssteigung `s`. Ab `s = 1,5` endet die Freigabe im
 * Stillstand und wird nie schneller. Zwischen 1 und 1,5 käme sie so nicht ohne
 * Beschleunigen ins Ziel; sie behält dann zuerst das Fingertempo und kommt mit
 * der Steigung `3 − 2s` an. Unter 1 ist der Finger langsamer, als die Strecke in
 * der Dauer verlangt: Die Freigabe beschleunigt aus seinem Tempo und kommt im
 * Stillstand an.
 *
 * Herleitung (`x` zeitlich linear): Die Geschwindigkeit der Kurve ist
 * `s + (6 − 4s − 2e)·t + (3s + 3e − 6)·t²`. Sie steigt auf [0, 1] genau dann
 * nie an, wenn `3 − 2s ≤ e ≤ 1,5 − s/2` gilt; mit diesen `e` bleibt sie für
 * `0 ≤ s ≤ 3` nicht negativ, die Schublade schießt also nicht über das Ziel.
 */
function endSlope(slope: number) {
  return slope >= 1 && slope < 1.5 ? 3 - 2 * slope : 0;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Ausgang einer losgelassenen Geste: Ein Wurf entscheidet die Richtung, sonst
 * die halbe Strecke. Die Freigabe übernimmt die Geschwindigkeit des Fingers:
 * Ihre Kurve `cubic-bezier(1/3, s/3, 2/3, 1 − e/3)` verläuft zeitlich linear,
 * beginnt mit der Steigung `s`, also mit `s · Strecke / Dauer` px/ms, und endet
 * mit der Steigung `e` (`endSlope`). `s` wird aus der gemessenen
 * Geschwindigkeit und der Dauer bestimmt. `motion` ist `null`, wenn keine
 * Strecke mehr bleibt.
 */
export function releaseGesture(samples: readonly Sample[], releaseTime: number, offset: number, width: number) {
  const velocity = releaseVelocity(samples, releaseTime);
  const opens = velocity > FLING_VELOCITY || (velocity >= -FLING_VELOCITY && offset > -width / 2);
  const distance = opens ? -offset : width + offset;
  if (distance < 1) return { opens, motion: null };
  // Bewegt sich der Finger vom Ziel weg, beginnt die Freigabe aus dem Stand.
  const speed = Math.max(0, opens ? velocity : -velocity);
  const proportional = RELEASE_MAX_MS * (distance / width);
  const natural = speed > 0 ? NATURAL_SLOPE * distance / speed : proportional;
  let duration = Math.max(RELEASE_MIN_MS, Math.min(proportional, natural));
  if (speed > 0) duration = Math.min(duration, MAX_SLOPE * distance / speed);
  const rounded = Math.max(1, Math.round(duration));
  const slope = Math.min(MAX_SLOPE, speed * rounded / distance);
  const y1 = round3(slope / 3);
  const y2 = round3(1 - endSlope(slope) / 3);
  return { opens, motion: `${rounded}ms cubic-bezier(0.333, ${y1}, 0.667, ${y2})` };
}
