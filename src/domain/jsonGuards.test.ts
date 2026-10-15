import { describe, expect, it } from 'vitest';
import { isJsonContainer, isJsonObject, readArray, readString } from './jsonGuards';

const PRIMITIVES: readonly unknown[] = [undefined, 'text', 0, Number.NaN, true, 1n, Symbol('s')];

describe('isJsonObject', () => {
  it('lässt nur Objekte ohne Array durch', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject(Object.create(null))).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    for (const value of PRIMITIVES) expect(isJsonObject(value)).toBe(false);
  });
});

describe('isJsonContainer', () => {
  it('lässt Objekte und Arrays durch, aber kein null und keine Primitive', () => {
    expect(isJsonContainer({})).toBe(true);
    expect(isJsonContainer([])).toBe(true);
    expect(isJsonContainer(null)).toBe(false);
    for (const value of PRIMITIVES) expect(isJsonContainer(value)).toBe(false);
  });
});

describe('readString', () => {
  it('liefert nur Strings und koerziert nichts', () => {
    expect(readString('')).toBe('');
    expect(readString('id')).toBe('id');
    for (const value of [undefined, null, 1, true, {}, ['id']]) {
      expect(readString(value)).toBeUndefined();
    }
  });
});

describe('readArray', () => {
  it('liefert ein Array unverändert und sonst eine leere Liste', () => {
    const entries = [1, 'a', {}];
    expect(readArray(entries)).toBe(entries);
    for (const value of [undefined, null, 'abc', 3, { 0: 'a', length: 1 }]) {
      expect(readArray(value)).toEqual([]);
    }
  });
});
