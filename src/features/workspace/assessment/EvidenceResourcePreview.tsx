import { useEffect, useState } from 'react';
import { downloadBlob } from '@/adapters/browserDownload';
import { Button } from '@/components/Button';
import { verifyResourceIntegrity, type EvidenceHashCheck } from '@/domain/evidenceIntegrity';
import { decideEvidencePreview, decodeEvidenceContent } from '@/domain/evidencePreview';
import { isJsonObject, readString, type JsonObject } from '@/domain/jsonGuards';
import { decodedBase64ByteLength } from '@/domain/oscalBackMatterBase64';
import { isSafeExternalHref, type ResolvedResource } from '@/domain/referenceResolution';

type Preview = { readonly url: string; readonly text?: never } | { readonly text: string; readonly url?: never };
interface PreviewState {
  readonly resource: JsonObject;
  readonly preview?: Preview;
  readonly checks?: readonly EvidenceHashCheck[];
  readonly checking?: boolean;
  readonly error?: string;
}
const HASH_LABELS = {
  'verified-match': 'Hash stimmt überein',
  'verified-mismatch': 'Hash weicht ab',
  'not-verifiable': 'Nicht prüfbar',
} as const;

export function EvidenceResourcePreview({ resource, resolved }: Readonly<{ resource: JsonObject; resolved: ResolvedResource }>) {
  const [state, setState] = useState<PreviewState>({ resource });
  if (state.resource !== resource) setState({ resource });
  const preview = state.resource === resource ? state.preview : undefined;
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  const embedded = isJsonObject(resource.base64) ? resource.base64 : undefined;
  const mediaType = readString(embedded?.['media-type']);
  const normalizedType = mediaType?.trim().toLowerCase();
  const filename = readString(embedded?.filename);
  const encoded = readString(embedded?.value);
  const decision = decideEvidencePreview(mediaType);

  function openContent(download: boolean) {
    // Auch der Aktionspfad prüft die deklarierte Medienart; Download bleibt explizit möglich.
    if (!download && decision.kind !== 'preview') return;
    try {
      const bytes = decodeEvidenceContent(resource);
      if (!bytes) throw new Error('unavailable');
      if (download) {
        downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), filename || 'evidenz');
      } else if (normalizedType === 'text/plain') {
        setState(current => ({ ...current, preview: { text: new TextDecoder().decode(bytes) }, error: undefined }));
      } else {
        const url = URL.createObjectURL(new Blob([bytes], { type: normalizedType }));
        setState(current => ({ ...current, preview: { url }, error: undefined }));
      }
    } catch {
      setState(current => ({ ...current, error: 'Inhalt konnte nicht geöffnet werden. Prüfen Sie die Ressource und versuchen Sie es erneut.' }));
    }
  }

  async function checkIntegrity() {
    setState(current => ({ ...current, checking: true, checks: undefined, error: undefined }));
    try {
      const checks = await verifyResourceIntegrity(resource);
      // Die Referenzprojektion lässt Links ohne href aus; Ergebnisse dürfen dadurch nicht verrutschen.
      if (checks.length !== resolved.rlinks.length) throw new Error('unavailable');
      setState(current => current.resource === resource ? { ...current, checks, checking: false } : current);
    } catch {
      setState(current => current.resource === resource ? { ...current, checking: false, error: 'Integrität konnte nicht geprüft werden. Erneut versuchen.' } : current);
    }
  }

  return (
    <section aria-label="Evidenzressource" className="space-y-3 rounded-md border border-slate-200 bg-paper p-4 text-sm text-slate-900">
      <h3 className="font-semibold leading-snug break-words">{resolved.title || 'Evidenzressource'}</h3>
      <dl className="space-y-1 break-words">
        <div><dt className="inline type-secondary">UUID: </dt><dd className="inline font-mono text-xs">{resolved.uuid}</dd></div>
        {embedded && <>
          <div><dt className="inline type-secondary">Medienart: </dt><dd className="inline">{mediaType || 'nicht deklariert'}</dd></div>
          <div><dt className="inline type-secondary">Dateiname: </dt><dd className="inline">{filename || 'nicht deklariert'}</dd></div>
          <div><dt className="inline type-secondary">Dekodierte Größe: </dt><dd className="inline tabular-nums">{encoded === undefined ? 'nicht verfügbar' : `${decodedBase64ByteLength(encoded)} Byte (rechnerisch)`}</dd></div>
        </>}
      </dl>
      {embedded && decision.kind === 'metadata' && <p className="type-secondary">Keine Vorschau: {decision.reason === 'media-type-missing' ? 'Medienart fehlt.' : 'Medienart ist nicht freigegeben.'}</p>}
      {resolved.rlinks.length > 0 && <ul className="space-y-2">
        {resolved.rlinks.map((link, index) => (
          <li key={`${index}-${link.href}`} className="space-y-1 break-words">
            <p className="type-meta">Medienart: {link.mediaType || 'nicht deklariert'} · Integrität: {link.integrity === 'declared' ? 'Hash deklariert' : 'Kein Hash deklariert'} · <span className="tabular-nums">Deklarierte Hashes: {link.hashes.length}</span></p>
            {link.target.kind === 'external' && link.target.href && isSafeExternalHref(link.target.href)
              ? <a href={link.target.href} target="_blank" rel="noopener noreferrer" className="catalog-prose-link inline-flex min-h-touch items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1">Extern öffnen ({decideEvidencePreview(link.mediaType).kind === 'preview' ? link.mediaType : 'ohne Vorschau'}; neuer Tab)</a>
              : <p className="type-secondary">Kein freigegebener externer Link.</p>}
            {state.checks?.[index] && <output className="block">{HASH_LABELS[state.checks[index].status]}</output>}
          </li>
        ))}
      </ul>}
      <div className="flex flex-wrap gap-2">
        {embedded && decision.kind === 'preview' && <Button variant="secondary" className="min-h-touch" aria-expanded={!!preview} onClick={() => preview ? setState(current => ({ ...current, preview: undefined })) : openContent(false)}>{preview ? 'Vorschau schließen' : 'Vorschau öffnen'}</Button>}
        {embedded && <Button variant="secondary" className="min-h-touch" onClick={() => openContent(true)}>Herunterladen</Button>}
        <Button variant="secondary" className="min-h-touch" disabled={state.checking} onClick={() => void checkIntegrity()}>{state.checking ? 'Integrität wird geprüft…' : 'Integrität prüfen'}</Button>
      </div>
      {state.checks?.length === 0 && <output className="block">Keine Ressourcenlinks für eine Hashprüfung deklariert.</output>}
      {state.error && <p role="alert">{state.error}</p>}
      {preview && ('text' in preview
        ? <pre className="whitespace-pre-wrap break-words font-mono text-xs">{preview.text}</pre>
        : <img src={preview.url} alt="Evidenzvorschau" className="max-w-full" onError={() => setState(current => ({ ...current, preview: undefined, error: 'Bildvorschau konnte nicht angezeigt werden.' }))} />)}
    </section>
  );
}
