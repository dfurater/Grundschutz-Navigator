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

export function getVocabularyTitle(fileName: string): string {
  return vocabularyTitles[fileName] ?? fileName
    .replace(/\.csv$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
