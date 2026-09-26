const vocabularyTitles: Readonly<Record<string, string>> = {
  'action_words.csv': 'Handlungsworte',
  'basethreats.csv': 'Elementare Gefährdungen',
  'documentation_guidelines.csv': 'Dokumentationsvorgaben',
  'effort_level.csv': 'Aufwandsstufen',
  'modal_verbs.csv': 'Modalverben',
  'practices.csv': 'Praktiken',
  'result.csv': 'Ergebnisse',
  'security_level.csv': 'Sicherheitsniveaus',
  'security_targets.csv': 'Schutzziele',
  'security_targets_levels.csv': 'Schutzziel-Relevanz',
  'tags.csv': 'Tags',
  'target_object_categories.csv': 'Zielobjekt-Kategorien',
  'topics.csv': 'Themen',
};

/**
 * Fallback für nicht kuratierte Vokabulardateien.
 *
 * Die Wortanfangserkennung läuft über `\p{L}` mit `u`-Flag: `\w` würde Umlaute
 * als Wortgrenze behandeln und „gefährdungen“ zu „GefäHrdungen“ verstümmeln.
 */
function humanizeVocabularyFileName(fileName: string): string {
  return fileName
    .replace(/\.csv$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(
      /(^|\s)(\p{L})/gu,
      (_match, boundary: string, letter: string) =>
        `${boundary}${letter.toLocaleUpperCase('de-DE')}`,
    );
}

export function getVocabularyTitle(fileName: string): string {
  return vocabularyTitles[fileName] ?? humanizeVocabularyFileName(fileName);
}

/**
 * Merkmal eines einzelnen Eintrags in Einzahl („Modalverb: SOLLTE“). Die
 * Kriterien tragen dieselben Namen wie die Spaltenköpfe der Tabelle.
 */
const vocabularyTermLabels: Readonly<Record<string, string>> = {
  'action_words.csv': 'Handlungswort',
  'basethreats.csv': 'Elementare Gefährdung',
  'documentation_guidelines.csv': 'Dokumentationsvorgabe',
  'effort_level.csv': 'Aufwand',
  'modal_verbs.csv': 'Modalverb',
  'practices.csv': 'Praktik',
  'result.csv': 'Ergebnis',
  'security_level.csv': 'Sicherheitsniveau',
  'security_targets.csv': 'Schutzziel',
  'security_targets_levels.csv': 'Schutzziel-Relevanz',
  'tags.csv': 'Tag',
  'target_object_categories.csv': 'Zielobjekt-Kategorie',
  'topics.csv': 'Thema',
};

export function getVocabularyTermLabel(fileName: string): string {
  return vocabularyTermLabels[fileName] ?? getVocabularyTitle(fileName);
}
