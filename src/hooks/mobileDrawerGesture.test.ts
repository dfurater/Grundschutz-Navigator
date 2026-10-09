import { describe, expect, it } from 'vitest';
import { releaseGesture } from './mobileDrawerGesture';
import type { Sample } from './mobileDrawerGesture';

const WIDTH = 300;

/** Finger mit gleichmäßigem Tempo (px/ms), 5 ms vor dem Loslassen zuletzt gemessen. */
function samples(from: number, speed: number): { samples: Sample[]; releaseTime: number } {
  return { samples: [{ x: from, time: 0 }, { x: from + speed * 20, time: 20 }], releaseTime: 25 };
}

function parse(motion: string | null) {
  const match = /^(\d+)ms cubic-bezier\(0\.333, ([\d.]+), 0\.667, ([\d.]+)\)$/.exec(motion ?? '');
  if (match === null) throw new Error(`unerwartete Freigabe: ${motion}`);
  return { duration: Number(match[1]), y1: Number(match[2]), y2: Number(match[3]) };
}

/** Anfangstempo der Kurve in px/ms: Steigung `3 · y1` mal Strecke durch Dauer. */
const initialSpeed = (motion: string | null, distance: number) => {
  const { duration, y1 } = parse(motion);
  return 3 * y1 * distance / duration;
};

describe('releaseGesture', () => {
  // Fall aus der Review: 1,5 px/ms nach links, 270 px Reststrecke.
  it('beginnt die Freigabe mit dem Tempo des Fingers', () => {
    const { samples: s, releaseTime } = samples(280, -1.5);
    const { opens, motion } = releaseGesture(s, releaseTime, -30, WIDTH);
    expect(opens).toBe(false);
    expect(motion).toBe('198ms cubic-bezier(0.333, 0.367, 0.667, 0.733)');
    expect(initialSpeed(motion, 270)).toBeCloseTo(1.5, 2);
  });

  it('übernimmt auch schnelle und kurze Würfe ohne Sprung im Tempo', () => {
    for (const [speed, offset] of [[3, -150], [0.8, -60], [6, -20]] as const) {
      const { samples: s, releaseTime } = samples(100, speed);
      const { opens, motion } = releaseGesture(s, releaseTime, offset, WIDTH);
      expect(opens).toBe(true);
      expect(initialSpeed(motion, -offset)).toBeCloseTo(speed, 1);
      // Steiler als 1 würde die Kurve über das Ziel hinausschießen.
      expect(parse(motion).y1).toBeLessThanOrEqual(1);
    }
  });

  it('beginnt aus dem Stand, wenn der Finger stillstand oder vom Ziel wegzog', () => {
    const resting = releaseGesture([{ x: 200, time: 0 }], 300, -80, WIDTH);
    expect(resting).toEqual({ opens: true, motion: '90ms cubic-bezier(0.333, 0, 0.667, 1)' });

    const away = samples(200, -0.2);
    const backwards = releaseGesture(away.samples, away.releaseTime, -40, WIDTH);
    expect(backwards.opens).toBe(true);
    expect(parse(backwards.motion).y1).toBe(0);
  });

  it('dauert ohne Wurf anteilig zur Reststrecke, mindestens 90 ms', () => {
    expect(parse(releaseGesture([], 0, -140, WIDTH).motion).duration).toBe(103);
    expect(parse(releaseGesture([], 0, -160, WIDTH).motion).duration).toBe(103);
    expect(parse(releaseGesture([], 0, -10, WIDTH).motion).duration).toBe(90);
  });

  it('setzt keine Freigabe, wenn keine Strecke mehr bleibt', () => {
    expect(releaseGesture([], 0, 0, WIDTH)).toEqual({ opens: true, motion: null });
    expect(releaseGesture([], 0, -WIDTH, WIDTH)).toEqual({ opens: false, motion: null });
  });
});
