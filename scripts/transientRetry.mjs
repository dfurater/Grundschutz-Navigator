/*
 * Gemeinsamer transienter Abruf der Lieferkettenskripte (GSPP-359).
 *
 * `verify-upstream-oscal.mjs` und `fetch-catalog.mjs` führten je eine eigene,
 * strukturell fast identische Kopie dieser Schleife, die in drei Punkten
 * auseinandergelaufen war: Retry-Fenster, Redirect-Abbruch und
 * Injizierbarkeit des Transports. Der Kern steht deshalb genau einmal hier,
 * nach dem Muster von `githubApiFetch.mjs` (GSPP-425). Es gilt die strengere
 * Semantik des Verifikationsskripts für beide Aufrufer.
 *
 * Die Versuchszahl wird auf beiden Ausgängen herausgegeben — als `attempts`
 * neben der Antwort und als `attempts` am geworfenen Fehler —, weil nur die
 * Schleife sie kennt. Welche Diagnose daraus entsteht, entscheidet der
 * Aufrufer, der Antwort und Kontext zusammenführt.
 */

export const TRANSIENT_RETRY_DELAYS_MS = Object.freeze([1000, 3000]);

export function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isUnexpectedRedirectError(error) {
  return error?.cause?.message === 'unexpected redirect';
}

function isTransientStatus(status) {
  return status >= 500 && status <= 599;
}

/**
 * Wiederholt ausschließlich Transportfehler und HTTP 500–599 pro HTTP-Aufruf.
 *
 * Eine nicht transiente Antwort — auch ein 4xx oder ein nicht standardisierter
 * Status oberhalb 599 — wird sofort zurückgegeben, ebenso die letzte
 * transiente. Ein von Undici signalisierter unerwarteter Redirect bricht ohne
 * Wiederholung ab.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit | undefined} init
 * @param {readonly number[]} [retryDelaysMs]
 * @returns {Promise<{ response: Response, attempts: number }>}
 * @throws {Error} Mit `attempts` (1-basiert) und dem Originalfehler als `cause`.
 */
export async function fetchWithTransientRetry(
  fetchImpl,
  url,
  init,
  retryDelaysMs = TRANSIENT_RETRY_DELAYS_MS,
) {
  for (let attempt = 0; ; attempt += 1) {
    const isLastAttempt = attempt >= retryDelaysMs.length;
    try {
      const response = await fetchImpl(url, init);
      if (!isTransientStatus(response.status) || isLastAttempt) {
        return { response, attempts: attempt + 1 };
      }
    } catch (error) {
      if (isLastAttempt || isUnexpectedRedirectError(error)) {
        const failure = new Error(
          error instanceof Error ? error.message : 'fetch failed',
          { cause: error },
        );
        failure.attempts = attempt + 1;
        throw failure;
      }
    }
    await sleep(retryDelaysMs[attempt]);
  }
}
