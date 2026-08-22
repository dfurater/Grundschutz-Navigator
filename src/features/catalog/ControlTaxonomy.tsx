import { Badge } from '@/components/Badge';
import { IconTag, IconTarget } from '@/components/icons';
import type { Control } from '@/domain/models';
import type {
  ResolvedControlVocabularies,
} from '@/domain/vocabulary';
import {
  findResolutionByValue,
  outlineBadgeClass,
  toVocabCardId,
  type RenderVocabularyCard,
  VocabularyAffordanceIcon,
  vocabButtonClass,
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
  readonly hasControllingCriteria: boolean;
  readonly isVocabularyActive: (key: string) => boolean;
  readonly onToggleVocabulary: (key: string) => void;
  readonly renderVocabularyCard: RenderVocabularyCard;
}

export function ControlTaxonomy({
  control,
  resolvedVocabularies,
  hasControllingCriteria,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlTaxonomyProps) {
  const hasTaxonomy = control.tags.length > 0
    || control.statementProps.zielobjektKategorien.length > 0
    || control.taxonomy.length > 0;

  if (!hasTaxonomy) {
    return null;
  }

  return (
    <fieldset
      aria-label="Taxonomie"
      className={`space-y-2 ${hasControllingCriteria ? 'border-t border-[var(--color-border-subtle)] pt-3' : ''}`}
    >
      {/* GSPP-140: Zielobjekt-Kategorien bleiben als filterbare Taxonomie in Klassifikation, nicht in Anforderungsdetails. */}
      {(control.tags.length > 0 || control.statementProps.zielobjektKategorien.length > 0) && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">
            Tags und Zielobjektkategorien
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {control.tags.map((tag) => {
              const resolution = findResolutionByValue(resolvedVocabularies.tags, tag);
              const vocabKey = `tag:${tag}`;
              const active = isVocabularyActive(vocabKey);

              return resolution ? (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleVocabulary(vocabKey)}
                  aria-pressed={active}
                  aria-expanded={active}
                  aria-controls={toVocabCardId(vocabKey)}
                  aria-label={`Tag: ${tag}`}
                  className={vocabButtonClass(active)}
                >
                  <Badge
                    variant="outline"
                    className={outlineBadgeClass}
                    trailingIcon={(
                      <VocabularyAffordanceIcon active={active} placement="badge" />
                    )}
                  >
                    <IconTag className="w-3 h-3 mr-1 shrink-0" />
                    {tag}
                  </Badge>
                </button>
              ) : (
                <Badge key={tag} variant="outline" className={outlineBadgeClass}>
                  <IconTag className="w-3 h-3 mr-1 shrink-0" />
                  {tag}
                </Badge>
              );
            })}
            {control.statementProps.zielobjektKategorien.map((kat) => {
              const resolution = findResolutionByValue(
                resolvedVocabularies.statement.zielobjektKategorien,
                kat,
              );
              const vocabKey = `zielobjekt:${kat}`;
              const active = isVocabularyActive(vocabKey);

              return resolution ? (
                <button
                  key={kat}
                  type="button"
                  onClick={() => onToggleVocabulary(vocabKey)}
                  aria-pressed={active}
                  aria-expanded={active}
                  aria-controls={toVocabCardId(vocabKey)}
                  aria-label={`Zielobjekt: ${kat}`}
                  className={vocabButtonClass(active)}
                >
                  <Badge
                    variant="outline"
                    className={outlineBadgeClass}
                    trailingIcon={(
                      <VocabularyAffordanceIcon active={active} placement="badge" />
                    )}
                  >
                    <IconTarget className="w-3 h-3 mr-1 shrink-0" />
                    {kat}
                  </Badge>
                </button>
              ) : (
                <Badge key={kat} variant="outline" className={outlineBadgeClass}>
                  <IconTarget className="w-3 h-3 mr-1 shrink-0" />
                  {kat}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
      {control.taxonomy.length > 0 && (
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
      )}
      {control.tags.map((tag) => {
        const resolution = findResolutionByValue(resolvedVocabularies.tags, tag);
        if (!resolution) return null;
        const vocabKey = `tag:${tag}`;
        const active = isVocabularyActive(vocabKey);

        return (
          <div key={`tag-card:${tag}`} id={toVocabCardId(vocabKey)} hidden={!active || undefined}>
            {active && renderVocabularyCard(resolution)}
          </div>
        );
      })}
      {control.statementProps.zielobjektKategorien.map((kat) => {
        const resolution = findResolutionByValue(
          resolvedVocabularies.statement.zielobjektKategorien,
          kat,
        );
        if (!resolution) return null;
        const vocabKey = `zielobjekt:${kat}`;
        const active = isVocabularyActive(vocabKey);

        return (
          <div key={`zielobjekt-card:${kat}`} id={toVocabCardId(vocabKey)} hidden={!active || undefined}>
            {active && renderVocabularyCard(resolution)}
          </div>
        );
      })}
    </fieldset>
  );
}
