import { Fragment, type ReactNode } from 'react';
import type { Control } from '@/domain/models';
import type {
  ResolvedControlVocabularies,
  VocabularyResolution,
} from '@/domain/vocabulary';
import {
  findResolutionByValue,
  TermTrigger,
  toVocabCardId,
  type RenderVocabularyCard,
} from './ControlVocabularyPrimitives';

type TaxonomyControl = Pick<Control, 'tags' | 'taxonomy'> & {
  statementProps: Pick<Control['statementProps'], 'zielobjektKategorien'>;
};

const TAXONOMY_LABELS: Record<string, string> = {
  'Taxonomy-L1': 'Taxonomie L1',
  'Taxonomy-L2': 'Taxonomie L2',
  'Taxonomy-L3': 'Taxonomie L3',
  'Taxonomy-L4': 'Taxonomie L4',
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

/**
 * Tags und Zielobjekte als rahmen-/symbolfreie Inline-Trigger (GSPP-303 T7),
 * getrennt durch „·" (GSPP-303 T9: aus `ControlTaxonomy` ausgelagert, wird in
 * der Merkmale-Zone gemountet).
 */
export function ControlSubjectGroups({
  control,
  resolvedVocabularies,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlTaxonomyProps) {
  const tagEntries: { key: string; label: string; ariaLabel: string; resolution: VocabularyResolution | null }[] =
    control.tags.map((tag) => ({
      key: `tag:${tag}`,
      label: tag,
      ariaLabel: `Tag: ${tag}`,
      resolution: findResolutionByValue(resolvedVocabularies.tags, tag),
    }));
  const targetEntries = control.statementProps.zielobjektKategorien.map((kat) => ({
      key: `zielobjekt:${kat}`,
      label: kat,
      ariaLabel: `Zielobjekt: ${kat}`,
      resolution: findResolutionByValue(
        resolvedVocabularies.statement.zielobjektKategorien,
        kat,
      ),
    }));

  const renderEntry = (entry: (typeof tagEntries)[number], index: number): ReactNode => {
    const active = isVocabularyActive(entry.key);

    return (
      <Fragment key={entry.key}>
        {index > 0 && (
          <span aria-hidden="true" className="mx-1">·</span>
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

  if (control.tags.length === 0 && control.statementProps.zielobjektKategorien.length === 0) {
    return null;
  }

  const renderGroup = (heading: string, entries: typeof tagEntries) => (
    <div key={heading}>
      <h4 className="text-sm font-semibold text-slate-800 mb-2">{heading}</h4>
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

  return (
    <div className="space-y-4">
      {tagEntries.length > 0 && renderGroup('Tags', tagEntries)}
      {targetEntries.length > 0 && renderGroup('Zielobjekte', targetEntries)}
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

  return (
    <div aria-label="WLAN-Taxonomie" className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-800">
        WLAN-Taxonomie
      </h4>
      <dl className="grid gap-2 sm:grid-cols-2">
        {control.taxonomy.map((prop, index) => (
          <div
            key={`${prop.name}:${prop.value}:${prop.ns ?? ''}:${index}`}
            className="rounded-md border border-[var(--color-border-subtle)] bg-slate-50 px-3 py-2"
          >
            <dt className="text-xs font-semibold text-slate-600">
              {TAXONOMY_LABELS[prop.name] ?? prop.name}
            </dt>
            <dd className="mt-0.5 break-words text-sm text-slate-900">
              {prop.value}
            </dd>
            {prop.ns && (
              <dd className="mt-1 break-all font-mono text-[11px] text-slate-500">
                {prop.ns}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
