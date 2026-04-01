import type { LandingShowcaseData } from '@/lib/showcase';
import type { VocabularyEntryData } from '@/types/vocabulary';
import { BRAND } from '@sotto/shared';
import { ScrollChapter } from '../ScrollChapter';
import { AuthCTA } from '../AuthCTA';
import { AudioClipPlayer } from './AudioClipPlayer';
import styles from './HeroChapter.module.css';

const DEMO_VOCABULARY: VocabularyEntryData[] = [
  { id: 'demo-1', number: 1, word: 'Nachrichten', translation: 'news', partOfSpeech: 'noun', pronunciation: 'NAHKH-rikh-ten', exampleSentence: 'Die Nachrichten sind wichtig. (The news is important.)', difficulty: 'beginner' },
  { id: 'demo-2', number: 2, word: 'Wirtschaft', translation: 'economy', partOfSpeech: 'noun', pronunciation: 'VIRT-shaft', exampleSentence: 'Die Wirtschaft wächst. (The economy is growing.)', difficulty: 'intermediate' },
  { id: 'demo-3', number: 3, word: 'Verhandlungen', translation: 'negotiations', partOfSpeech: 'noun', pronunciation: 'fer-HAHND-loong-en', exampleSentence: 'Die Verhandlungen dauern an. (The negotiations continue.)', difficulty: 'advanced' },
  { id: 'demo-4', number: 4, word: 'Bericht', translation: 'report', partOfSpeech: 'noun', pronunciation: 'beh-RIKHT', exampleSentence: 'Der Bericht zeigt neue Daten. (The report shows new data.)', difficulty: 'beginner' },
];

const DEMO_TRANSCRIPT_SEGMENTS = [
  { id: 'demo-seg-1', order: 0, speaker: 'HOST', text: 'Today\'s top story — the latest [V1:Nachrichten] from the global [V2:Wirtschaft] summit.', startTime: 0, duration: 8 },
  { id: 'demo-seg-2', order: 1, speaker: 'EXPERT', text: 'The [V3:Verhandlungen] between trade ministers produced a new [V4:Bericht] on climate targets.', startTime: 8, duration: 10 },
];

interface HeroChapterProps {
  showcase: LandingShowcaseData | null;
}

export function HeroChapter({ showcase }: HeroChapterProps) {
  const vocabEntries = showcase?.clipVocabulary ?? DEMO_VOCABULARY;
  const vocabSegments = showcase?.clipVocabulary ? showcase.clipSegments : DEMO_TRANSCRIPT_SEGMENTS;

  return (
    <ScrollChapter dark>
      <div className={styles.root}>
        <div className={styles.content}>
          <div className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            {BRAND.tagline}
          </div>

          <h1 className={styles.title}>
            Any topic.
            <br />
            <em>Studio-quality podcast.</em>
          </h1>

          <p className={styles.subtitle}>
            Describe what you want to hear. Sotto writes, voices, and films it.
          </p>

          <AuthCTA source="hero" />
        </div>

        <div className={styles.visual}>
          {showcase ? (
            <>
              <AudioClipPlayer
                title={showcase.podcast.title}
                voiceCount={showcase.voiceCount}
                sourceCount={showcase.sourceCount}
                audioUrl={showcase.audioClip.url}
                originalTrackName={showcase.originalTrackName}
                startTime={showcase.audioClip.start}
                endTime={showcase.audioClip.end}
                totalDuration={showcase.audioClip.totalDuration}
                podcastId={showcase.podcast.podcastId}
                voiceTracks={showcase.voiceTracks}
                videoClip={showcase.videoClip}
                clipSegments={vocabSegments}
                clipVisuals={showcase.clipVisuals}
                clipVocabulary={vocabEntries}
                showVideoToggle={showcase.showVideo}
              />
              <div className={styles.proof}>
                <span>{showcase.voiceCount} voices</span>
                <span aria-hidden="true" className={styles.proofDot} />
                <span>{showcase.sourceCount} sources</span>
              </div>
            </>
          ) : (
            <div className={styles.waveformFallback} aria-hidden="true">
              <div className={styles.waveformBars}>
                {Array.from({ length: 32 }, (_, i) => (
                  <span
                    key={i}
                    className={styles.waveformBar}
                    style={{ '--i': i } as React.CSSProperties}
                  />
                ))}
              </div>
              <a href="/create" className={styles.waveformCta}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Create your first podcast
              </a>
            </div>
          )}
        </div>
      </div>
    </ScrollChapter>
  );
}
