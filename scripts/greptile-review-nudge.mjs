#!/usr/bin/env node

/*
 * Erzwingt Greptiles Auslösung, wenn Greptile einen Pull Request übersprungen
 * hat und dadurch der required check `Greptile Review` ausbleibt (GSPP-401).
 *
 * Ausgangslage: Greptile wendet vor der Auslösung anbieterseitige
 * Ignore-Patterns an. Bleibt danach keine Datei übrig — der Regelfall bei
 * einem Pull Request, der nur `package-lock.json` ändert — legt Greptile
 * weder Review-Lauf noch Check-Run an und postet stattdessen einen
 * Statuskommentar. Weil `Greptile Review` auf `develop` und `main` required
 * ist, steht der Pull Request damit dauerhaft auf `BLOCKED`, obwohl kein
 * einziger Check rot ist.
 *
 * Gemessen am 2026-09-14 auf PR #232: Eine Erwähnung überstimmt den Skip.
 * Greptile legt den fehlenden Merge-Request-Datensatz an, startet den Review
 * auf demselben Head und erzeugt den Check-Run — und reviewt dabei genau die
 * Datei, die es zuvor als nicht reviewbar geführt hatte. Der Ignore-Filter
 * greift also in der Auslösestufe, nicht in der Reviewstufe. Dieser Guard
 * täuscht deshalb keine Reviewabdeckung vor, sondern stellt die ausgefallene
 * her; ein selbstgebauter Check gleichen Namens täte das Gegenteil.
 *
 * Die Auslösebedingung ist bewusst nicht der englische Kommentartext
 * ("No reviewable files after applying ignore patterns."), sondern der
 * Zustand, der den Merge tatsächlich blockiert: Auf dem Head-SHA fehlt ein
 * Check-Run namens `Greptile Review`. Der Anbieter kann seinen Text jederzeit
 * umformulieren, ohne dass dieser Guard davon berührt wird.
 *
 * Fail-closed in Richtung Ruhe: Ist eine Bedingung nicht belegbar, wird nicht
 * erwähnt. Eine ausgebliebene Erwähnung kostet einen manuellen Kommentar, eine
 * fälschliche kostet einen Reviewlauf auf fremdem Anlass.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Autor des Statuskommentars, auf den dieser Guard reagiert. */
export const GREPTILE_APP_LOGIN = 'greptile-apps[bot]';

/** Name des required status check, dessen Ausbleiben den Guard auslöst. */
export const GREPTILE_CHECK_NAME = 'Greptile Review';

/** Erwähnung, die Greptile zur Auslösung bewegt. */
export const NUDGE_MENTION = '@greptileai review';

/**
 * Unsichtbarer Marker, mit dem der Guard seine eigene frühere Erwähnung
 * wiedererkennt. Er trägt den Head-SHA, damit ein neuer Push erneut erwähnt
 * wird, derselbe Head aber genau einmal.
 */
export function nudgeMarker(headSha) {
  return `<!-- greptile-review-nudge: ${headSha} -->`;
}

export function nudgeBody(headSha) {
  return `${NUDGE_MENTION}\n\n${nudgeMarker(headSha)}`;
}

export class GreptileNudgeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GreptileNudgeError';
  }
}

/** `owner/repo` in der von GitHub zugelassenen Zeichenmenge. */
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Vollständiger, kleingeschriebener Commit-SHA. */
const SHA_PATTERN = /^[0-9a-f]{40}$/;

const UNTRUSTED_TEXT_LIMIT = 80;

/*
 * Jeder in eine Meldung übernommene Wert stammt aus dem Ereignis und ist damit
 * von außen beeinflussbar. Ein Zeilenumbruch darin ließe eine gefälschte
 * Logzeile entstehen, die wie eine eigene Meldung des Guards aussieht; ein
 * überlanger Wert ersetzte die Meldung. Steuer- und Formatzeichen werden
 * deshalb zu Leerzeichen, und die Länge ist begrenzt.
 */
export function forMessage(value) {
  if (typeof value !== 'string') {
    return 'unbekannt';
  }

  const collapsed = value.replaceAll(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replaceAll(/\s+/gu, ' ').trim();
  if (collapsed.length === 0) {
    return 'unbekannt';
  }

  return collapsed.length > UNTRUSTED_TEXT_LIMIT
    ? `${collapsed.slice(0, UNTRUSTED_TEXT_LIMIT)}…`
    : collapsed;
}

/**
 * Entscheidet ohne Seiteneffekt, ob erwähnt wird.
 *
 * @param {object} input
 * @param {object} input.event `issue_comment`-Ereignis, wie GitHub es liefert.
 * @param {string} input.headSha Head-SHA des Pull Requests.
 * @param {Array<{name?: string}>} input.checkRuns Check-Runs auf diesem Head.
 * @param {Array<{body?: string}>} input.comments Bestehende Kommentare.
 * @returns {{ nudge: boolean, reason: string }}
 */
export function decideNudge({ event, headSha, checkRuns, comments }) {
  const issue = event?.issue;

  if (!issue?.pull_request) {
    return { nudge: false, reason: 'Der Kommentar hängt an einem Issue, nicht an einem Pull Request.' };
  }

  if (issue.state !== 'open') {
    return { nudge: false, reason: `Der Pull Request ist nicht offen (state=${forMessage(issue.state)}).` };
  }

  const author = event?.comment?.user?.login;
  if (author !== GREPTILE_APP_LOGIN) {
    return { nudge: false, reason: `Der Kommentar stammt von ${forMessage(author)}, nicht von ${GREPTILE_APP_LOGIN}.` };
  }

  /*
   * Jeder Status zählt als vorhanden, auch `queued` und `in_progress`. Ein
   * laufender Review braucht keine zweite Auslösung, und ein bereits
   * fehlgeschlagener ist ein echter Befund, der durch eine Wiederholung nicht
   * besser wird.
   */
  if (checkRuns.some((run) => run?.name === GREPTILE_CHECK_NAME)) {
    return { nudge: false, reason: `Auf ${forMessage(headSha)} existiert bereits ein Check-Run namens ${GREPTILE_CHECK_NAME}.` };
  }

  const marker = nudgeMarker(headSha);
  if (comments.some((comment) => typeof comment?.body === 'string' && comment.body.includes(marker))) {
    return { nudge: false, reason: `Für ${forMessage(headSha)} wurde bereits erwähnt.` };
  }

  return { nudge: true, reason: `Auf ${forMessage(headSha)} fehlt der Check-Run ${GREPTILE_CHECK_NAME}.` };
}

async function fetchGitHubJson(url, { fetchImpl, token, label }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw new GreptileNudgeError(`${label} fehlgeschlagen: ${error instanceof Error ? error.message : 'Netzwerkfehler'}`);
  }

  if (!response.ok) {
    throw new GreptileNudgeError(`${label} fehlgeschlagen mit HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new GreptileNudgeError(`${label} lieferte ungültiges JSON`);
  }
}

async function postComment(url, body, { fetchImpl, token }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ body }),
    });
  } catch (error) {
    throw new GreptileNudgeError(`Erwähnung fehlgeschlagen: ${error instanceof Error ? error.message : 'Netzwerkfehler'}`);
  }

  if (!response.ok) {
    throw new GreptileNudgeError(`Erwähnung fehlgeschlagen mit HTTP ${response.status}`);
  }
}

/**
 * Liest den Zustand, entscheidet und erwähnt gegebenenfalls.
 *
 * @returns {Promise<{ nudge: boolean, reason: string }>}
 */
export async function runNudge({ event, repository, token, fetchImpl = fetch }) {
  /*
   * Ereignis und Umgebung liefern die Bausteine jeder URL. Sie werden deshalb
   * gegen ihre erlaubte Form geprüft, bevor sie in einen Endpunkt eingesetzt
   * werden — sonst trüge ein manipulierter Wert die Anfrage auf einen anderen
   * Pfad oder eine andere Herkunft.
   */
  const issueNumber = event?.issue?.number;
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new GreptileNudgeError('Das Ereignis trägt keine gültige Issue-Nummer.');
  }

  if (typeof repository !== 'string' || !REPOSITORY_PATTERN.test(repository)) {
    throw new GreptileNudgeError('GITHUB_REPOSITORY hat nicht die Form owner/repo.');
  }

  const apiBase = `https://api.github.com/repos/${repository}`;

  /*
   * Der Head-SHA steht nicht im `issue_comment`-Ereignis — es trägt nur den
   * Issue-Teil des Pull Requests. Er wird deshalb frisch gelesen, was
   * zusätzlich sicherstellt, dass gegen den aktuellen Head geprüft wird und
   * nicht gegen einen inzwischen überholten.
   */
  const pullRequest = await fetchGitHubJson(`${apiBase}/pulls/${issueNumber}`, {
    fetchImpl,
    token,
    label: 'Pull-Request-Abruf',
  });

  const headSha = pullRequest?.head?.sha;
  if (typeof headSha !== 'string' || !SHA_PATTERN.test(headSha)) {
    throw new GreptileNudgeError(`Pull Request #${issueNumber} liefert keinen gültigen Head-SHA.`);
  }

  const checks = await fetchGitHubJson(`${apiBase}/commits/${headSha}/check-runs?per_page=100`, {
    fetchImpl,
    token,
    label: 'Check-Run-Abruf',
  });

  /*
   * Absteigend sortiert, weil nur der eigene Marker gesucht wird und der
   * jüngste Kommentar ist. Die Vorgabe der API wäre aufsteigend; bei einem
   * Pull Request mit mehr als hundert Kommentaren läge der Marker dann
   * jenseits der ersten Seite und der Guard erwähnte ein zweites Mal.
   */
  const comments = await fetchGitHubJson(
    `${apiBase}/issues/${issueNumber}/comments?per_page=100&sort=created&direction=desc`,
    {
      fetchImpl,
      token,
      label: 'Kommentarabruf',
    },
  );

  const decision = decideNudge({
    event,
    headSha,
    checkRuns: Array.isArray(checks?.check_runs) ? checks.check_runs : [],
    comments: Array.isArray(comments) ? comments : [],
  });

  if (decision.nudge) {
    await postComment(`${apiBase}/issues/${issueNumber}/comments`, nudgeBody(headSha), { fetchImpl, token });
  }

  return decision;
}

export function readEvent(path) {
  if (!path) {
    throw new GreptileNudgeError('GITHUB_EVENT_PATH ist nicht gesetzt.');
  }

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new GreptileNudgeError(`${path} ist nicht lesbar.`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GreptileNudgeError(`${path} ist kein gültiges JSON: ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GreptileNudgeError('Weder GH_TOKEN noch GITHUB_TOKEN ist gesetzt.');
  }

  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new GreptileNudgeError('GITHUB_REPOSITORY ist nicht gesetzt.');
  }

  const decision = await runNudge({
    event: readEvent(process.env.GITHUB_EVENT_PATH),
    repository,
    token,
  });

  /*
   * Die Begründung ist bereits feldweise entschärft; der zweite Durchlauf
   * hier hält die Zusicherung auch dann, wenn später ein Zweig hinzukommt,
   * der einen Ereigniswert ungefiltert übernimmt.
   */
  const reason = forMessage(decision.reason);
  console.log(decision.nudge ? `Erwähnung gesetzt: ${reason}` : `Keine Erwähnung: ${reason}`);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Greptile-Erwähnung fehlgeschlagen.');
    process.exitCode = 1;
  }
}
