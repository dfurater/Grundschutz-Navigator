import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';

export type InputModality = 'keyboard' | 'pointer';

export const INPUT_MODALITY_ATTRIBUTE = 'data-input-modality';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

function setInputModality(modality: InputModality) {
  document.documentElement.setAttribute(INPUT_MODALITY_ATTRIBUTE, modality);
}

/**
 * Hält die zuletzt genutzte Eingabeart an `<html data-input-modality>` fest.
 * Die Tailwind-Variante `kbd-focus` in `src/index.css` blendet Fokusringe nach
 * Zeiger-Eingabe aus: Mobile Safari zeigte auf einem iPhone `:focus-visible`
 * auch für skriptgesetzten Fokus nach einem Tap (GSPP-532).
 */
export function useInputModality() {
  useGlobalEventListener('document', 'keydown', (event) => {
    if (!MODIFIER_KEYS.has(event.key)) setInputModality('keyboard');
  }, true, undefined, true);

  useGlobalEventListener('document', 'pointerdown', () => {
    setInputModality('pointer');
  }, true, undefined, true);
}
