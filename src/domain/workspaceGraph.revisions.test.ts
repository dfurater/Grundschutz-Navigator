import { describe, expect, it } from 'vitest';
import { buildWorkspaceGraph } from '@/domain/workspaceGraph';
import { bind, body, member } from '@/test/fixtures/workspaceGraph';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';

describe('Snapshot- und Schema-Grenzen des Verbundgraphen',()=>{
  it('berechnet bei savedAt-Änderungen des Profils und seines Ziels neu',async()=>{
    const p=member('profile','p');const c=member('catalog','c');
    const input={members:[p,c],bindings:[bind(p,'/profile/imports/0/href',c)]};
    const first=(await buildWorkspaceGraph(input)).resolutions[0];
    expect(first.status).toBe('resolved');if(first.status!=='resolved')return;
    const changedProfile={...p,savedAt:'2026-10-18T01:00:00Z'};
    const second=(await buildWorkspaceGraph({...input,members:[changedProfile,c]})).resolutions[0];
    expect(second.status).toBe('resolved');if(second.status!=='resolved')return;
    expect(second.source).not.toBe(first.source);expect(second.source).toEqual(first.source);
    const third=(await buildWorkspaceGraph({...input,members:[changedProfile,{...c,savedAt:'2026-10-18T02:00:00Z'}]})).resolutions[0];
    expect(third.status).toBe('resolved');if(third.status==='resolved')expect(third.source).not.toBe(second.source);
  });
  it.each(['1.1.2','1.1.3','1.2.1','1.2.2'] as const)('prüft profile.import ohne href in %s an der bestehenden Eingangsgrenze',async version=>{
    const p=member('profile','p',version);body(p).imports=[{'include-all':{}}];
    const result=await processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(p.source)),{trustClass:'class-2-local-user'});
    if(version==='1.1.2'||version==='1.1.3'){
      expect(result).toMatchObject({ok:false,diagnostic:{stage:'json-schema'}});
    }else{
      expect(result.ok).toBe(true);
      const graph=await buildWorkspaceGraph({members:[p]});
      expect(graph.edges[0]).toMatchObject({state:'missing-source',diagnostic:{code:'OSCAL_GRAPH_IMPORT_SOURCE_MISSING'}});
    }
  });
  it('nimmt einen POA&M mit system-id ohne import-ssp und Assessment Results auf',async()=>{
    const poam=member('plan-of-action-and-milestones','poam');body(poam)['system-id']={id:'synthetic-system'};
    const graph=await buildWorkspaceGraph({members:[poam]});
    expect(graph.members).toHaveLength(1);expect(graph.edges).toHaveLength(0);expect(graph.diagnostics).toHaveLength(0);
  });
});
