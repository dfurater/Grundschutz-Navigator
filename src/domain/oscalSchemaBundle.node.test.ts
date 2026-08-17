// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import viteConfig from '../../vite.config';
import { listSchemaPins } from './oscalVersionMatrix.mjs';

describe('Bauzeitvertrag des Schema-Bundles', () => {
  it('baut den Import-Worker als ES-Modul, damit Stufe 3 je Zelle splittet', async () => {
    // Ohne dieses Format baut Vite den Worker als IIFE. Ein IIFE kann nicht
    // code-splitten: Alle 30 Schemas lägen dann in einer einzigen Worker-Datei
    // und würden bei jedem Import geladen. Die Zusage „nur die ausgewählte
    // Zelle" hinge damit an einer stillen Vite-Vorgabe.
    const config = await viteConfig({ command: 'build', mode: 'production' });

    expect(config.worker?.format).toBe('es');
  });

  it('führt jeden Schemapfad als festes Literal, nicht als zusammengesetzten Pfad', async () => {
    // Ein aus Daten gebauter Importpfad wäre zur Bauzeit nicht analysierbar
    // und zur Laufzeit eine Pfadinjektion. Die Tabelle muss ausgeschrieben
    // bleiben.
    const source = await readFile('src/domain/oscalSchemaBundle.ts', 'utf8');
    const literalImports = source.match(/import\('\.\.\/\.\.\/schemas\/oscal\/v[0-9.]+\/[a-z_-]+\.json'\)/g);

    // Jeder `import(` im Modul muss einer dieser 30 Literale sein: Sind beide
    // Zählungen gleich, gibt es keinen weiteren, dynamisch gebauten Ladeweg.
    expect(literalImports).toHaveLength(30);
    expect(source.match(/\bimport\(/g)).toHaveLength(30);
  });

  it('bindet jedes Literal an den vendorPath genau seiner Matrixzelle', async () => {
    // Die Pfade sind bewusst relativ statt über `@/` geschrieben — der Alias
    // zeigt auf `./src/`, und `schemas/oscal/` liegt außerhalb. Was ein Alias
    // an Wartbarkeit brächte, leistet diese Bindung besser: Sie fängt nicht nur
    // ein verschobenes Verzeichnis, sondern auch ein Literal, das zwar auflöst,
    // aber auf die Datei der falschen Zelle zeigt.
    const source = await readFile('src/domain/oscalSchemaBundle.ts', 'utf8');

    for (const pin of listSchemaPins()) {
      const entry = `'${pin.rootKey}@${pin.oscalVersion}': () => import('../../${pin.vendorPath}')`;
      expect(source, `${pin.rootKey} @ ${pin.oscalVersion}`).toContain(entry);
      await expect(stat(pin.vendorPath)).resolves.toBeDefined();
    }
  });
});
