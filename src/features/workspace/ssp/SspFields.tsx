import { useState, type ReactNode } from 'react';
import { isJsonObject } from '@/domain/jsonGuards';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { Button } from '@/components/Button';

// Nur fachliche Felder der SSP-Projektion; aufgelöste Referenzobjekte und interne Pfade bleiben außerhalb des Feldbaums.
const LABELS: Readonly<Record<string, string>> = {
  uuid: 'UUID', metadata: 'Metadaten', title: 'Titel', lastModified: 'Zuletzt gespeichert', version: 'Dokumentversion', oscalVersion: 'OSCAL-Version',
  href: 'Verweis', remarks: 'Anmerkungen', systemIds: 'Systemkennungen', id: 'Kennung', identifierType: 'Kennungssystem',
  systemName: 'Systemname', systemNameShort: 'Kurzname', description: 'Beschreibung', dateAuthorized: 'Freigabedatum',
  securitySensitivityLevel: 'Schutzbedarf', systemInformation: 'Systeminformationen', informationTypes: 'Informationsarten',
  categorizations: 'Kategorisierungen', system: 'Kategorisierungssystem', informationTypeIds: 'Informationsart-Kennungen',
  confidentialityImpact: 'Auswirkung auf Vertraulichkeit', integrityImpact: 'Auswirkung auf Integrität', availabilityImpact: 'Auswirkung auf Verfügbarkeit',
  base: 'Basiswert', selected: 'Gewählter Wert', adjustmentJustification: 'Begründung der Anpassung',
  securityImpactLevel: 'Auswirkungsniveau', confidentiality: 'Vertraulichkeit', integrity: 'Integrität', availability: 'Verfügbarkeit',
  status: 'Betriebsstatus', state: 'Zustand', authorizationBoundary: 'Systemgrenze', networkArchitecture: 'Netzarchitektur', dataFlow: 'Datenfluss',
  diagrams: 'Diagrammverweise', caption: 'Bildunterschrift', responsibleParties: 'Verantwortliche Parteien', responsibleRoles: 'Verantwortliche Rollen',
  roleId: 'Rollenkennung', partyUuids: 'Partei-UUIDs', props: 'OSCAL-Eigenschaften', name: 'Name', value: 'Wert', ns: 'Namensraum', class: 'Klasse',
  links: 'Verweise', rel: 'Relation', mediaType: 'Medientyp', resourceFragment: 'Ressourcenfragment', text: 'Text',
  leveragedAuthorizations: 'Genutzte Autorisierungen', partyUuid: 'Partei-UUID', users: 'Benutzer', shortName: 'Kurzname', roleIds: 'Rollenkennungen',
  authorizedPrivileges: 'Berechtigungen', functionsPerformed: 'Erlaubte Funktionen', components: 'Komponenten', type: 'Typ', purpose: 'Zweck',
  inventoryItems: 'Inventar', implementedComponents: 'Implementierte Komponenten', componentUuid: 'Komponenten-UUID',
  setParameters: 'Parameterbelegungen', paramId: 'Parameterkennung', values: 'Werte', implementedRequirements: 'Anforderungen', controlId: 'Anforderungskennung',
  statements: 'Statements', statementId: 'Statement-Kennung', byComponents: 'Umsetzung je Komponente', implementationStatus: 'Umsetzungsstatus',
  export: 'Für andere Systeme bereitgestellte Umsetzung', provided: 'Bereitgestellte Leistungen', responsibilities: 'Verpflichtungen nutzender Systeme',
  providedUuid: 'Leistungs-UUID', inherited: 'Geerbte Umsetzung', satisfied: 'Erfüllte Verpflichtungen', responsibility: 'Verpflichtungsreferenz',
};

/** Aufklappen rendert erst den angeforderten Teil des Feldbaums. */
export function SspSection({ title, children }: Readonly<{ title: ReactNode; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="min-w-0 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <summary className={`min-h-touch cursor-pointer break-words px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] ${FOCUS_RING} focus-visible:ring-inset`}>{title}</summary>
      {open && <div className="min-w-0 space-y-2 px-4 pb-3">{children}</div>}
    </details>
  );
}

function scalar(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

function identifier(field: string): boolean {
  return /uuid|Ids?$|^id$|href/i.test(field);
}

function itemTitle(item: unknown, index: number): ReactNode {
  const title = isJsonObject(item) ? item.title ?? item.controlId ?? item.statementId : undefined;
  return <><span className="tabular-nums">{index + 1}</span>{typeof title === 'string' && <span className={isJsonObject(item) && item.title === undefined ? 'font-mono' : undefined}> · {title}</span>}</>;
}

function SspList({ items, field }: Readonly<{ items: readonly unknown[]; field: string }>) {
  const [visible, setVisible] = useState(50);
  return <>
    <ul className="min-w-0 divide-y divide-[var(--color-border-subtle)]">
      {items.slice(0, visible).map((item: unknown, index) => (
        <li key={index} className="min-w-0">
          {scalar(item) ? <SspFields value={item} field={field} /> : (
            <SspSection title={itemTitle(item, index)}>
              <SspFields value={item} />
            </SspSection>
          )}
        </li>
      ))}
    </ul>
    {visible < items.length && <Button variant="secondary" className="min-h-touch tabular-nums" onClick={() => setVisible(count => count + 50)}>Weitere Einträge · {visible} von {items.length}</Button>}
  </>;
}

/** Rendert ausschließlich die erlaubten Projektionsfelder als Text, auch hrefs und Markup. */
export function SspFields({ value, field = '' }: Readonly<{ value: unknown; field?: string }>) {
  if (scalar(value)) return <p className={`whitespace-pre-wrap break-words text-sm text-[var(--color-text-secondary)] ${identifier(field) ? 'font-mono' : ''}`}>{value}</p>;
  if (Array.isArray(value)) return <SspList items={value} field={field} />;
  if (!isJsonObject(value)) return null;
  return <div className="min-w-0 divide-y divide-[var(--color-border-subtle)]">{Object.entries(value).map(([key, child]) => {
    if (!Object.hasOwn(LABELS, key) || child == null || (Array.isArray(child) && !child.length)) return null;
    const label = key === 'status' && typeof child === 'string' ? 'Verweiszustand' : LABELS[key];
    return scalar(child) ? (
      <dl key={key} className="py-2">
        <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
        <dd className={`whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)] ${identifier(key) ? 'font-mono' : ''}`}>{key === 'status' && child === 'not-resolvable-in-context' ? 'nicht auflösbar im aktuellen Kontext' : child}</dd>
      </dl>
    ) : <SspSection key={key} title={<>{label}{Array.isArray(child) && <span className="tabular-nums"> · {child.length}</span>}</>}><SspFields value={child} field={key} /></SspSection>;
  })}</div>;
}
