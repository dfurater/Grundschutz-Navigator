import { describe, expect, it } from 'vitest';
import { buildWorkspaceGraph } from '@/domain/workspaceGraph';
import { member, body } from '@/test/fixtures/workspaceGraph';

describe('dokumentinterne Links lokaler Kataloge', () => {
  it('löst einen vorhandenen Control ohne Registry-Schlüssel auf', async () => {
    const c = member('catalog', 'c');
    (body(c).metadata as Record<string, unknown>).links = [{ href: '#ac-1' }];
    const before = JSON.stringify(c.source);
    const graph = await buildWorkspaceGraph({ members: [c] });
    expect(graph.edges[0]).toMatchObject({ state: 'resolved', to: { document: { kind: 'local', localId: 'c' }, kind: 'control', localId: 'ac-1' } });
    expect(graph.diagnostics).toHaveLength(0);
    expect(JSON.stringify(c.source)).toBe(before);
  });

  it('diagnostiziert doppelte Control-Ziele, ohne in andere Kataloge auszuweichen', async () => {
    const c = member('catalog', 'c');
    body(c).controls = [{ id: 'dup', title: 'A' }, { id: 'dup', title: 'B' }];
    (body(c).metadata as Record<string, unknown>).links = [{ href: '#dup' }, { href: '#missing' }];
    const graph = await buildWorkspaceGraph({ members: [c, member('catalog', 'other')] });
    expect(graph.edges.map(e => e.diagnostic?.code)).toEqual(['OSCAL_GRAPH_TARGET_AMBIGUOUS', 'OSCAL_GRAPH_TARGET_NOT_FOUND']);
  });
});
