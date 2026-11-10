import { describe, expect, it } from 'vitest';
import { createWorkspaceSession } from '@/state/workspaceSession';
import { fakeLocks } from '@/test/fakeLocks';

describe('Arbeitsbereich-Sitzungen', () => {
  it('gibt die exklusive Datenaktion nur ohne weitere Sitzung frei und erkennt deren Ende', async () => {
    const locks = fakeLocks();
    const own = createWorkspaceSession(locks);
    const other = createWorkspaceSession(locks);
    expect(await own.register()).toBe(true);
    expect(await other.register()).toBe(true);
    expect(await own.enterExclusive()).toEqual({ status: 'other-sessions' });
    other.leave();
    const entry = await own.enterExclusive();
    expect(entry.status).toBe('granted');
    // Eine zweite Datenaktion und eine neue Sitzung kommen erst nach der Freigabe zum Zug.
    expect(await other.enterExclusive()).toEqual({ status: 'unavailable' });
    let registered = false;
    const late = other.register().then((result) => { registered = result; });
    await Promise.resolve();
    expect(registered).toBe(false);
    if (entry.status === 'granted') entry.release();
    await late;
    expect(registered).toBe(true);
    expect(await own.enterExclusive()).toEqual({ status: 'other-sessions' });
  });

  it('sperrt die Datenaktion ohne Web Locks, ohne Anmeldung und bei gescheiterter Prüfung', async () => {
    const missing = createWorkspaceSession(undefined);
    expect(await missing.register()).toBe(false);
    expect(await missing.enterExclusive()).toEqual({ status: 'unavailable' });

    const locks = fakeLocks();
    expect(await createWorkspaceSession(locks).enterExclusive()).toEqual({ status: 'unavailable' });

    const broken = createWorkspaceSession({ ...locks, query: () => Promise.reject(new Error('query')) } as LockManager);
    await broken.register();
    expect(await broken.enterExclusive()).toEqual({ status: 'unavailable' });
    // Das Tor ist wieder frei: Eine intakte Sitzung erhält es.
    const intact = createWorkspaceSession(locks);
    await intact.register();
    broken.leave();
    expect((await intact.enterExclusive()).status).toBe('granted');
  });
});
