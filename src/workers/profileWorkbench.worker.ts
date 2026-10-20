import { handleProfileWorkbenchRequest } from '@/workers/profileWorkbenchRequests';

/*
 * Modul-Worker des Bereichs Informationsverbünde (GSPP-292): leitet die
 * Verbundansicht oder die Analyse eines Profil-Arbeitsstands ab oder prüft und
 * serialisiert einen Profil-Export. Alle drei brauchen die Schemastufe (Ajv),
 * die im Main Thread unter der CSP nicht kompiliert. Sein einziger Netzbezug ist
 * der Schema-Chunk derselben Origin; er löst keine Dokumentverweise auf, führt
 * keine Speicher- oder Dateioperation aus und beantwortet genau eine Anfrage.
 */

let started = false;

globalThis.addEventListener('message', (event: MessageEvent) => {
  // Dedicated-Worker-Nachrichten stammen ausschließlich vom erzeugenden Dokument.
  if (started || (event.origin !== '' && event.origin !== globalThis.location.origin)) {
    globalThis.postMessage({ type: 'failure' });
    return;
  }
  started = true;
  void handleProfileWorkbenchRequest(event.data)
    .then((frame) => globalThis.postMessage(frame))
    .catch(() => globalThis.postMessage({ type: 'failure' }));
});
