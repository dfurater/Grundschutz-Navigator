import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { INPUT_MODALITY_ATTRIBUTE, useInputModality } from './useInputModality';

const INDEX_CSS = readFileSync(join(resolve(import.meta.dirname, '..'), 'index.css'), 'utf8');

const modality = () => document.documentElement.getAttribute(INPUT_MODALITY_ATTRIBUTE);

describe('useInputModality', () => {
  afterEach(() => document.documentElement.removeAttribute(INPUT_MODALITY_ATTRIBUTE));

  it('setzt ohne Ereignis kein Attribut', () => {
    renderHook(() => useInputModality());
    expect(modality()).toBeNull();
  });

  it('wechselt zwischen Tastatur und Zeiger', () => {
    renderHook(() => useInputModality());

    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(modality()).toBe('keyboard');

    fireEvent.pointerDown(document.body);
    expect(modality()).toBe('pointer');

    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(modality()).toBe('keyboard');
  });

  it.each(['Shift', 'Control', 'Alt', 'Meta'])('lässt die Eingabeart bei %s allein unverändert', (key) => {
    renderHook(() => useInputModality());
    fireEvent.pointerDown(document.body);

    fireEvent.keyDown(document.body, { key });

    expect(modality()).toBe('pointer');
  });

  it('erfasst Ereignisse in der Capture-Phase, auch wenn ein Element sie stoppt', () => {
    renderHook(() => useInputModality());
    const button = document.createElement('button');
    button.addEventListener('keydown', (event) => event.stopPropagation());
    document.body.append(button);

    fireEvent.keyDown(button, { key: 'Escape' });

    expect(modality()).toBe('keyboard');
    button.remove();
  });

  it('blendet den Ring in kbd-focus nur nach Zeiger-Eingabe aus', () => {
    expect(INDEX_CSS).toContain(
      '@custom-variant kbd-focus (&:focus-visible:not(:where([data-input-modality=pointer] *)));',
    );
  });
});
