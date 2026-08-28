import { describe, expect, it } from 'vitest';
import { deriveUuidV5 } from './uuidV5';

const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('deriveUuidV5', () => {
  it('bildet den bekannten Referenzvektor python.org im DNS-Namensraum ab', () => {
    // Bekannter Vektor aus der Python-uuid-Dokumentation (RFC 4122 §4.3).
    expect(deriveUuidV5(NAMESPACE_DNS, 'python.org')).toBe(
      '886313e1-3b8a-5372-9b90-0c9aee199e5d',
    );
  });

  it('ist deterministisch und trennt Namensräume', () => {
    const first = deriveUuidV5(NAMESPACE_DNS, 'python.org');
    expect(deriveUuidV5(NAMESPACE_DNS, 'python.org')).toBe(first);
    expect(deriveUuidV5(NAMESPACE_DNS, 'example.com')).not.toBe(first);
  });

  it('trägt Versionsnibble 5 und die RFC-Variante', () => {
    const value = deriveUuidV5(NAMESPACE_DNS, 'irgendein-name');
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('lehnt einen Namensraum ohne gültiges Hexformat fail-closed ab', () => {
    expect(() => deriveUuidV5('kein-uuid', 'name')).toThrow(/Namensraum/);
  });
});
