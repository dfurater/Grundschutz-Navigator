import { expectTypeOf, it } from 'vitest';
import type { LocalId, VerbundId } from '@/domain/workspaceModel';

it('keeps document IDs, verbund IDs and unchecked strings distinct at compile time', () => {
  expectTypeOf<LocalId>().not.toExtend<VerbundId>();
  expectTypeOf<VerbundId>().not.toExtend<LocalId>();
  expectTypeOf<string>().not.toExtend<LocalId>();
  expectTypeOf<string>().not.toExtend<VerbundId>();
});
