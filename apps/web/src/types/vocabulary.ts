export interface VocabularyEntryData {
  id: string;
  number: number;
  word: string;
  translation: string;
  partOfSpeech: string | null;
  pronunciation: string | null;
  exampleSentence: string | null;
  difficulty: string | null;
}
