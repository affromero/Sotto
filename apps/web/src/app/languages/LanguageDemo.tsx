'use client';

import { parseTextWithCitationsAndVocabulary } from '@/lib/vocabulary-parser';
import { VocabularyList } from '@/components/player/VocabularyList';
import { ReferenceList } from '@/components/player/ReferenceList';
import type { VocabularyEntryData } from '@/types/vocabulary';
import type { ReferenceData } from '@/types/reference';
import styles from './LanguageDemo.module.css';

const DEMO_TEXT =
  "Today's top story \u2014 the latest [V1:Nachrichten] from the global [V2:Wirtschaft] summit. The [V3:Verhandlungen] between trade ministers produced a new [V4:Bericht] on climate targets [1]. Analysts say the [V5:Ergebnisse] could reshape policy across Europe.";

const DEMO_VOCABULARY: VocabularyEntryData[] = [
  {
    id: 'd1',
    number: 1,
    word: 'Nachrichten',
    translation: 'news',
    partOfSpeech: 'noun',
    pronunciation: 'NAHKH-rikh-ten',
    exampleSentence: 'Die Nachrichten sind wichtig. (The news is important.)',
    difficulty: 'beginner',
  },
  {
    id: 'd2',
    number: 2,
    word: 'Wirtschaft',
    translation: 'economy',
    partOfSpeech: 'noun',
    pronunciation: 'VIRT-shaft',
    exampleSentence: 'Die Wirtschaft wächst. (The economy is growing.)',
    difficulty: 'intermediate',
  },
  {
    id: 'd3',
    number: 3,
    word: 'Verhandlungen',
    translation: 'negotiations',
    partOfSpeech: 'noun',
    pronunciation: 'fer-HAHND-loong-en',
    exampleSentence: 'Die Verhandlungen dauern an. (The negotiations continue.)',
    difficulty: 'advanced',
  },
  {
    id: 'd4',
    number: 4,
    word: 'Bericht',
    translation: 'report',
    partOfSpeech: 'noun',
    pronunciation: 'beh-RIKHT',
    exampleSentence: 'Der Bericht zeigt neue Daten. (The report shows new data.)',
    difficulty: 'beginner',
  },
  {
    id: 'd5',
    number: 5,
    word: 'Ergebnisse',
    translation: 'results',
    partOfSpeech: 'noun',
    pronunciation: 'er-GEHB-niss-eh',
    exampleSentence: 'Die Ergebnisse sind positiv. (The results are positive.)',
    difficulty: 'intermediate',
  },
];

const DEMO_REFERENCES = [
  {
    id: 'r1',
    number: 1,
    title: 'Global Trade Summit Report 2026',
    authors: ['Reuters'],
    year: 2026,
    url: 'https://reuters.com',
    type: 'ARTICLE',
    publisher: 'Reuters',
    doi: null,
    verificationStatus: 'VERIFIED',
    verificationDetails: null,
    contentDomain: 'NEWS',
  },
] as ReferenceData[];

export function LanguageDemo() {
  const parsed = parseTextWithCitationsAndVocabulary(DEMO_TEXT, DEMO_REFERENCES, DEMO_VOCABULARY);

  return (
    <div className={styles.demoCard}>
      <p className={styles.demoHint}>Hover the underlined words to see translations</p>
      <div className={styles.demoTranscript}>{parsed}</div>
      <div className={styles.demoPanels}>
        <VocabularyList vocabularyEntries={DEMO_VOCABULARY} />
        <ReferenceList references={DEMO_REFERENCES} />
      </div>
    </div>
  );
}
