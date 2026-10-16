import { describe, expect, it } from 'vitest';
import { compareStringsByCodeUnit } from '@/domain/codeUnitOrder.mjs';

describe('compareStringsByCodeUnit', () => {
  it('orders equal, prefix, case and supplementary characters by UTF-16 units', () => {
    expect(compareStringsByCodeUnit('same', 'same')).toBe(0);
    expect(compareStringsByCodeUnit('a', 'aa')).toBe(-1);
    expect(compareStringsByCodeUnit('aa', 'a')).toBe(1);
    expect(['ä', '\uE000', 'a', '😀', 'A', ''].sort(compareStringsByCodeUnit))
      .toEqual(['', 'A', 'a', 'ä', '😀', '\uE000']);
  });
});
