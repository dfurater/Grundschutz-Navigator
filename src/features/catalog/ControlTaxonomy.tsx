import { Fragment, type ReactNode } from 'react';
import type { Control } from '@/domain/models';
import { isPlaceholderNamespace } from '@/domain/placeholderNamespace';
import type {
  ResolvedControlVocabularies,
  VocabularyResolution,
} from '@/domain/vocabulary';
import {
  findResolutionByValue,
  SubSectionHeading,
  TermTrigger,
  toVocabCardId,
  type RenderVocabularyCard,
} from './ControlVocabularyPrimitives';

type TaxonomyControl = Pick<Control, 'tags' | 'taxonomy'> & {
  statementProps: Pick<Control['statementProps'], 'zielobjektKategorien'>;
};

const TAXONOMY_LABELS: Record<string, string> = {
  'Taxonomy-L1': 'L1',
  'Taxonomy-L2': 'L2',
  'Taxonomy-L3': 'L3',
  'Taxonomy-L4': 'L4',
};

type TaxonomyVocabularies = Pick<ResolvedControlVocabularies, 'tags'> & {
  statement: Pick<ResolvedControlVocabularies['statement'], 'zielobjektKategorien'>;
};

export interface ControlTaxonomyProps {
  readonly control: TaxonomyControl;
  readonly resolvedVocabularies: TaxonomyVocabularies;
  readonly isVocabularyActive: (key: string) => boolean;
  readonly onToggleVocabulary: (key: string) => void;
  readonly renderVocabularyCard: RenderVocabularyCard;
}

export interface ControlSubjectGroupProps extends ControlTaxonomyProps {
  /**
   * Zielobjekte stehen im OSCAL im Anforderungssatz (`statement`-Part) und
   * erscheinen deshalb im Block „Anforderung“; Tags hängen an der Anforderung
   * selbst und stehen im Block „Einordnung“.
   */
  readonly kind: 'zielobjekte' | 'tags';
}

type SubjectEntry = {
  key: string;
  label: string;
  ariaLabel: string;
  resolution: VocabularyResolution | null;
};

/**
 * Tags bzw. Zielobjekte als rahmen-/symbolfreie Inline-Trigger (GSPP-303 T7),
 * getrennt durch „·".
 */
export function ControlSubjectGroup({
  control,
  resolvedVocabularies,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
  kind,
}: ControlSubjectGroupProps) {
  const entries: SubjectEntry[] = kind === 'tags'
    ? control.tags.map((tag) => ({
      key: `tag:${tag}`,
      label: tag,
      ariaLabel: `Tag: ${tag}`,
      resolution: findResolutionByValue(resolvedVocabularies.tags, tag),
    }))
    : control.statementProps.zielobjektKategorien.map((kat) => ({
      key: `zielobjekt:${kat}`,
      label: kat,
      ariaLabel: `Zielobjekt: ${kat}`,
      resolution: findResolutionByValue(
        resolvedVocabularies.statement.zielobjektKategorien,
        kat,
      ),
    }));

  if (entries.length === 0) {
    return null;
  }

  const renderEntry = (entry: SubjectEntry, index: number): ReactNode => {
    const active = isVocabularyActive(entry.key);

    return (
      <Fragment key={entry.key}>
        {index > 0 && (
          <span aria-hidden="true" className="mx-1.5 text-slate-300">·</span>
        )}
        {entry.resolution ? (
          <TermTrigger
            vocabKey={entry.key}
            active={active}
            onToggle={onToggleVocabulary}
            label={entry.label}
            ariaLabel={entry.ariaLabel}
          />
        ) : (
          <span>{entry.label}</span>
        )}
      </Fragment>
    );
  };

  return (
    <div>
      <SubSectionHeading>{kind === 'tags' ? 'Tags' : 'Zielobjekte'}</SubSectionHeading>
      <div className="text-sm leading-relaxed text-slate-700">
        {entries.map((entry, index) => renderEntry(entry, index))}
      </div>
      {entries.map((entry) => {
        if (!entry.resolution) return null;
        const active = isVocabularyActive(entry.key);
        return (
          <div key={`${entry.key}-card`} id={toVocabCardId(entry.key)} hidden={!active || undefined}>
            {active && renderVocabularyCard(entry.resolution)}
          </div>
        );
      })}
    </div>
  );
}

/** WLAN-Block der Taxonomie (GSPP-303 T9: aus `ControlTaxonomy` ausgelagert). */
export interface ControlWlanTaxonomyProps {
  readonly control: Pick<Control, 'taxonomy'>;
}

export function ControlWlanTaxonomy({
  control,
}: ControlWlanTaxonomyProps) {
  if (control.taxonomy.length === 0) {
    return null;
  }

  // Tabelle wie die Fußzeile: Stufe links, Wert rechts in einer bündigen
  // Spalte, Zeilenabstand der Listen (Owner 26.09.2026). Die Namensraum-Adresse
  // entfällt, solange das BSI dort nur einen Platzhalter führt; ein echter
  // Namensraum erscheint wieder unter dem Wert.
  return (
    <div aria-label="WLAN-Taxonomie">
      <SubSectionHeading>WLAN-Taxonomie</SubSectionHeading>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm leading-relaxed text-slate-700">
        {control.taxonomy.map((prop, index) => (
          <div key={`${prop.name}:${prop.value}:${prop.ns ?? ''}:${index}`} className="contents">
            <dt className="font-medium text-[var(--color-text-secondary)]">
              {TAXONOMY_LABELS[prop.name] ?? prop.name}
            </dt>
            <dd className="break-words">{prop.value}</dd>
            {prop.ns && !isPlaceholderNamespace(prop.ns) && (
              <dd className="col-start-2 -mt-1.5 break-all font-mono text-xs text-slate-500">{prop.ns}</dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
