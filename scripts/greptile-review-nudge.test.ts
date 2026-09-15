import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  GREPTILE_APP_LOGIN,
  GREPTILE_CHECK_NAME,
  GreptileNudgeError,
  NUDGE_MENTION,
  decideNudge,
  forMessage,
  nudgeBody,
  nudgeMarker,
  readEvent,
  runNudge,
} from './greptile-review-nudge.mjs';

const HEAD_SHA = 'fc5f266ed0af947ce844940ce682f7e71fb09e75';
const OTHER_SHA = '5c649ab83731d5b66448e99945b818bba2ea52b4';
const REPOSITORY = 'dfurater/Grundschutz-Navigator';

function greptileEvent(overrides: Record<string, unknown> = {}) {
  return {
    issue: { number: 232, state: 'open', pull_request: { url: 'https://api.github.com/…/pulls/232' } },
    comment: { user: { login: GREPTILE_APP_LOGIN }, body: 'No reviewable files after applying ignore patterns.' },
    ...overrides,
  };
}

function decisionFor(overrides: {
  event?: unknown;
  checkRuns?: Array<{ name?: string }>;
  comments?: Array<{ body?: string }>;
} = {}) {
  return decideNudge({
    event: overrides.event ?? greptileEvent(),
    headSha: HEAD_SHA,
    checkRuns: overrides.checkRuns ?? [{ name: 'validate' }, { name: 'Gitar' }],
    comments: overrides.comments ?? [],
  });
}

describe('decideNudge', () => {
  it('erwähnt, wenn der Check-Run auf dem Head fehlt', () => {
    const decision = decisionFor();

    expect(decision.nudge).toBe(true);
    expect(decision.reason).toContain(GREPTILE_CHECK_NAME);
    expect(decision.reason).toContain(HEAD_SHA);
  });

  it('erwähnt nicht bei einem Kommentar an einem Issue statt an einem Pull Request', () => {
    const decision = decisionFor({ event: { ...greptileEvent(), issue: { number: 7, state: 'open' } } });

    expect(decision.nudge).toBe(false);
    expect(decision.reason).toContain('Issue');
  });

  it('erwähnt nicht auf einem geschlossenen Pull Request', () => {
    const event = greptileEvent({
      issue: { number: 228, state: 'closed', pull_request: { url: 'https://api.github.com/…/pulls/228' } },
    });

    const decision = decisionFor({ event });

    expect(decision.nudge).toBe(false);
    expect(decision.reason).toContain('closed');
  });

  it('erwähnt nicht bei einem Kommentar eines anderen Autors', () => {
    const event = greptileEvent({ comment: { user: { login: 'gitar-bot[bot]' } } });

    const decision = decisionFor({ event });

    expect(decision.nudge).toBe(false);
    expect(decision.reason).toContain('gitar-bot[bot]');
  });

  it('erwähnt nicht, wenn ein fehlender Autor nicht belegbar ist', () => {
    const decision = decisionFor({ event: greptileEvent({ comment: {} }) });

    expect(decision.nudge).toBe(false);
    expect(decision.reason).toContain('unbekannt');
  });

  /*
   * Jeder Status zählt als vorhanden. Ein laufender Review braucht keine
   * zweite Auslösung, ein fehlgeschlagener ist ein echter Befund.
   */
  it.each(['queued', 'in_progress', 'completed'])(
    'erwähnt nicht, wenn der Check-Run bereits existiert (%s)',
    (status) => {
      const decision = decisionFor({
        checkRuns: [{ name: 'validate' }, { name: GREPTILE_CHECK_NAME, status } as { name: string }],
      });

      expect(decision.nudge).toBe(false);
      expect(decision.reason).toContain('existiert bereits');
    },
  );

  it('erwähnt nicht zweimal für denselben Head', () => {
    const decision = decisionFor({ comments: [{ body: nudgeBody(HEAD_SHA) }] });

    expect(decision.nudge).toBe(false);
    expect(decision.reason).toContain('bereits erwähnt');
  });

  it('erwähnt erneut, wenn der frühere Marker zu einem anderen Head gehört', () => {
    const decision = decisionFor({ comments: [{ body: nudgeBody(OTHER_SHA) }] });

    expect(decision.nudge).toBe(true);
  });

  it('übersteht Kommentare ohne Textkörper', () => {
    const decision = decisionFor({ comments: [{}, { body: undefined }] });

    expect(decision.nudge).toBe(true);
  });
});

/*
 * Werte aus dem Ereignis erreichen die Ausgabe. Ein Zeilenumbruch darin ließe
 * eine gefälschte Logzeile entstehen, ein überlanger Wert ersetzte die Meldung.
 */
describe('forMessage', () => {
  it('lässt einen harmlosen Wert unverändert', () => {
    expect(forMessage('greptile-apps[bot]')).toBe('greptile-apps[bot]');
  });

  it.each([
    ['a\nERROR: gefälscht', 'a ERROR: gefälscht'],
    ['a\r\nb', 'a b'],
    ['a\u0000b', 'a b'],
    ['a\u2028b', 'a b'],
    ['a\u200bb', 'a b'],
  ])('ersetzt Steuer- und Formatzeichen (%j)', (input, expected) => {
    expect(forMessage(input)).toBe(expected);
  });

  it('begrenzt die Länge', () => {
    const long = 'x'.repeat(200);

    expect(forMessage(long)).toBe(`${'x'.repeat(80)}…`);
  });

  it.each([undefined, null, 42, {}, '', '   '])('ersetzt einen unbrauchbaren Wert durch "unbekannt" (%s)', (value) => {
    expect(forMessage(value)).toBe('unbekannt');
  });

  it('entschärft einen Autorennamen, der eine Logzeile vortäuscht', () => {
    const event = greptileEvent({ comment: { user: { login: 'böse\nErwähnung gesetzt: alles gut' } } });

    const decision = decisionFor({ event });

    expect(decision.nudge).toBe(false);
    expect(decision.reason).not.toContain('\n');
  });
});

describe('nudgeBody', () => {
  it('trägt die Erwähnung und den head-gebundenen Marker', () => {
    const body = nudgeBody(HEAD_SHA);

    expect(body.startsWith(NUDGE_MENTION)).toBe(true);
    expect(body).toContain(nudgeMarker(HEAD_SHA));
    expect(nudgeMarker(HEAD_SHA)).not.toBe(nudgeMarker(OTHER_SHA));
  });
});

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

function stubFetch(responses: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];

  const fetchImpl = vi.fn(async (url: string, init?: Record<string, unknown>) => {
    calls.push({ url, init });

    const match = Object.keys(responses).find((key) => url.includes(key));
    if (!match) {
      throw new Error(`Unerwarteter Abruf: ${url}`);
    }

    const payload = responses[match];
    return typeof payload === 'function' ? (payload as () => unknown)() : payload;
  });

  return { fetchImpl, calls };
}

const PULL_REQUEST_OK = jsonResponse({ head: { sha: HEAD_SHA } });

describe('runNudge', () => {
  it('setzt die Erwähnung auf dem Kommentarendpunkt des Pull Requests', async () => {
    const { fetchImpl, calls } = stubFetch({
      '/pulls/232': PULL_REQUEST_OK,
      '/check-runs': jsonResponse({ check_runs: [{ name: 'validate' }] }),
      '/issues/232/comments': jsonResponse([]),
    });

    const decision = await runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl });

    expect(decision.nudge).toBe(true);

    const post = calls.find((call) => call.init?.method === 'POST');
    expect(post?.url).toBe(`https://api.github.com/repos/${REPOSITORY}/issues/232/comments`);
    expect(JSON.parse(String(post?.init?.body))).toEqual({ body: nudgeBody(HEAD_SHA) });
  });

  it('prüft die Check-Runs gegen den frisch gelesenen Head, nicht gegen das Ereignis', async () => {
    const { fetchImpl, calls } = stubFetch({
      '/pulls/232': PULL_REQUEST_OK,
      '/check-runs': jsonResponse({ check_runs: [] }),
      '/issues/232/comments': jsonResponse([]),
    });

    await runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl });

    expect(calls.some((call) => call.url.includes(`/commits/${HEAD_SHA}/check-runs`))).toBe(true);
  });

  it('erwähnt nicht, wenn der Check-Run bereits existiert', async () => {
    const { fetchImpl, calls } = stubFetch({
      '/pulls/232': PULL_REQUEST_OK,
      '/check-runs': jsonResponse({ check_runs: [{ name: GREPTILE_CHECK_NAME }] }),
      '/issues/232/comments': jsonResponse([]),
    });

    const decision = await runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl });

    expect(decision.nudge).toBe(false);
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('liest die Kommentare absteigend, damit der eigene Marker auf der ersten Seite liegt', async () => {
    const { fetchImpl, calls } = stubFetch({
      '/pulls/232': PULL_REQUEST_OK,
      '/check-runs': jsonResponse({ check_runs: [] }),
      '/issues/232/comments': jsonResponse([]),
    });

    await runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl });

    const read = calls.find((call) => call.url.includes('/issues/232/comments') && call.init?.method !== 'POST');
    expect(read?.url).toContain('direction=desc');
  });

  /*
   * Ein HTTP 200 mit unerwartetem Textkörper ist ein unbekannter Zustand. Als
   * leere Liste gelesen ergäbe er "kein Check-Run, kein Marker" und damit eine
   * Erwähnung — das Gegenteil der Fail-closed-Zusage.
   */
  it.each([
    ['Check-Run-Antwort', { check_runs: null }],
    ['Check-Run-Antwort ohne Feld', {}],
    ['Check-Run-Antwort als Objekt', { check_runs: { 0: { name: 'validate' } } }],
  ])('bricht bei unerwartet geformter %s ab, statt zu erwähnen', async (_label, payload) => {
    const { fetchImpl, calls } = stubFetch({
      '/pulls/232': PULL_REQUEST_OK,
      '/check-runs': jsonResponse(payload),
      '/issues/232/comments': jsonResponse([]),
    });

    await expect(runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl }))
      .rejects.toThrow('Check-Run-Antwort hat nicht die erwartete Listenform');
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it.each([null, { comments: [] }, 'kein JSON-Array'])(
    'bricht bei unerwartet geformter Kommentarantwort ab, statt zu erwähnen (%j)',
    async (payload) => {
      const { fetchImpl, calls } = stubFetch({
        '/pulls/232': PULL_REQUEST_OK,
        '/check-runs': jsonResponse({ check_runs: [] }),
        '/issues/232/comments': jsonResponse(payload),
      });

      await expect(runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl }))
        .rejects.toThrow('Kommentarantwort hat nicht die erwartete Listenform');
      expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
    },
  );

  it('meldet einen fehlenden Head-SHA als Fehler', async () => {
    const { fetchImpl } = stubFetch({ '/pulls/232': jsonResponse({ head: {} }) });

    await expect(runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl }))
      .rejects.toThrow(GreptileNudgeError);
  });

  it.each([undefined, 0, -3, 1.5, '232'])('meldet eine ungültige Issue-Nummer als Fehler (%s)', async (number) => {
    const { fetchImpl } = stubFetch({});

    await expect(runNudge({ event: { issue: { number } }, repository: REPOSITORY, token: 'x', fetchImpl }))
      .rejects.toThrow('keine gültige Issue-Nummer');
  });

  /*
   * Ereignis und Umgebung liefern die Bausteine jeder URL. Ein Wert, der die
   * erlaubte Form verlässt, muss die Anfrage verhindern statt sie auf einen
   * anderen Pfad oder eine andere Herkunft zu tragen.
   */
  it.each(['../../evil', 'owner', 'owner/repo/extra', 'owner/re po', 'https://evil.test/a/b', ''])(
    'weist ein GITHUB_REPOSITORY ausserhalb von owner/repo ab (%s)',
    async (repository) => {
      const { fetchImpl } = stubFetch({});

      await expect(runNudge({ event: greptileEvent(), repository, token: 'x', fetchImpl }))
        .rejects.toThrow('owner/repo');
    },
  );

  it.each(['', 'nicht-hex', HEAD_SHA.toUpperCase(), HEAD_SHA.slice(0, 39), `${HEAD_SHA}0`])(
    'weist einen Head-SHA ausserhalb der Vollform ab (%s)',
    async (sha) => {
      const { fetchImpl } = stubFetch({ '/pulls/232': jsonResponse({ head: { sha } }) });

      await expect(runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl }))
        .rejects.toThrow('keinen gültigen Head-SHA');
    },
  );

  it('meldet eine fehlgeschlagene Antwort mit ihrem Status', async () => {
    const { fetchImpl } = stubFetch({ '/pulls/232': jsonResponse(null, false, 404) });

    await expect(runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl }))
      .rejects.toThrow('HTTP 404');
  });

  it('meldet einen fehlgeschlagenen Kommentar-POST', async () => {
    const { fetchImpl } = stubFetch({
      '/pulls/232': PULL_REQUEST_OK,
      '/check-runs': jsonResponse({ check_runs: [] }),
      '/issues/232/comments': () => jsonResponse(null, false, 403),
    });

    await expect(runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl }))
      .rejects.toThrow('HTTP 403');
  });

  it('meldet einen Netzwerkfehler als Fehler statt ihn zu verschlucken', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });

    await expect(runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl }))
      .rejects.toThrow('ECONNRESET');
  });

  it('meldet ungültiges JSON als Fehler', async () => {
    const { fetchImpl } = stubFetch({
      '/pulls/232': {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('unexpected token');
        },
      },
    });

    await expect(runNudge({ event: greptileEvent(), repository: REPOSITORY, token: 'x', fetchImpl }))
      .rejects.toThrow('ungültiges JSON');
  });
});

describe('readEvent', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'greptile-nudge-'));

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('liest das Ereignis aus der Datei', () => {
    const path = resolve(scratch, 'event.json');
    writeFileSync(path, JSON.stringify(greptileEvent()), 'utf8');

    expect(readEvent(path)).toMatchObject({ issue: { number: 232 } });
  });

  it('meldet einen fehlenden Pfad', () => {
    expect(() => readEvent(undefined)).toThrow('GITHUB_EVENT_PATH');
  });

  it('meldet eine nicht lesbare Datei', () => {
    expect(() => readEvent(resolve(scratch, 'fehlt.json'))).toThrow('nicht lesbar');
  });

  it('meldet ungültiges JSON', () => {
    const path = resolve(scratch, 'kaputt.json');
    writeFileSync(path, '{', 'utf8');

    expect(() => readEvent(path)).toThrow('kein gültiges JSON');
  });
});
