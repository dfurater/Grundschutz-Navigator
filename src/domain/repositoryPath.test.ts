import { describe, expect, it } from 'vitest';
import { encodeRepositoryPath } from '@/domain/repositoryPath.mjs';

describe('encodeRepositoryPath', () => {
  it('encodes each path segment without hiding empty segments', () => {
    expect(encodeRepositoryPath('/Grundschutz++//ä #%.csv/'))
      .toBe('/Grundschutz%2B%2B//%C3%A4%20%23%25.csv/');
    expect(encodeRepositoryPath('')).toBe('');
    expect(encodeRepositoryPath('///')).toBe('///');
  });

  it('can omit empty segments for vocabulary source URLs', () => {
    expect(encodeRepositoryPath('/Grundschutz++//ä #%.csv/', { omitEmptySegments: true }))
      .toBe('Grundschutz%2B%2B/%C3%A4%20%23%25.csv');
    expect(encodeRepositoryPath('///', { omitEmptySegments: true })).toBe('');
  });
});
