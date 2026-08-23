// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deriveRouteId,
  extractReferencedNamespaceUrls,
  materializeVocabularyCollectionMembers,
  parseCsv,
  sha256Hex,
} from './vocabulary-utils.mjs';

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

  it('übernimmt die letzte Zeile auch ohne Zeilenabschluss', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
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

describe('deriveRouteId Randfälle der Trennzeichen-Kappung', () => {
  it('entfernt führende und nachlaufende Trennzeichen separat', () => {
    expect(deriveRouteId('-leading.csv')).toBe('leading');
    expect(deriveRouteId('trailing-.md')).toBe('trailing');
    expect(deriveRouteId('-both-.md')).toBe('both');
  });

  it('liefert leere Route für reinen Trenner-Inhalt', () => {
    expect(deriveRouteId('---.csv')).toBe('');
  });
});

describe('deterministische Sortierung', () => {
  const repository = 'BSI-Bund/Stand-der-Technik-Bibliothek';
  const actionWordsUrl =
    'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/action_words.csv';
  const topicsUrl =
    'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/topics.csv';

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
    const collection = {
      kind: 'vocabulary-collection',
      upstreamDirectory: 'documentation/namespaces',
      fileSuffix: '.csv',
    };
    const treeFiles = [
      { path: 'documentation/namespaces/topics.csv' },
      { path: 'documentation/namespaces/action_words.csv' },
    ];

    const members = materializeVocabularyCollectionMembers({
      collection,
      treeFiles,
      referencedNamespaceUrls: [],
      repository,
    });

    expect(members.map((file) => file.path)).toEqual([
      'documentation/namespaces/action_words.csv',
      'documentation/namespaces/topics.csv',
    ]);
  });

  it('verwirft nicht-arrayförmige Tree-Listen mit TypeError', () => {
    const collection = {
      kind: 'vocabulary-collection',
      upstreamDirectory: 'documentation/namespaces',
      fileSuffix: '.csv',
    };

    expect(() => materializeVocabularyCollectionMembers({
      collection,
      treeFiles: undefined,
      referencedNamespaceUrls: [],
      repository,
    })).toThrow(TypeError);
  });
});
