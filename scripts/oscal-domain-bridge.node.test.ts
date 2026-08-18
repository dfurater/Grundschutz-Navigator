import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

/**
 * Die CI-Lane ist ein reines Node-Skript. Dieser Test beweist, dass sie
 * denselben TypeScript-Klassifikator ausführt wie App und Unit-Tests — deshalb
 * läuft er in einem echten Node-Kindprozess und nicht in der Vitest-Pipeline,
 * die den Alias ohnehin auflöst.
 */
async function runInPlainNode(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { cwd: resolve(import.meta.dirname, '..'), timeout: 60_000 },
  );
  return stdout.trim();
}

const bridgeUrl = pathToFileURL(resolve(import.meta.dirname, 'oscal-domain-bridge.mjs')).href;

describe('Node-Brücke in die OSCAL-Domänenschicht', () => {
  it('lädt Adapter, Graph und Politik unter reinem Node', async () => {
    const output = await runInPlainNode(`
      const { loadOscalDomain } = await import(${JSON.stringify(bridgeUrl)});
      const domain = await loadOscalDomain();
      console.log(Object.keys(domain).sort().join(','));
    `);

    expect(output).toBe(
      [
        'buildReferenceGraph',
        'evaluateReferenceGraph',
        'formatReferenceGraphSummary',
        'parseOscalDocument',
        'toReferenceGraphReport',
      ].join(','),
    );
  });

  it('klassifiziert eine unbekannte Fragmentreferenz unter reinem Node identisch', async () => {
    const output = await runInPlainNode(`
      const { loadOscalDomain } = await import(${JSON.stringify(bridgeUrl)});
      const domain = await loadOscalDomain();
      const source = {
        catalog: {
          uuid: '11111111-1111-4111-8111-111111111111',
          metadata: {
            title: 'Fixture',
            'last-modified': '2026-08-18T00:00:00Z',
            version: '1.0',
            'oscal-version': '1.1.3',
          },
          groups: [{
            id: 'GRP',
            title: 'Gruppe',
            props: [{ name: 'alt-identifier', value: 'grp' }],
            controls: [{
              id: 'C.1',
              title: 'Control',
              props: [{ name: 'alt-identifier', value: 'ctl' }],
              links: [{ href: '#C.99', rel: 'related' }],
            }],
          }],
        },
      };
      const parsed = domain.parseOscalDocument(source, {
        trustClass: 'class-1-verified-public',
        catalogKey: 'gspp',
      });
      const graph = domain.buildReferenceGraph({
        documents: [{
          artifactKey: 'catalog-fixture',
          lifecycle: 'supported',
          rootType: 'catalog',
          oscalVersion: '1.1.3',
          catalogKey: 'gspp',
          source,
          view: parsed.view,
        }],
      });
      console.log(graph.diagnostics.map((diagnostic) => diagnostic.signature).join(';'));
    `);

    expect(output).toBe(
      'reference-graph@1|OSCAL_GRAPH_TARGET_NOT_FOUND|/catalog/groups/0/controls/0/links/0/href',
    );
  });
});
