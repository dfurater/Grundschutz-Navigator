// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_BSI_REPOSITORY_URL, OFFICIAL_BSI_REPO } from './security-guards.mjs';
import { SOURCE_REGISTRY } from '../src/domain/sourceRegistry.mjs';
import {
  buildVocabularyNamespaceData,
  extractReferencedNamespaceUrls,
  materializeVocabularyCollectionMembers,
  namespaceUrlToRepoPath,
  parseCsv,
  parseVocabularyCsv,
  sha256Hex,
} from './vocabulary-utils.mjs';

const repository = OFFICIAL_BSI_REPO;
const vocabularyCollection = SOURCE_REGISTRY.find(
  (entry) => entry.kind === 'vocabulary-collection' && entry.lifecycle === 'supported',
);

if (!vocabularyCollection) {
  throw new Error('Source registry must declare a supported vocabulary collection');
}

const upstreamDirectory = `${vocabularyCollection.upstreamDirectory}`;
const fileSuffix = `${vocabularyCollection.fileSuffix}`;

function namespaceUrlFor(fileName: string) {
  return `${OFFICIAL_BSI_REPOSITORY_URL}/tree/main/${upstreamDirectory}/${fileName}`;
}

function treeFile(fileName: string) {
  return { path: `${upstreamDirectory}/${fileName}` };
}

const RESULT_NAMESPACE_URL = namespaceUrlFor('result.csv');
const ACTION_WORDS_NAMESPACE_URL = namespaceUrlFor('action_words.csv');

describe('sha256Hex Eingabetypen', () => {
  const input = 'Vokabular äöü';

  it('hasht String-Eingaben als UTF-8', () => {
    const expected = createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex');
    expect(sha256Hex(input)).toBe(expected);
  });

  it('nutzt Buffer-Eingaben unverändert', () => {
    const buffer = Buffer.from(input, 'utf8');
    const expected = createHash('sha256').update(buffer).digest('hex');
    expect(sha256Hex(buffer)).toBe(expected);
  });

  it('konvertiert Uint8Array-Eingaben byteidentisch', () => {
    const bytes = new TextEncoder().encode(input);
    const expected = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    expect(sha256Hex(bytes)).toBe(expected);
  });
});

describe('parseCsv Zeilenabschlüsse und Zeichenverbrauch', () => {
  it('behandelt CRLF als einzelnen Abschluss ohne Phantomzeilen', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('unterstützt LF- und CR-only-Zeilenabschlüsse identisch', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('erzeugt keinen Leereintrag bei abschließendem Zeilenabschluss', () => {
    expect(parseCsv('a,b\r\n')).toEqual([['a', 'b']]);
  });

  it('übernimmt eine letzte Zeile auch ohne Zeilenabschluss', () => {
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
  });

  it('filtert Zeilen ohne Inhalt heraus', () => {
    expect(parseCsv('a,b\r\n\r\n\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('liefert leeres Array für leere Eingabe', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('ignoriert Kommas innerhalb von Anführungszeichen', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('verbraucht maskierte Anführungszeichen als ein Zeichenpaar', () => {
    expect(parseCsv('a,"x""y"')).toEqual([['a', 'x"y']]);
  });
});

describe('deterministische Sortierung', () => {
  const actionWordsUrl = namespaceUrlFor('action_words.csv');
  const topicsUrl = namespaceUrlFor('topics.csv');

  it('sortiert referenzierte Namespace-URLs aufsteigend', () => {
    const catalog = {
      groups: [{ controls: [{ props: [
        { name: 'a', value: 'x', ns: topicsUrl },
        { name: 'b', value: 'y', ns: actionWordsUrl },
      ] }] }],
    };

    expect(extractReferencedNamespaceUrls(catalog, repository))
      .toEqual([actionWordsUrl, topicsUrl]);
  });

  it('sortiert Sammlungsmitglieder unabhängig von der Tree-Reihenfolge', () => {
    const members = materializeVocabularyCollectionMembers({
      collection: {
        kind: vocabularyCollection.kind,
        upstreamDirectory,
        fileSuffix,
      },
      treeFiles: [treeFile('topics.csv'), treeFile('action_words.csv')],
      referencedNamespaceUrls: [],
      repository,
    });

    expect(members.map((file) => file.path)).toEqual([
      `${upstreamDirectory}/action_words.csv`,
      `${upstreamDirectory}/topics.csv`,
    ]);
  });

  it('verwirft nicht-arrayförmige Tree-Listen mit TypeError', () => {
    expect(() => materializeVocabularyCollectionMembers({
      collection: {
        kind: vocabularyCollection.kind,
        upstreamDirectory,
        fileSuffix,
      },
      treeFiles: undefined,
      referencedNamespaceUrls: [],
      repository,
    })).toThrow(TypeError);
  });
});

describe('parseVocabularyCsv — Kennungsspalten', () => {
  it('erkennt eigene Kennung und Verweis am Header-Suffix', () => {
    const parsed = parseVocabularyCsv(
      'Begriff,Definition,ChildOfUUID,UUID\nServer,Zentrale IT-Dienste,,uuid-a\n',
    );

    expect(parsed.identifierColumns).toEqual(['UUID']);
    expect(parsed.identifierReferenceColumns).toEqual(['ChildOfUUID']);
  });

  it('erkennt die Kleinschreibung genauso', () => {
    const parsed = parseVocabularyCsv('ID,Definition,uuid\nG 0.1,Gefährdung,uuid-a\n');

    expect(parsed.identifierColumns).toEqual(['uuid']);
    expect(parsed.identifierReferenceColumns).toEqual([]);
  });

  it('markiert Wert- und Definitionsspalte nie als Kennung', () => {
    // Ohne diese Ausnahme verlöre ein Namespace seinen suchbaren Kern, sobald
    // ein Upstream-Header zufällig auf "uuid" endet.
    const parsed = parseVocabularyCsv('UUID,DefinitionUUID,Kategorie\nabc,Beschreibung,IT\n');

    expect(parsed.valueColumn).toBe('UUID');
    expect(parsed.definitionColumn).toBe('DefinitionUUID');
    expect(parsed.identifierColumns).toEqual([]);
    expect(parsed.identifierReferenceColumns).toEqual([]);
  });

  it('lässt Spalten unberührt, deren Name nicht auf uuid endet', () => {
    const parsed = parseVocabularyCsv(
      'Begriff,Definition,Identifier,uuid-intern\nA,B,xyz,abc\n',
    );

    expect(parsed.identifierColumns).toEqual([]);
    expect(parsed.identifierReferenceColumns).toEqual([]);
  });
});

describe('Namespace-Extraktion und CSV-Aufbereitung', () => {
  it('extracts only referenced official BSI namespace URLs from the final catalog', () => {
    const catalog = {
      catalog: {
        metadata: { props: [{ name: 'ignore-me', ns: 'http://csrc.nist.gov/ns/oscal/1.0' }] },
        groups: [{
          controls: [{
            props: [
              { name: 'result', value: 'Verfahren', ns: RESULT_NAMESPACE_URL },
              { name: 'result', value: 'Verfahren', ns: RESULT_NAMESPACE_URL },
              { name: 'action', value: 'umsetzen', ns: ACTION_WORDS_NAMESPACE_URL },
            ],
          }],
        }],
      },
    };

    expect(extractReferencedNamespaceUrls(
      catalog,
      repository,
    )).toEqual([ACTION_WORDS_NAMESPACE_URL, RESULT_NAMESPACE_URL]);
  });

  it('rejects external HTTP(S) CSV namespace hosts', () => {
    expect(() => extractReferencedNamespaceUrls({
      catalog: {
        groups: [{ controls: [{ props: [{ ns: 'https://evil.example/namespaces/result.csv' }] }] }],
      },
    }, repository)).toThrow(
      'Externe oder nicht erlaubte Namespace-Quelle: https://evil.example/namespaces/result.csv',
    );
  });

  it('maps GitHub namespace URLs back to repository-relative paths', () => {
    expect(namespaceUrlToRepoPath(
      RESULT_NAMESPACE_URL,
      repository,
    )).toBe('documentation/namespaces/result.csv');
    expect(namespaceUrlToRepoPath(
      'http://csrc.nist.gov/ns/oscal/1.0',
      repository,
    )).toBeNull();
  });

  it('parses quoted CSV fields with embedded newlines and escaped quotes', () => {
    expect(parseCsv(
      'Begriff,Definition\r\nnormal-SdT,"Zeile 1\nZeile ""2"""',
    )).toEqual([
      ['Begriff', 'Definition'],
      ['normal-SdT', 'Zeile 1\nZeile "2"'],
    ]);
  });

  it('keeps official headers and exposes exact lookup metadata for a namespace CSV', () => {
    const parsed = parseVocabularyCsv('Aufwand,Definition\r\n3,"Mehrere Wochen bis Monate"');
    expect(parsed.columnOrder).toEqual(['Aufwand', 'Definition']);
    expect(parsed.valueColumn).toBe('Aufwand');
    expect(parsed.definitionColumn).toBe('Definition');
    expect(parsed.entries).toEqual([{
      value: '3',
      definition: 'Mehrere Wochen bis Monate',
      columns: { Aufwand: '3', Definition: 'Mehrere Wochen bis Monate' },
    }]);
  });

  it('preserves UUID and user-facing practice columns while parsing practices.csv', () => {
    const namespace = buildVocabularyNamespaceData({
      namespaceUrl: namespaceUrlFor('practices.csv'),
      repository: repository,
      path: 'documentation/namespaces/practices.csv',
      gitBlobSha: 'b'.repeat(40),
      csvText:
        'Kürzel,Begriff,Definition,UUID,Schwerpunkt,Nummerierung,auch bekannt als\nGC,Governance und Compliance,Definition,uuid-practice-1,Methodik,1,Corporate Governance\n',
    });

    expect(namespace.entries[0]).toMatchObject({
      value: 'GC',
      definition: 'Definition',
      columns: {
        UUID: 'uuid-practice-1',
        Schwerpunkt: 'Methodik',
        Nummerierung: '1',
        'auch bekannt als': 'Corporate Governance',
      },
    });
  });

  it('preserves topic UUIDs while parsing topics.csv', () => {
    const namespace = buildVocabularyNamespaceData({
      namespaceUrl: namespaceUrlFor('topics.csv'),
      repository: repository,
      path: 'documentation/namespaces/topics.csv',
      gitBlobSha: 'c'.repeat(40),
      csvText:
        'Begriff,Definition,UUID\nOrganisation,Offizielle Definition,uuid-topic-1\n',
    });

    expect(namespace).toMatchObject({
      valueColumn: 'Begriff',
      definitionColumn: 'Definition',
      entries: [{
        value: 'Organisation',
        definition: 'Offizielle Definition',
        columns: { UUID: 'uuid-topic-1' },
      }],
    });
  });

  it('uses the first official CSV column as the exact lookup key', () => {
    const namespace = buildVocabularyNamespaceData({
      namespaceUrl: ACTION_WORDS_NAMESPACE_URL,
      repository: repository,
      path: 'documentation/namespaces/action_words.csv',
      gitBlobSha: 'b'.repeat(40),
      csvText: 'Infinitiv,Definition\r\numsetzen,"Etwas umsetzen"',
    });

    expect(namespace.source.routeId).toBe('documentation-namespaces-action-words');
    expect(namespace.valueColumn).toBe('Infinitiv');
    expect(namespace.entries).toEqual([{
      value: 'umsetzen',
      definition: 'Etwas umsetzen',
      columns: { Infinitiv: 'umsetzen', Definition: 'Etwas umsetzen' },
    }]);
  });
});
