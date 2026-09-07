import { describe, expect, it } from 'vitest';
import { encodeOscalSource, OscalSourceDecoder, TRANSPORT_MAX_CODE_UNITS, TRANSPORT_MAX_OPERATIONS } from '@/domain/oscalImportTransport';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';

function roundTrip(source: unknown): unknown {
  const decoder = new OscalSourceDecoder();
  for (const operations of encodeOscalSource(source)) decoder.accept(operations);
  return decoder.finish();
}

describe('bounded OSCAL source transport', () => {
  it('preserves unknown data, order, negative zero, Unicode and own prototype-like keys', () => {
    const source = JSON.parse('{"__proto__":{"x":1},"constructor":[],"":null}');
    source.values = [-0, true, false, null, {}, [], '\ud800🦉\udfff'];
    expect(roundTrip(source)).toEqual(source);
    expect(Object.getPrototypeOf(roundTrip(source))).toBe(Object.prototype);
    expect(Object.is((roundTrip(source) as typeof source).values[0], -0)).toBe(true);
  });
  it('bounds each chunk and splits both keys and strings without losing code units', () => {
    const key = 'k'.repeat(TRANSPORT_MAX_CODE_UNITS * 3 + 1);
    const source = { [key]: '\ud800'.repeat(TRANSPORT_MAX_CODE_UNITS * 4 + 2), values: Array.from({ length: 1000 }, (_, i) => i) };
    let count = 0;
    for (const operations of encodeOscalSource(source)) {
      count++;
      expect(operations.length).toBeLessThanOrEqual(TRANSPORT_MAX_OPERATIONS);
      expect(operations.reduce((n, op) => n + (typeof op[1] === 'string' ? op[1].length : 0), 0)).toBeLessThanOrEqual(TRANSPORT_MAX_CODE_UNITS);
    }
    expect(count).toBeGreaterThan(8);
    expect(roundTrip(source)).toEqual(source);
  });
  it.each([
    null, [], Array.from({ length: 257 }, () => ['value', null]),
    [['bogus']], [['end']], [['value', NaN]], [['value', undefined]],
    [['object', 0]], [['key', 'x', true]], [['array'], ['key', 'x', true]],
    [['object'], ['value', 1]], [['object'], ['key', 'x', true], ['end']],
    [['object'], ['key', 'x', true], ['key', 'y', true]],
    [['object'], ['key', 'x', true], ['value', 1], ['key', 'x', true]],
    [['string', '', false]], [['string', 'a', false], ['value', 0]],
    [['string', 'a', false], ['key', 'b', true]],
    [['string', 'a', 1]], [['string', 'a'.repeat(32769), true]],
    [['value', 1], ['value', 2]], [['value', 1, 'extra']],
  ].map(operations => [operations]))('rejects malformed operations %#', (operations) => {
    expect(() => new OscalSourceDecoder().accept(operations)).toThrow();
  });
  it.each([[], [['object']], [['string', 'a', false]]].map(operations => [operations]))('rejects truncated trees %#', (operations) => {
    const decoder = new OscalSourceDecoder();
    if (operations.length) decoder.accept(operations);
    expect(() => decoder.finish()).toThrow();
  });
  it('rejects cumulative node, depth and text overflows', () => {
    const nodes = new OscalSourceDecoder(); nodes.accept([['array']]);
    const chunk = Array.from({ length: 256 }, () => ['value', null]);
    expect(() => { for (let i = 0;i < 4000;i++) nodes.accept(chunk); }).toThrow();
    const depth = new OscalSourceDecoder();
    expect(() => depth.accept(Array.from({ length: CLASS_2_IMPORT_LIMITS.maxDepth + 2 }, () => ['array']))).toThrow();
    const text = new OscalSourceDecoder();
    expect(() => { for (let i = 0;i < 321;i++) text.accept([['string', 'x'.repeat(32768), false]]); }).toThrow();
  });
  it('does not allow using a decoder after finish, failure or disposal', () => {
    for (const action of ['finish', 'fail', 'dispose']) {
      const decoder = new OscalSourceDecoder();
      if (action === 'finish') { decoder.accept([['value', 1]]); decoder.finish(); }
      else if (action === 'fail') { expect(() => decoder.accept(null)).toThrow(); }
      else decoder.dispose();
      expect(() => decoder.accept([['value', 2]])).toThrow();
      expect(() => decoder.finish()).toThrow();
    }
  });
});

it('preserves parser-produced infinities without broadening the existing object contract', () => {
  expect(roundTrip(JSON.parse('[1e400,-1e400,-0]'))).toEqual([Infinity, -Infinity, -0]);
});

it('preserves a tree whose leaf is exactly at maximum depth', () => {
  let source: unknown = 'leaf';
  for (let depth = 1; depth < CLASS_2_IMPORT_LIMITS.maxDepth; depth++) source = { child: source };
  expect(roundTrip(source)).toEqual(source);
});
