import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';
import { addSspItem, moveSspItem, readSspValue, removeSspItem, setSspValue, type SspPath } from '@/domain/sspAuthoring';
import { INPUT, OscalKey, SECTION_LABEL } from '@/features/workspace/profile/ProfileMarks';
import type { SspEditor } from '@/features/workspace/ssp/useSspEditor';

const REQUIRED_MARK = 'text-xs font-medium text-[var(--color-text-muted)]';

/** OSCAL-Schlüssel eines Pfads für die Feldbeschriftung, ohne Listenindizes. */
function keyOf(path: SspPath): string {
  return path.filter((segment) => typeof segment === 'string').join('.');
}

/** Ein Textfeld auf genau einen Wert der Quelle; Leerraum allein entfernt den Wert. */
export function SspTextField({ editor, path, label, required = false, multiline = false, mono = false, list }: Readonly<{
  editor: SspEditor;
  path: SspPath;
  label: string;
  required?: boolean;
  multiline?: boolean;
  mono?: boolean;
  /** `id` einer `datalist` mit Vorschlägen. */
  list?: string;
}>) {
  const id = useId();
  const value = readString(readSspValue(editor.working, path)) ?? '';
  const onChange = (next: string) => { editor.apply((source) => setSspValue(source, path, next)); };
  const className = `${INPUT} ${mono ? 'font-mono' : ''}`;
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-[var(--color-text-primary)]">
        {label} <OscalKey>{keyOf(path)}</OscalKey>{required && <span className={REQUIRED_MARK}>Pflicht</span>}
      </label>
      {multiline
        ? <textarea id={id} className={`${className} min-h-20`} value={value} aria-required={required} onChange={(event) => onChange(event.target.value)} />
        : <input id={id} className={className} value={value} aria-required={required} autoComplete="off" list={list} onChange={(event) => onChange(event.target.value)} />}
    </div>
  );
}

/** Auswahl aus einer geschlossenen Aufzählung; ein unbekannter Bestandswert bleibt wählbar. */
export function SspSelectField({ editor, path, label, options, required = false }: Readonly<{
  editor: SspEditor;
  path: SspPath;
  label: string;
  options: readonly string[];
  required?: boolean;
}>) {
  const id = useId();
  const value = readString(readSspValue(editor.working, path)) ?? '';
  const choices = value === '' || options.includes(value) ? options : [value, ...options];
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-[var(--color-text-primary)]">
        {label} <OscalKey>{keyOf(path)}</OscalKey>{required && <span className={REQUIRED_MARK}>Pflicht</span>}
      </label>
      <select id={id} className={`${INPUT} font-mono`} value={value} aria-required={required} onChange={(event) => { editor.apply((source) => setSspValue(source, path, event.target.value)); }}>
        <option value="">–</option>
        {choices.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

/**
 * Stabile Zeilenschlüssel: die UUID einer Zeile, sonst eine lokale Kennung, die
 * Hinzufügen, Entfernen und Verschieben mitgeht. Ändert sich die Zeilenzahl
 * von außen (Übernahme eines anderen Stands), entstehen neue Kennungen.
 */
function useRowKeys(items: readonly unknown[], uuidKeyed: boolean) {
  const [state, setState] = useState(() => ({ next: items.length, keys: items.map((_, index) => `row-${index}`) }));
  let keys = state.keys;
  if (!uuidKeyed && keys.length !== items.length) {
    const fresh = { next: state.next + items.length, keys: items.map((_, index) => `row-${state.next + index}`) };
    setState(fresh);
    keys = fresh.keys;
  }
  const keyAt = (item: unknown, index: number): string => {
    const uuid = isJsonObject(item) ? readString(item.uuid) : undefined;
    return uuidKeyed && uuid !== undefined ? uuid : keys[index] ?? `row-index-${index}`;
  };
  return {
    keyAt,
    added: () => setState((current) => ({ next: current.next + 1, keys: [...current.keys, `row-${current.next}`] })),
    removed: (index: number) => setState((current) => ({ ...current, keys: current.keys.filter((_, position) => position !== index) })),
    moved: (from: number, to: number) => setState((current) => {
      const next = [...current.keys];
      const [key] = next.splice(from, 1);
      next.splice(to, 0, key);
      return { ...current, keys: next };
    }),
  };
}

/**
 * Bearbeitbare Liste einer SSP-Struktur. Jede Zeile trägt ihre UUID oder eine
 * stabile lokale Kennung als Schlüssel; Eingaben bleiben beim Hinzufügen,
 * Entfernen und Verschieben an ihrer Zeile.
 */
export function SspRowList({ editor, path, title, required = false, uuidKeyed, newItem, addLabel, remove, renderRow, rowTitle }: Readonly<{
  editor: SspEditor;
  path: SspPath;
  title: string;
  required?: boolean;
  /** Zeilen tragen eine UUID. */
  uuidKeyed: boolean;
  /** Neue Zeile; `undefined` blendet „Hinzufügen“ aus. */
  newItem?: () => unknown;
  addLabel: string;
  /** Eigener Entfernen-Patch, etwa mit Referenzprüfung. */
  remove?: (source: unknown, index: number) => unknown;
  renderRow: (rowPath: SspPath, item: unknown) => ReactNode;
  rowTitle: (item: unknown, index: number) => string;
}>) {
  const headingId = useId();
  const items = readArray(readSspValue(editor.working, path));
  const rows = useRowKeys(items, uuidKeyed);
  const removeAt = (index: number) => {
    if (editor.apply((source) => (remove ?? ((current, at) => removeSspItem(current, path, at)))(source, index))) rows.removed(index);
  };
  const move = (from: number, to: number) => {
    if (editor.apply((source) => moveSspItem(source, path, from, to))) rows.moved(from, to);
  };
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className={`${SECTION_LABEL} flex flex-wrap items-baseline gap-x-2`}>
        <span>{title}</span>
        <span className="tabular-nums">{items.length}</span>
        <OscalKey>{keyOf(path)}</OscalKey>
        {required && <span className={REQUIRED_MARK}>Pflicht</span>}
      </h3>
      {items.length > 0 && (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-md border border-[var(--color-border-default)]">
          {items.map((item, index) => {
            const label = rowTitle(item, index);
            return (
              <li key={rows.keyAt(item, index)} aria-label={label} className="space-y-3 p-3">
                {renderRow([...path, index], item)}
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" className="min-h-touch desktop:min-h-0" disabled={index === 0} aria-label={`${label} nach oben`} onClick={() => move(index, index - 1)}>Nach oben</Button>
                  <Button variant="ghost" size="sm" className="min-h-touch desktop:min-h-0" disabled={index === items.length - 1} aria-label={`${label} nach unten`} onClick={() => move(index, index + 1)}>Nach unten</Button>
                  <Button variant="ghost" size="sm" className="min-h-touch desktop:min-h-0" aria-label={`${label} entfernen`} onClick={() => removeAt(index)}>Entfernen</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {newItem && (
        <Button variant="secondary" size="sm" className="min-h-touch desktop:min-h-0" onClick={() => { if (editor.apply((source) => addSspItem(source, path, newItem()))) rows.added(); }}>
          {addLabel}
        </Button>
      )}
    </section>
  );
}
