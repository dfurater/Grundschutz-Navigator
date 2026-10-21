import { expect, it } from 'vitest';
import { OSCAL_ROOT_KEYS } from '@/domain/oscalVersionMatrix';
import { OSCAL_ROOT_UUID_POLICY, rootUuidPolicy } from './rootUuidPolicy';

it('covers every root and keeps the documented policy', () => {
  expect(Object.keys(OSCAL_ROOT_UUID_POLICY).sort()).toEqual([...OSCAL_ROOT_KEYS].sort());
  expect(OSCAL_ROOT_KEYS.filter(root => rootUuidPolicy(root) === 'reassign')).toEqual(['catalog', 'profile', 'mapping-collection', 'component-definition']);
  expect(OSCAL_ROOT_KEYS.filter(root => rootUuidPolicy(root) === 'keep')).toEqual(['system-security-plan', 'assessment-plan', 'assessment-results', 'plan-of-action-and-milestones']);
});
