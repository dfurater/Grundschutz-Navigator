import { Badge } from '@/components/Badge';
import { IconTag, IconTarget } from '@/components/icons';
import type { Control } from '@/domain/models';
import type {
  ResolvedControlVocabularies,
  VocabularyResolution,
} from '@/domain/vocabulary';
import {
  outlineBadgeClass,
  toVocabCardId,
  type RenderVocabularyCard,
  VocabularyAffordanceIcon,
  vocabButtonClass,
} from './ControlVocabularyPrimitives';

type TaxonomyControl = Pick<Control, 'tags'> & {
  statementProps: Pick<Control['statementProps'], 'zielobjektKategorien'>;
};

type TaxonomyVocabularies = Pick<ResolvedControlVocabularies, 'tags'> & {
  statement: Pick<ResolvedControlVocabularies['statement'], 'zielobjektKategorien'>;
};

export interface ControlTaxonomyProps {
  control: TaxonomyControl;
  resolvedVocabularies: TaxonomyVocabularies;
  hasControllingCriteria: boolean;
  isVocabularyActive: (key: string) => boolean;
  onToggleVocabulary: (key: string) => void;
  renderVocabularyCard: RenderVocabularyCard;
}

function findResolutionByValue(
  resolutions: VocabularyResolution[],
  value: string,
) {
  return resolutions.find((resolution) => resolution.entry.value === value) ?? null;
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
    || control.statementProps.zielobjektKategorien.length > 0;

  if (!hasTaxonomy) {
    return null;
  }

  return (
    <div
      role="group"
      aria-label="Taxonomie"
      className={`space-y-2 ${hasControllingCriteria ? 'border-t border-[var(--color-border-subtle)] pt-3' : ''}`}
    >
      {/* GRU-140: Zielobjekt-Kategorien bleiben als filterbare Taxonomie in Klassifikation, nicht in Anforderungsdetails. */}
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
    </div>
  );
}
