/*
 * Geprüfte Ausgabewerte für die Deploy-Skripte `check-deploy-idempotency.mjs`
 * und `verify-catalog-deploy.mjs`.
 *
 * GitHub-API-Antworten sind keine Log-Eingabe (CWE-117): Ein Zeilenumbruch in
 * einem Antwortfeld würde im Actions-Log eine eigene Zeile und damit ein
 * Runner-Kommando wie `::error::` erzeugen. Jede Funktion gibt deshalb nur
 * einen Wert aus einer engen Positivmenge oder den festen Ersatz `unbekannt`
 * zurück und wirft nie. Fachliche Entscheidungen bleiben bei den Rohwerten.
 */

export const UNKNOWN_DISPLAY_VALUE = 'unbekannt';

/** `owner/repo` in der von GitHub zugelassenen Zeichenmenge (vgl. greptile-review-nudge). */
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const STATE_PATTERN = /^[a-z_]+$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * @param {unknown} repository
 * @returns {boolean} wahr für `owner/repo` ohne `.`/`..` als Pfadteil.
 */
export function isValidRepository(repository) {
  if (typeof repository !== 'string' || !REPOSITORY_PATTERN.test(repository)) {
    return false;
  }
  return repository.split('/').every((part) => part !== '.' && part !== '..');
}

/** Positive sichere Ganzzahl als Text, sonst `unbekannt`. */
export function displayRunId(runId) {
  return Number.isSafeInteger(runId) && runId > 0 ? String(runId) : UNKNOWN_DISPLAY_VALUE;
}

/**
 * Run-Adresse aus geprüftem Repository und geprüfter ID; `html_url` der
 * API-Antwort wird nie übernommen. Bei ungültigem Repository bleibt nur die ID.
 */
export function displayRunUrl(repository, runId) {
  const id = displayRunId(runId);
  if (id === UNKNOWN_DISPLAY_VALUE || !isValidRepository(repository)) {
    return id;
  }
  return `https://github.com/${repository}/actions/runs/${id}`;
}

/** `status`/`conclusion`-Werte wie `completed` oder `in_progress`, sonst `unbekannt`. */
export function displayState(value) {
  return typeof value === 'string' && STATE_PATTERN.test(value) ? value : UNKNOWN_DISPLAY_VALUE;
}

/** Vollständiger SHA aus 40 kleingeschriebenen Hexzeichen, sonst `unbekannt`. */
export function displaySha(value) {
  return typeof value === 'string' && FULL_SHA_PATTERN.test(value) ? value : UNKNOWN_DISPLAY_VALUE;
}
