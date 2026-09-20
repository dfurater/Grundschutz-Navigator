/*
 * Gemeinsamer Kern des GitHub-JSON-Abrufs der fail-closed CI-Guards (GSPP-425).
 *
 * `catalog-sync-guard.mjs` und `verify-catalog-deploy.mjs` führten je eine
 * eigene, deckungsgleiche Kopie dieser Funktion; zwei identisch geänderte
 * Zeilen kippten damit die Sonar-Duplikatsmessung für neuen Code. Der Kern
 * steht deshalb genau einmal hier. Guardspezifische Vorprüfungen — etwa die
 * Allowlist in `verify-catalog-deploy.mjs` — bleiben bewusst beim Aufrufer.
 *
 * Fail-closed wie bisher: Jeder Request trägt eine Abbruchfrist
 * (`AbortSignal.timeout`), Netzwerkfehler behalten ihre Ursache (`cause`),
 * und eine Antwort ohne `ok` oder ohne parsebares JSON wird als Fehler
 * gemeldet statt stillschweigend hingenommen.
 */

/**
 * Holt JSON von der GitHub-API.
 *
 * @param {string} url Vollständige API-URL.
 * @param {{ fetchImpl: typeof fetch, token?: string, label: string, requestTimeoutMs: number }} options
 * @returns {Promise<unknown>} Das parsebare JSON der Antwort.
 */
export async function fetchGitHubJson(url, { fetchImpl, token, label, requestTimeoutMs }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(requestTimeoutMs) });
  } catch (error) {
    throw new Error(`${label} failed: ${error instanceof Error ? error.message : 'network error'}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
