// @vitest-environment node
// =============================================================================
// Positivkorpus — Anwenderkatalog Lieferkettensicherheit (GSPP-242)
//
// Der Katalog wird nie committet, sondern bei jedem Build frisch von BSI
// geholt. Deshalb leitet diese Datei **jede** Zahl aus dem geladenen Snapshot
// selbst ab und vergleicht Quelle gegen Projektion. Assertions gegen "genau 146
// Controls" wären beim nächsten Upstream-Update rot, ohne dass etwas kaputt
// ist — das Akzeptanzkriterium verlangt ausdrücklich die Prüfung gegen den
// jeweils gepinnten Snapshot statt gegen fest verdrahtete Werte.
//
// Die Eigenheiten dieses Katalogs sind der eigentliche Prüfgegenstand: Er hat
// **kein** `back-matter`, alle Fragment-Links treffen `control/@id`-Werte
// desselben Katalogs, und sein Prop-Set ist deutlich schmaler als das des
// Grundschutz++-Katalogs (kein `label`, keine Schutzziele, keine `threats`).
//
// Ohne `npm run fetch-catalog` fehlt die Datei; die Suite wird dann
// übersprungen statt fehlzuschlagen.
// =============================================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseCatalogDocument } from './oscalDocument';
import { projectResolvedControlLinks } from '@/domain/catalogReferenceProjection';
import {
  referenceDocumentFromCatalog,
  resolveCatalogControlReferences,
} from '@/domain/referenceResolution';
import type { Catalog } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';

const LIEFERKETTE_KEY = 'lieferkette' as const satisfies CatalogKey;
const ENTRY_KEY = 'gspp' as const satisfies CatalogKey;

const lieferkettePath =
  process.env.GSPP_LIEFERKETTE_CORPUS_PATH ?? 'public/data/catalog-lieferkette.json';
const entryPath = process.env.GSPP_CATALOG_CORPUS_PATH ?? 'public/data/catalog.json';
const lieferketteAvailable = existsSync(lieferkettePath);
const bothAvailable = lieferketteAvailable && existsSync(entryPath);

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function loadCorpus(path: string, catalogKey: CatalogKey) {
  const original = JSON.parse(readFileSync(path, 'utf8'));

  return {
    original,
    body: (original as { catalog: JsonObject }).catalog,
    document: projectResolvedControlLinks(
      parseCatalogDocument(original, {
        catalogKey,
        trustClass: 'class-1-verified-public',
      }),
    ),
  };
}

/** Zählt Controls, Gruppen und Top-Level-Bereiche direkt am Quellgraphen. */
function countSourceStructure(body: JsonObject) {
  let controls = 0;
  let groups = 0;
  const controlIds = new Set<string>();

  const visitControls = (candidates: readonly unknown[]): void => {
    for (const candidate of candidates) {
      if (!isJsonObject(candidate)) continue;
      controls += 1;
      if (typeof candidate.id === 'string') controlIds.add(candidate.id);
      visitControls(readArray(candidate.controls));
    }
  };
  const visitGroups = (candidates: readonly unknown[]): void => {
    for (const candidate of candidates) {
      if (!isJsonObject(candidate)) continue;
      groups += 1;
      visitControls(readArray(candidate.controls));
      visitGroups(readArray(candidate.groups));
    }
  };

  visitGroups(readArray(body.groups));
  visitControls(readArray(body.controls));

  return {
    controls,
    groups,
    topLevelGroups: readArray(body.groups).length,
    controlIds,
  };
}

/** Alle `control/link`-Einträge des Quellgraphen, in Dokumentreihenfolge. */
function collectSourceControlLinks(body: JsonObject) {
  const links: { controlId: string; href: string; rel?: string }[] = [];

  const visitControls = (candidates: readonly unknown[]): void => {
    for (const candidate of candidates) {
      if (!isJsonObject(candidate)) continue;
      const controlId = typeof candidate.id === 'string' ? candidate.id : '';
      for (const link of readArray(candidate.links)) {
        if (!isJsonObject(link) || typeof link.href !== 'string') continue;
        links.push({
          controlId,
          href: link.href,
          rel: typeof link.rel === 'string' ? link.rel : undefined,
        });
      }
      visitControls(readArray(candidate.controls));
    }
  };
  const visitGroups = (candidates: readonly unknown[]): void => {
    for (const candidate of candidates) {
      if (!isJsonObject(candidate)) continue;
      visitControls(readArray(candidate.controls));
      visitGroups(readArray(candidate.groups));
    }
  };

  visitGroups(readArray(body.groups));
  visitControls(readArray(body.controls));
  return links;
}

/** Alle Control-`prop`-Namen mit dem jeweils vorgefundenen `ns`. */
function collectSourceControlProps(body: JsonObject) {
  const nsByName = new Map<string, Set<string | undefined>>();

  const visitControls = (candidates: readonly unknown[]): void => {
    for (const candidate of candidates) {
      if (!isJsonObject(candidate)) continue;
      for (const prop of readArray(candidate.props)) {
        if (!isJsonObject(prop) || typeof prop.name !== 'string') continue;
        const seen = nsByName.get(prop.name) ?? new Set<string | undefined>();
        seen.add(typeof prop.ns === 'string' ? prop.ns : undefined);
        nsByName.set(prop.name, seen);
      }
      visitControls(readArray(candidate.controls));
    }
  };
  const visitGroups = (candidates: readonly unknown[]): void => {
    for (const candidate of candidates) {
      if (!isJsonObject(candidate)) continue;
      visitControls(readArray(candidate.controls));
      visitGroups(readArray(candidate.groups));
    }
  };

  visitGroups(readArray(body.groups));
  visitControls(readArray(body.controls));
  return nsByName;
}

describe.skipIf(!lieferketteAvailable)('Lieferkettenkatalog am realen Snapshot', () => {
  let corpus: ReturnType<typeof loadCorpus> | null = null;

  beforeAll(() => {
    corpus = loadCorpus(lieferkettePath, LIEFERKETTE_KEY);
  });

  function current(): ReturnType<typeof loadCorpus> {
    if (corpus === null) throw new Error('Lieferkettenkorpus wurde nicht geladen.');
    return corpus;
  }

  it('wird als eigenständiger Katalog unter seinem catalogKey geführt', () => {
    const { document, body } = current();

    expect(document.view.catalogKey).toBe(LIEFERKETTE_KEY);
    // Die fachliche Identität kommt aus dem `catalogKey`, nicht aus der
    // Dokument-`uuid` — die trägt `change-on-write` und wechselt bei jedem
    // Upstream-Update.
    expect(document.view.uuid).toBe(body.uuid);
    expect(document.view.catalogKey).not.toBe(document.view.uuid);
  });

  it('bildet Control-, Gruppen- und Bereichszahlen des Snapshots ab', () => {
    const { document, body } = current();
    const source = countSourceStructure(body);

    // Untergrenze, damit der Vergleich nicht trivial leer durchläuft.
    expect(source.controls).toBeGreaterThan(0);
    expect(source.topLevelGroups).toBeGreaterThan(0);

    expect(document.view.totalControls).toBe(source.controls);
    expect(document.view.controls).toHaveLength(source.controls);
    expect(document.view.practices).toHaveLength(source.topLevelGroups);

    const projectedGroups =
      document.view.practices.length +
      document.view.practices.reduce((sum, practice) => sum + practice.topics.length, 0);
    expect(projectedGroups).toBe(source.groups);
  });

  it('deklariert OSCAL 1.1.3 und gibt metadata.version unverändert wieder', () => {
    const { document, body } = current();
    const metadata = body.metadata as JsonObject;

    expect(document.view.metadata.oscalVersion).toBe('1.1.3');
    expect(document.view.metadata.oscalVersion).toBe(metadata['oscal-version']);
    // Freier String laut Metaschema: unverändert durchgereicht, nicht geparst
    // und nicht sortiert.
    expect(document.view.metadata.version).toBe(metadata.version);
    expect(typeof document.view.metadata.version).toBe('string');
  });

  it('trägt kein back-matter und erzeugt daraus weder Fehler noch Ressourcensektion', () => {
    const { document, body } = current();

    expect(body['back-matter']).toBeUndefined();
    expect(document.view.backMatter).toEqual([]);
  });

  it('löst jeden Fragment-Link gegen control/@id desselben Katalogs auf', () => {
    const { document, body } = current();
    const sourceLinks = collectSourceControlLinks(body);
    const structure = countSourceStructure(body);

    // Untergrenze: ohne Links wäre der Nachweis gegenstandslos.
    expect(sourceLinks.length).toBeGreaterThan(0);
    // Der Katalog hat kein `back-matter`. Eine Auflösung ausschließlich gegen
    // `back-matter` würde deshalb sämtliche Links als gebrochen melden.
    expect(sourceLinks.every((link) => link.href.startsWith('#'))).toBe(true);
    expect(
      sourceLinks.every((link) => structure.controlIds.has(link.href.slice(1))),
    ).toBe(true);

    const references = resolveCatalogControlReferences({
      document: referenceDocumentFromCatalog(document),
      catalogsByKey: new Map<CatalogKey, Catalog>([[LIEFERKETTE_KEY, document.view]]),
    });
    const resolved = [...references.values()].flat();

    expect(resolved).toHaveLength(sourceLinks.length);
    for (const reference of resolved) {
      // Die Zielart folgt aus dem Fragment, nicht aus dem `rel`-Wert.
      expect(reference.kind).toBe('control');
      if (reference.kind === 'control') {
        expect(reference.catalogKey).toBe(LIEFERKETTE_KEY);
        expect(structure.controlIds.has(reference.control.id)).toBe(true);
      }
    }
  });

  it('erhält die rel-Werte related und required unverändert', () => {
    const { document, body } = current();
    const sourceLinks = collectSourceControlLinks(body);

    const sourceRelCounts = new Map<string, number>();
    for (const link of sourceLinks) {
      const rel = link.rel ?? '<kein rel>';
      sourceRelCounts.set(rel, (sourceRelCounts.get(rel) ?? 0) + 1);
    }
    // Beide Werte kommen im Bestand real vor; ohne sie liefe der Nachweis leer.
    expect(sourceRelCounts.get('related')).toBeGreaterThan(0);
    expect(sourceRelCounts.get('required')).toBeGreaterThan(0);

    const projectedRelCounts = new Map<string, number>();
    for (const control of document.view.controls) {
      for (const link of control.links) {
        const rel = link.rel ?? '<kein rel>';
        projectedRelCounts.set(
          rel,
          (projectedRelCounts.get(rel) ?? 0) + 1,
        );
      }
    }

    // Keine Coercion: Anzahl **und** Bezeichnung bleiben je Relation erhalten.
    expect(projectedRelCounts.get('related')).toBe(sourceRelCounts.get('related'));
    expect(projectedRelCounts.get('required')).toBe(sourceRelCounts.get('required'));
    expect([...projectedRelCounts.keys()].sort()).toEqual(['related', 'required']);
  });

  it('übernimmt den vorgefundenen prop.ns unverändert, einschließlich seines Fehlens', () => {
    const { document, body } = current();
    const sourceProps = collectSourceControlProps(body);

    // Beide Fälle sind in diesem Katalog real: `alt-identifier` trägt keinen
    // `ns`, die Vokabular-Props zeigen auf die BSI-CSVs.
    expect(sourceProps.get('alt-identifier')).toEqual(new Set([undefined]));
    const secLevelNs = [...(sourceProps.get('sec_level') ?? [])];
    expect(secLevelNs).toHaveLength(1);
    expect(secLevelNs[0]).toMatch(/^https:\/\/github\.com\/BSI-Bund\//);

    for (const control of document.view.controls) {
      // Kein projekteigener Namensraum, kein normalisierter fremder.
      expect(control.securityLevelProp?.ns).toBe(secLevelNs[0]);
      expect(control.tagsProp?.ns ?? null).toBe(
        control.tagsProp ? [...(sourceProps.get('tags') ?? [])][0] : null,
      );
    }
  });

  it('führt die fehlenden Schutzziel-, Bedrohungs- und label-Props als Abwesenheit, nicht als Fehler', () => {
    const { document, body } = current();
    const sourceProps = collectSourceControlProps(body);

    // Vorbedingung des Nachweises: diese Props existieren hier wirklich nicht.
    for (const absent of [
      'confidentiality',
      'integrity',
      'availability',
      'authenticity',
      'threats',
      'label',
    ]) {
      expect(sourceProps.has(absent)).toBe(false);
    }

    for (const control of document.view.controls) {
      expect(control.confidentiality).toBeUndefined();
      expect(control.integrity).toBeUndefined();
      expect(control.availability).toBeUndefined();
      expect(control.authenticity).toBeUndefined();
      expect(control.threats).toEqual([]);
      // Ohne `label`-Prop bleibt der Titel die Anzeigequelle.
      expect(control.title).toBeTruthy();
    }
  });

  it('setzt keine Übereinstimmung der Props mit dem Grundschutz++-Katalog voraus', () => {
    const { body } = current();
    const propNames = [...collectSourceControlProps(body).keys()].sort();

    // Das schmale Prop-Set ist der Prüfgegenstand: Der Katalog wird vollständig
    // verarbeitet, obwohl er die Grundschutz++-Props nicht führt.
    expect(propNames).toEqual(['alt-identifier', 'effort_level', 'sec_level', 'tags']);
  });
});

const vocabulariesPath =
  process.env.GSPP_VOCABULARIES_CORPUS_PATH ?? 'public/data/vocabularies.json';
const vocabulariesAvailable = lieferketteAvailable && existsSync(vocabulariesPath);

describe.skipIf(!vocabulariesAvailable)('Vokabulare des Lieferkettenkatalogs', () => {
  it('liefert jeden referenzierten Namensraum aus demselben Snapshot mit', () => {
    const { body } = loadCorpus(lieferkettePath, LIEFERKETTE_KEY);
    const vocabularies = JSON.parse(readFileSync(vocabulariesPath, 'utf8')) as {
      sourceCommitSha: string;
      namespaces: { source: { fileName: string; commitSha?: string } }[];
    };

    // Referenzierte Namensräume direkt am Quellgraphen erheben: die
    // Vokabular-Membership wird aus allen ausgelieferten Katalogen abgeleitet,
    // nicht nur aus dem Einstiegskatalog.
    const referenced = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (!isJsonObject(value)) return;
      if (typeof value.ns === 'string' && value.ns.endsWith('.csv')) {
        referenced.add(value.ns.split('/').pop()!);
      }
      for (const child of Object.values(value)) walk(child);
    };
    walk(body);

    // Untergrenze: ohne Referenzen liefe der Nachweis leer durch.
    expect(referenced.size).toBeGreaterThan(0);

    const shipped = new Set(
      vocabularies.namespaces.map((namespace) => namespace.source.fileName),
    );
    const missing = [...referenced].filter((fileName) => !shipped.has(fileName));
    expect(missing).toEqual([]);
    expect(vocabularies.sourceCommitSha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe.skipIf(!bothAvailable)('Gleiche Control-IDs in beiden Katalogen', () => {
  it('führt kollidierende IDs getrennt, ohne Fehler und ohne Zusammenführung', () => {
    const lieferkette = loadCorpus(lieferkettePath, LIEFERKETTE_KEY);
    const entry = loadCorpus(entryPath, ENTRY_KEY);

    const shared = [...lieferkette.document.view.controlsById.keys()].filter((id) =>
      entry.document.view.controlsById.has(id),
    );
    // Untergrenze: ohne Kollision wäre der Nachweis gegenstandslos. Bei
    // `identifier-uniqueness="local"` ist sie der erwartete Normalfall.
    expect(shared.length).toBeGreaterThan(0);

    for (const id of shared) {
      const fromLieferkette = lieferkette.document.view.controlsById.get(id);
      const fromEntry = entry.document.view.controlsById.get(id);

      // Getrennt geführt: zwei eigene Objekte, nie dasselbe zusammengeführte.
      expect(fromLieferkette).toBeDefined();
      expect(fromEntry).toBeDefined();
      expect(fromLieferkette).not.toBe(fromEntry);
    }

    // Und nie gegeneinander verlinkt: jeder aufgelöste Link eines Katalogs
    // zeigt ausschließlich auf ein Control desselben Katalogs.
    for (const control of lieferkette.document.view.controls) {
      for (const link of control.links) {
        expect(lieferkette.document.view.controlsById.has(link.targetId)).toBe(true);
      }
    }
  });
});
