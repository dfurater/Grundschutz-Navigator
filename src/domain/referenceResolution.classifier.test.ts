import { describe, expect, it, vi } from 'vitest';
import { createOscalReferenceClassifier, createReferenceDocument } from '@/domain/referenceResolution';

describe('wiederverwendbarer Referenzklassifikator',()=>{
  it('indiziert Ressourcen einmal und verfolgt ihre rlinks nicht',()=>{
    const resources=[{uuid:'11111111-1111-4111-8111-111111111111',rlinks:[{href:'https://example.invalid/data'}]}];
    const filtered=vi.spyOn(resources,'filter');
    const document=createReferenceDocument({source:{catalog:{'back-matter':{resources}}},rootType:'catalog',oscalVersion:'1.2.2',context:{}});
    const classify=createOscalReferenceClassifier({document});
    for(let index=0;index<100;index++)expect(classify({href:'#11111111-1111-4111-8111-111111111111',path:`/catalog/metadata/links/${index}/href`})).toMatchObject({kind:'resource',resource:{content:'available',rlinks:[]}});
    expect(filtered).toHaveBeenCalledTimes(1);
    filtered.mockRestore();
    expect(classify({href:'https://example.invalid/file',path:'/catalog/metadata/links/0/href'}).kind).toBe('external');
    expect(classify({href:'local.json',path:'/catalog/metadata/links/0/href'})).toMatchObject({kind:'unresolved',reason:'relative'});
    expect(classify({href:'profile.json',rel:'source-profile',path:'/catalog/metadata/links/0/href'}).kind).toBe('provenance');
  });
});
