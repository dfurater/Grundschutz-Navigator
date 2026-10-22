import { createProfileAnalysisHandler, handleProfileWorkbenchRequest } from '@/workers/profileWorkbenchRequests';

/*
 * Modul-Worker des Bereichs Informationsverbünde (GSPP-292, GSPP-609): leitet
 * die Verbundansicht oder die Analyse eines Profil-Arbeitsstands ab oder prüft
 * und serialisiert einen Profil- oder SSP-Export. Alle brauchen die Schemastufe (Ajv),
 * die im Main Thread unter der CSP nicht kompiliert. Sein einziger Netzbezug ist
 * der Schema-Chunk derselben Origin; er löst keine Dokumentverweise auf, führt
 * keine Speicher- oder Dateioperation aus. Analyse-Sitzungen verwenden ihn wieder;
 * die übrigen Anfragearten beantworten genau eine Anfrage.
 */

let started = false;
let session = false;
let busy = false;
const analyze = createProfileAnalysisHandler();

globalThis.addEventListener('message', (event: MessageEvent) => {
  // Dedicated-Worker-Nachrichten stammen ausschließlich vom erzeugenden Dokument.
  if (event.origin !== '' && event.origin !== globalThis.location.origin) {
    globalThis.postMessage({ type: 'failure' });
    return;
  }
  const data = event.data;
  const isSession = data?.type === 'analyze-session';
  const failure = { type: 'failure', ...(isSession ? { requestId: data.requestId } : {}) };
  if (busy || (started && (!session || !isSession))) {
    globalThis.postMessage(failure);
    return;
  }
  started = true;
  session = isSession;
  busy = true;
  void (session ? analyze(data) : handleProfileWorkbenchRequest(data))
    .then((frame) => { busy = false; globalThis.postMessage(frame); })
    .catch(() => { busy = false; globalThis.postMessage(failure); });
});
