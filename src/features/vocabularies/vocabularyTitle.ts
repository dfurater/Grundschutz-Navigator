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
