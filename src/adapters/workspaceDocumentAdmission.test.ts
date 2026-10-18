import { expect, it } from 'vitest';
import { assertState, pointerValue } from '@/adapters/workspaceDocumentAdmission';

it('decodes pointer escapes once in RFC 6901 order', () => {
  const source = { 'a~1': 'TILDE', 'a/': 'SLASH', '': ['ARRAY'] };
  expect(pointerValue(source, '/a~01')).toBe('TILDE');
  expect(pointerValue(source, '/a~1')).toBe('SLASH');
  expect(pointerValue(source, '//0')).toBe('ARRAY');
});
it.each(['', '/a~2', '/missing', '/toString'])('rejects malformed or missing own pointer targets %s', pointer => {
  expect(() => pointerValue({}, pointer)).toThrow('WORKSPACE_BINDING_INVALID');
});
it('rejects an invalid document state without echoing its contents', () => {
  expect(() => assertState('PRIVATE_SENTINEL' as Parameters<typeof assertState>[0])).toThrow('WORKSPACE_DOCUMENT_INVALID');
});
