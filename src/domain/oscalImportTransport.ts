import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';

export const TRANSPORT_MAX_OPERATIONS = 256;
export const TRANSPORT_MAX_CODE_UNITS = 32_768;
export type TransportOperation = ['object'] | ['array'] | ['end']
  | ['value', null | boolean | number]
  | ['key' | 'string', string, boolean];

type Cursor = { value: Record<string, unknown> | unknown[]; keys: string[] | null; index: number };

/** Only validated JSON trees enter this worker-side iterator. No full operation list. */
function* operations(source: unknown): Generator<TransportOperation> {
  const stack: Cursor[] = [];
  function* text(kind: 'key' | 'string', value: string): Generator<TransportOperation> {
    let offset = 0;
    do {
      const end = Math.min(value.length, offset + TRANSPORT_MAX_CODE_UNITS);
      yield [kind, value.slice(offset, end), end === value.length];
      offset = end;
    } while (offset < value.length);
  }
  function* value(item: unknown): Generator<TransportOperation> {
    if (typeof item === 'string') yield* text('string', item);
    else if (item === null || typeof item === 'boolean' || typeof item === 'number') yield ['value', item];
    else if (typeof item === 'object') {
      const array = Array.isArray(item);
      yield [array ? 'array' : 'object'];
      stack.push({ value: item as Cursor['value'], keys: array ? null : Object.keys(item), index: 0 });
    } else throw new Error('Invalid transport source');
  }
  yield* value(source);
  while (stack.length) {
    const cursor = stack.at(-1)!;
    if (cursor.index === (cursor.keys?.length ?? (cursor.value as unknown[]).length)) {
      stack.pop();
      yield ['end'];
    } else {
      const key = cursor.keys?.[cursor.index];
      const index = cursor.index++;
      if (key !== undefined) yield* text('key', key);
      yield* value(key === undefined ? (cursor.value as unknown[])[index] : (cursor.value as Record<string, unknown>)[key]);
    }
  }
}

export function* encodeOscalSource(source: unknown): Generator<TransportOperation[]> {
  let chunk: TransportOperation[] = [];
  let units = 0;
  for (const operation of operations(source)) {
    const size = typeof operation[1] === 'string' ? operation[1].length : 0;
    if (chunk.length && (chunk.length === TRANSPORT_MAX_OPERATIONS || units + size > TRANSPORT_MAX_CODE_UNITS)) {
      yield chunk;
      chunk = [];
      units = 0;
    }
    chunk.push(operation);
    units += size;
  }
  if (chunk.length) yield chunk;
}

type Target = { value: Record<string, unknown> | unknown[]; key: string | undefined };

/** Incremental protocol verification and construction; never walks the finished tree. */
export class OscalSourceDecoder {
  private root: unknown;
  private closed = false;
  private hasRoot = false;
  private readonly stack: Target[] = [];
  private pending: { kind: 'key' | 'string'; value: string } | undefined;
  private nodes = 0;
  private units = 0;

  accept(input: unknown): void {
    if (this.closed) this.fail();
    if (!Array.isArray(input) || !input.length || input.length > TRANSPORT_MAX_OPERATIONS) this.fail();
    let chunkUnits = 0;
    for (const operation of input) {
      if (!Array.isArray(operation)) this.fail();
      chunkUnits += this.acceptOperation(operation);
      if (chunkUnits > TRANSPORT_MAX_CODE_UNITS) this.fail();
    }
  }

  private acceptOperation(operation: unknown[]): number {
    const [kind, value, last] = operation;
    if (kind === 'key' || kind === 'string') {
      if (operation.length !== 3 || typeof value !== 'string' || typeof last !== 'boolean') this.fail();
      this.acceptText(kind, value, last);
      return value.length;
    }
    if (this.pending) this.fail();
    if (kind === 'value') {
      if (operation.length !== 2 || !this.isPrimitive(value)) this.fail();
      this.insert(value);
    } else {
      if (operation.length !== 1) this.fail();
      this.acceptContainer(kind);
    }
    return 0;
  }

  private isPrimitive(value: unknown): boolean {
    return value === null || typeof value === 'boolean'
      || (typeof value === 'number' && !Number.isNaN(value));
  }

  private acceptText(kind: 'key' | 'string', value: string, last: boolean): void {
    this.units += value.length;
    if (value.length > TRANSPORT_MAX_CODE_UNITS || this.units > CLASS_2_IMPORT_LIMITS.maxBytes) this.fail();
    if (!last && !value.length) this.fail();
    if (this.pending && this.pending.kind !== kind) this.fail();
    this.pending ??= { kind, value: '' };
    this.pending.value += value;
    if (!last) return;
    const text = this.pending.value;
    this.pending = undefined;
    if (kind === 'key') this.key(text);
    else this.insert(text);
  }

  private acceptContainer(kind: unknown): void {
    if (kind === 'object' || kind === 'array') {
      const container = kind === 'array' ? [] : {};
      this.insert(container);
      this.stack.push({ value: container, key: undefined });
    } else if (kind === 'end') {
      const target = this.stack.pop();
      if (!target || target.key !== undefined) this.fail();
    } else this.fail();
  }

  private key(key: string): void {
    const target = this.stack.at(-1);
    if (!target || Array.isArray(target.value) || target.key !== undefined || Object.hasOwn(target.value, key)) this.fail();
    target.key = key;
  }

  private insert(value: unknown): void {
    if (++this.nodes > CLASS_2_IMPORT_LIMITS.maxNodes || this.stack.length + 1 > CLASS_2_IMPORT_LIMITS.maxDepth) this.fail();
    const target = this.stack.at(-1);
    if (!target) {
      if (this.hasRoot) this.fail();
      this.hasRoot = true;
      this.root = value;
    } else if (Array.isArray(target.value)) target.value.push(value);
    else {
      if (target.key === undefined) this.fail();
      Object.defineProperty(target.value, target.key, { value, writable: true, enumerable: true, configurable: true });
      target.key = undefined;
    }
  }

  finish(): unknown {
    if (this.closed || !this.hasRoot || this.stack.length || this.pending) this.fail();
    const source = this.root;
    this.dispose();
    return source;
  }

  dispose(): void {
    this.closed = true;
    this.root = undefined;
    this.stack.length = 0;
    this.pending = undefined;
  }

  private fail(): never {
    this.dispose();
    throw new Error('Invalid OSCAL transport');
  }
}
