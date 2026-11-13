// Sitzungskoordination der Gesamtlöschung mit echten Web Locks (GSPP-635). Jeder iframe gleicher
// Origin ist ein eigener Lock-Client wie ein weiterer Tab; sein Entfernen gibt seine Locks frei.
import { afterEach, expect, test } from 'vitest';
import { createWorkspaceSession, type ExclusiveEntry, type WorkspaceSession } from '@/state/workspaceSession';

const frames: HTMLIFrameElement[] = [];
const sessions: WorkspaceSession[] = [];

function otherTab(): { session: WorkspaceSession; close: () => void } {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const session = createWorkspaceSession(frame.contentWindow!.navigator.locks);
  sessions.push(session);
  return { session, close: () => frame.remove() };
}

function ownTab(): WorkspaceSession {
  const session = createWorkspaceSession();
  sessions.push(session);
  return session;
}

/** Wiederholt die Prüfung, bis der Browser die Locks des geschlossenen Tabs freigegeben hat. */
async function enterWhenAlone(session: WorkspaceSession): Promise<Extract<ExclusiveEntry, { status: 'granted' }>> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const entry = await session.enterExclusive();
    if (entry.status === 'granted') return entry;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Die exklusive Datenaktion wurde nicht frei.');
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.leave();
  for (const frame of frames.splice(0)) frame.remove();
});

test('ein weiterer offener Tab sperrt die Datenaktion; sein Schließen gibt sie frei', async () => {
  const own = ownTab();
  const second = otherTab();
  expect(await own.register()).toBe(true);
  expect(await second.session.register()).toBe(true);
  expect(await own.enterExclusive()).toEqual({ status: 'other-sessions' });
  second.close();
  const entry = await enterWhenAlone(own);
  entry.release();
});

test('ein während der Datenaktion nachrückender Tab meldet sich erst nach deren Ende an und sperrt dann erneut', async () => {
  const own = ownTab();
  await own.register();
  const entry = await enterWhenAlone(own);
  const third = otherTab();
  let registered = false;
  const late = third.session.register().then((result) => { registered = result; });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(registered).toBe(false);
  // Auch eine zweite Datenaktion aus dem wartenden Tab kommt nicht zum Zug.
  expect(await third.session.enterExclusive()).toEqual({ status: 'unavailable' });
  entry.release();
  await late;
  expect(registered).toBe(true);
  expect(await own.enterExclusive()).toEqual({ status: 'other-sessions' });
});
