// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_BSI_REPOSITORY_URL, OFFICIAL_BSI_REPO } from './security-guards.mjs';
import { SOURCE_REGISTRY } from '../src/domain/sourceRegistry.mjs';
import {
  deriveRouteId,
  extractReferencedNamespaceUrls,
  materializeVocabularyCollectionMembers,
  parseCsv,
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
