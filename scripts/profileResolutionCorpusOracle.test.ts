import { describe, expect, it } from 'vitest';
import {
  normalizeProseLeadingSpace,
  reconcileBsiDifferences,
  reconcileBsiKnownDifferences,
} from './profileResolutionCorpusOracle';

describe('Profile-Resolution-Korpusorakel', () => {
  it('normalisiert nur die dokumentierten NIST-Whitespace-Mitglieder', () => {
    const normalized = normalizeProseLeadingSpace({
      catalog: {
        metadata: { title: '  {{ insert: param, ac-1 }}  ' },
        controls: [
          {
            id: 'ac-1',
            title: '  {{ insert: param, ac-1 }}  ',
            parts: [{ name: 'guidance', prose: '  {{ insert: param, ac-1 }}  ' }],
            params: [{ select: { choice: ['  {{ insert: param, ac-1 }}  '] } }],
            citation: { text: '  {{ insert: param, ac-1 }}  ' },
          },
        ],
      },
    }) as Record<string, unknown>;
    const catalog = normalized['catalog'] as Record<string, unknown>;
    const control = (catalog['controls'] as Record<string, unknown>[])[0]!;

    expect((catalog['metadata'] as Record<string, unknown>)['title']).toBe(
      '  {{ insert: param, ac-1 }}  ',
    );
    expect(control['title']).toBe('  {{ insert: param, ac-1 }}  ');
    expect((control['parts'] as Record<string, unknown>[])[0]!['prose']).toBe(
      '{{ insert: param, ac-1 }}',
    );
    expect((((control['params'] as Record<string, unknown>[])[0]!['select'] as Record<string, unknown>)['choice'] as string[])[0]).toBe(
      '{{ insert: param, ac-1 }}',
    );
    expect((control['citation'] as Record<string, unknown>)['text']).toBe(
      '{{ insert: param, ac-1 }}',
    );
  });

  it('reconciliert registrierte Positionsabweichungen auch für Root-Controls', () => {
    const { cleaned, applied, missing } = reconcileBsiKnownDifferences('lieferkette', {
      catalog: {
        controls: [
          { id: 'vorher' },
          { id: 'KONF.2.4.2' },
          { id: 'nachher' },
        ],
      },
    });
    const body = (cleaned as { catalog: { controls: Array<{ id: string }> } }).catalog;

    expect(body.controls.map((control) => control.id)).toEqual([
      'vorher',
      'nachher',
      'KONF.2.4.2',
    ]);
    expect(applied).toContain('lieferkette:KONF.2.4.2:controls:end');
    expect(missing).not.toContain('lieferkette:KONF.2.4.2:controls:end');
  });

  it('meldet eine wirkungslose registrierte Positionsabweichung als fehlend', () => {
    const { cleaned, applied, missing } = reconcileBsiKnownDifferences('lieferkette', {
      catalog: {
        controls: [
          { id: 'vorher' },
          { id: 'KONF.2.4.2' },
        ],
      },
    });
    const body = (cleaned as { catalog: { controls: Array<{ id: string }> } }).catalog;

    expect(body.controls.map((control) => control.id)).toEqual([
      'vorher',
      'KONF.2.4.2',
    ]);
    expect(applied).not.toContain('lieferkette:KONF.2.4.2:controls:end');
    expect(missing).toContain('lieferkette:KONF.2.4.2:controls:end');
  });

  it('erkennt eine kausal wirksame Positionsabweichung auch bei unverändertem Eigenindex', () => {
    const differences = [
      {
        corpusKey: 'lieferkette',
        controlId: 'KONF.2.4.2',
        member: 'controls',
        position: 'end',
        reason: 'Test: erste Positionsabweichung.',
      },
      {
        corpusKey: 'lieferkette',
        controlId: 'ZWEITER',
        member: 'controls',
        position: 'end',
        reason: 'Test: zweite Positionsabweichung.',
      },
    ] as const;

    const { cleaned, applied, missing } = reconcileBsiDifferences(differences, {
      catalog: {
        controls: [
          { id: 'KONF.2.4.2' },
          { id: 'b' },
          { id: 'ZWEITER' },
        ],
      },
    });
    const body = (cleaned as { catalog: { controls: Array<{ id: string }> } }).catalog;

    expect(body.controls.map((control) => control.id)).toEqual([
      'b',
      'KONF.2.4.2',
      'ZWEITER',
    ]);
    expect(applied).toEqual([
      'lieferkette:KONF.2.4.2:controls:end',
      'lieferkette:ZWEITER:controls:end',
    ]);
    expect(missing).toEqual([]);
  });
});
