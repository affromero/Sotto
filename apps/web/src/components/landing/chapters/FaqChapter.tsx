import Link from 'next/link';
import { ScrollChapter } from '../ScrollChapter';
import styles from './FaqChapter.module.css';

const FAQ_ITEMS = [
  {
    question: 'What exactly is Sotto?',
    answer: (
      <>
        Sotto is a social podcast network. You describe what you want to learn, and AI
        writes a fact-checked script, generates studio-quality audio with real voice
        providers, and can even turn it into video. Then you publish it to a social feed
        where others can listen, fork, remix, and ask questions &mdash; all inside the
        episode.
      </>
    ),
  },
  {
    question: 'How do I create a podcast?',
    answer: (
      <>
        Go to <Link href="/create">Create</Link> and chat with our AI assistant.
        Describe what you want to learn about &mdash; a topic, an article URL, a YouTube
        video &mdash; and it asks follow-up questions to nail down exactly what you need.
        Once you&apos;re happy, it writes a script, you review it, and then it generates
        studio audio. The whole thing takes minutes, not hours.
      </>
    ),
  },
  {
    question: 'Too many API keys — which ones do I actually need?',
    answer: (
      <>
        If you don&apos;t want to think about it: <strong>just Fal</strong>. A single Fal
        API key covers the entire pipeline &mdash; LLM, text-to-speech, images, video, and
        avatars. One key, full access, done. Of course, you can also mix and match providers
        (Anthropic for AI, ElevenLabs for voices, etc.) if you have preferences. But
        Fal alone gets you everything.
      </>
    ),
  },
  {
    question: 'Is it really free?',
    answer: (
      <>
        Right now, yes. During early access everything works with platform AI &mdash; no
        card, no limits. If you bring your own API keys (BYOK), you get unlimited
        generations at whatever your provider charges. We&apos;ll introduce plans down the
        road, but early members get grandfathered in. We&apos;re building in the open and
        want feedback more than revenue right now.
      </>
    ),
  },
  {
    question: 'How do you verify voices and faces?',
    answer: (
      <>
        Voice cloning and avatar images are gated behind identity verification. You record
        or upload your own voice, and we verify it&apos;s actually yours before it goes
        live. Same for portrait photos used in lip-sync avatars &mdash; consent-based,
        verified, and shareable only with your explicit permission. No one can clone your
        voice or use your face without your approval.
      </>
    ),
  },
  {
    question: 'How do you protect creators and public figures?',
    answer: (
      <>
        This is something we take very seriously. Voice cloning requires identity
        verification and explicit consent &mdash; you can only clone your own voice. Avatar
        images go through the same consent gate. All AI-generated content is clearly
        labeled. We have active content moderation, a reporting system, and a zero-tolerance
        policy for impersonation or deepfakes. If someone misuses the platform, they&apos;re
        gone. We&apos;d rather have fewer users than compromise on this.
      </>
    ),
  },
  {
    question: 'Another AI slop factory?',
    answer: (
      <>
        The opposite. We don&apos;t optimize for retention, watch time, or engagement
        metrics &mdash; we optimize for <em>learning</em>. Every script is fact-checked
        against real sources. Every claim gets a verification score. We built an{' '}
        <a
          href="https://github.com/SottoFM/reference-verification-standard"
          target="_blank"
          rel="noopener noreferrer"
        >
          open-source verification standard
        </a>{' '}
        because we think the bar for AI-generated content should be higher, not lower. If a
        podcast doesn&apos;t teach you something real, we failed.
      </>
    ),
  },
  {
    question: 'I listen to podcasts but forget everything.',
    answer: (
      <>
        Us too &mdash; that&apos;s why we built comprehension quizzes and daily briefings.
        After every podcast, you get a quick quiz to test what you actually retained. Daily
        briefings give you a 5-minute personalized recap every morning based on your
        interests. Think of it as spaced repetition for your ears &mdash; turn passive
        listening into knowledge that sticks.
      </>
    ),
  },
  {
    question: 'Can I import my own podcast?',
    answer: (
      <>
        Yes &mdash; from anywhere. Spotify, Apple Podcasts, YouTube, NotebookLM, or just
        drag in an audio file. Sotto adds transcripts, social features, interactive Q&amp;A,
        and everything else on top. Human-created content is labeled as such &mdash; we
        never misrepresent what&apos;s AI and what isn&apos;t.
      </>
    ),
  },
  {
    question: 'Can I interrupt mid-playback to ask a question?',
    answer: (
      <>
        Yes &mdash; that&apos;s one of our favorite features. Pause at any point, ask a
        follow-up question, and get an answer drawn from the full context of the episode.
        Your Q&amp;A gets woven back into the podcast permanently, so the next person who
        listens benefits too.
      </>
    ),
  },
  {
    question: 'Are my API keys secure?',
    answer: (
      <>
        All BYOK keys are encrypted with AES-256-GCM before storage. They&apos;re only
        decrypted in memory when making API calls on your behalf &mdash; never logged, never
        shared. You can revoke your keys at any time from{' '}
        <Link href="/settings/api">Settings</Link>.
      </>
    ),
  },
  {
    question: 'Can I delete my account?',
    answer: (
      <>
        Yes, fully. Go to your profile settings and hit &quot;Delete Account.&quot; It
        permanently removes everything &mdash; podcasts, comments, API keys, all of it. No
        dark patterns, no &quot;are you sure?&quot; loops. Your data is yours.
      </>
    ),
  },
] as const;

export function FaqChapter() {
  return (
    <ScrollChapter id="faq" alt>
      <div className={styles.root}>
        <div className={styles.header} data-reveal>
          <span className={styles.overline}>FAQ</span>
          <h2 className={styles.heading}>Questions? Answers.</h2>
          <p className={styles.description}>
            The stuff people actually ask us &mdash; no corporate fluff.
          </p>
        </div>

        <div className={styles.grid} data-reveal>
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className={styles.item}>
              <summary className={styles.question}>
                {item.question}
                <span className={styles.chevron} aria-hidden="true" />
              </summary>
              <div className={styles.answer}>
                <p>{item.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </ScrollChapter>
  );
}
