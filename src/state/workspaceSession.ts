/**
 * Koordiniert Arbeitsbereich-Sitzungen mehrerer Tabs über Web Locks (docs/PERSISTENCE.md §12).
 * Jede Sitzung hält einen eigenen Anwesenheits-Lock; Registrierung und exklusive Datenaktion
 * laufen über denselben Tor-Lock. Die Lock-Namen tragen nur eine zufällige Sitzungskennung.
 */
export const WORKSPACE_GATE_LOCK = 'gspp-workspace-gate';
export const WORKSPACE_SESSION_LOCK_PREFIX = 'gspp-workspace-session-';

export type ExclusiveEntry =
  /** Keine andere Sitzung; bis `release` kann sich keine neue registrieren. */
  | { readonly status: 'granted'; readonly release: () => void }
  | { readonly status: 'other-sessions' }
  /** Web Locks fehlen oder die Prüfung ist gescheitert; die Aktion bleibt gesperrt. */
  | { readonly status: 'unavailable' };

export interface WorkspaceSession {
  /** Meldet die Sitzung an; wartet, solange eine andere Sitzung die exklusive Datenaktion hält. */
  readonly register: () => Promise<boolean>;
  readonly enterExclusive: () => Promise<ExclusiveEntry>;
  /** Beendet die Anwesenheit dieser Sitzung. */
  readonly leave: () => void;
}

type Release = () => void;

/** Hält den Lock bis zum Aufruf der Freigabe; `null`, wenn `ifAvailable` ihn nicht erhält. */
function hold(locks: LockManager, name: string, options: LockOptions = {}): Promise<Release | null> {
  return new Promise((resolve, reject) => {
    locks.request(name, options, (lock) => {
      if (!lock) { resolve(null); return undefined; }
      return new Promise<void>((release) => resolve(release));
    }).catch(reject);
  });
}

export function createWorkspaceSession(locks: LockManager | undefined = globalThis.navigator?.locks): WorkspaceSession {
  const name = `${WORKSPACE_SESSION_LOCK_PREFIX}${crypto.randomUUID()}`;
  let presence: Release | null = null;
  let registering: Promise<boolean> | null = null;
  // Zählt jedes Verlassen: Eine davor begonnene Anmeldung gibt ihren später erhaltenen Lock sofort frei.
  let left = 0;
  return {
    register: () => {
      if (!locks) return Promise.resolve(false);
      registering ??= (async () => {
        const run = left;
        try {
          const gate = await hold(locks, WORKSPACE_GATE_LOCK);
          try {
            const granted = await hold(locks, name);
            if (run === left) presence = granted;
            else granted?.();
          } finally { gate?.(); }
          return run === left;
        } catch {
          registering = null;
          return false;
        }
      })();
      return registering;
    },
    enterExclusive: async () => {
      if (!locks || !presence) return { status: 'unavailable' };
      let gate: Release | null = null;
      try {
        // Ein besetztes Tor heißt: Eine andere Sitzung meldet sich gerade an oder hält selbst die Datenaktion.
        gate = await hold(locks, WORKSPACE_GATE_LOCK, { ifAvailable: true });
        if (!gate) return { status: 'other-sessions' };
        // Unter dem Tor kann keine Sitzung hinzukommen; der Schnappschuss ist deshalb belastbar.
        const { held = [], pending = [] } = await locks.query();
        if ([...held, ...pending].some((lock) => lock.name?.startsWith(WORKSPACE_SESSION_LOCK_PREFIX) && lock.name !== name)) {
          gate();
          return { status: 'other-sessions' };
        }
        return { status: 'granted', release: gate };
      } catch {
        gate?.();
        return { status: 'unavailable' };
      }
    },
    leave: () => {
      left++;
      presence?.();
      presence = null;
      registering = null;
    },
  };
}
