import Link from 'next/link';
import { BRAND } from '@sotto/shared';
import { JsonLd } from '@/components/landing/JsonLd';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { LandingCTA } from '@/components/landing/LandingCTA';
import { GlassBead } from '@/components/landing/GlassBead';
import { ProductFrame } from '@/components/landing/ProductFrame';
import { TtsProviderLogo } from '@/components/ui/TtsProviderLogo';
import { Glyph } from '@/app/welcome/Glyph';
import type { GlyphName } from '@/app/welcome/data';
import { getPublicGithubUrl } from '@/lib/public-links';
import { isSelfHosted } from '@/lib/self-hosted';
import styles from './page.module.css';

const GITHUB_URL = getPublicGithubUrl() ?? 'https://github.com/affromero/Sotto';

interface Step {
  num: string;
  label: string;
  title: string;
  body: string;
  icon: GlyphName;
}

const STEPS: Step[] = [
  {
    num: '01',
    label: 'Connect',
    title: 'Bring your own agent',
    body: 'Point Sotto at the Claude or Codex you already run, with your own keys. No new account to teach, no provider lock-in. The model that knows your work teaches the language.',
    icon: 'plug',
  },
  {
    num: '02',
    label: 'Grant context',
    title: 'Choose what it may read',
    body: 'Hand it your repositories, papers, notes, the things you actually care about. You decide the scope, line by line. Nothing leaves your machine unless you say so.',
    icon: 'key',
  },
  {
    num: '03',
    label: 'Progress',
    title: 'A course gated by mastery',
    body: 'Get placed at the right CEFR level, then advance only as you demonstrate it. Grammar, reading, listening, speaking, and writing, drawn from your own world.',
    icon: 'gate',
  },
];

interface Skill {
  label: string;
  name: string;
  body: string;
  icon: GlyphName;
}

const SKILLS: Skill[] = [
  {
    label: 'Grammar',
    name: 'Structure, drilled',
    body: 'Mastery-gated grammar exercises that adapt to what you keep getting wrong.',
    icon: 'spark',
  },
  {
    label: 'Reading',
    name: 'Your own sources',
    body: 'Passages levelled to your CEFR step, built from the texts you brought.',
    icon: 'book',
  },
  {
    label: 'Listening',
    name: 'Adaptive audio',
    body: 'Generated audio lessons you can pause, question, and have re-explained aloud.',
    icon: 'wave',
  },
  {
    label: 'Speaking',
    name: 'Pronunciation feedback',
    body: 'Record a phrase; get phoneme-level feedback through your own STT and TTS.',
    icon: 'mic',
  },
  {
    label: 'Writing',
    name: 'Inline corrections',
    body: 'Write freely and receive corrections that explain the why, not just the what.',
    icon: 'check',
  },
  {
    label: 'Memory',
    name: 'A graph you own',
    body: 'Every word and grammar point tracked across skills, with spaced review when it is due.',
    icon: 'graph',
  },
];

interface Tenet {
  label: string;
  title: string;
  body: string;
  icon: GlyphName;
}

const TENETS: Tenet[] = [
  {
    label: 'Your keys',
    title: 'BYOK, end to end',
    body: 'Every provider call runs on credentials you hold. Swap models freely; no managed middleman skims the path.',
    icon: 'lock',
  },
  {
    label: 'Your data',
    title: 'Private by default',
    body: 'Your context, recordings, and vocabulary graph stay on your stack. There is no shared corpus to opt out of.',
    icon: 'shield',
  },
  {
    label: 'Your stack',
    title: 'Open and self-hostable',
    body: 'The whole thing is open-source and runs on infrastructure you control. Read it, audit it, host it.',
    icon: 'repo',
  },
];

interface RunChip {
  label: string;
  title: string;
  body: string;
  icon: GlyphName;
}

const RUN_CHIPS: RunChip[] = [
  {
    label: 'Desktop launcher',
    title: 'Sotto Host',
    body: 'One app for macOS, Windows, and Linux. It starts the database, workers, and your AI, then hands you the app.',
    icon: 'spark',
  },
  {
    label: 'Docker',
    title: 'One command',
    body: 'On your own box, one command pulls the prebuilt images and starts everything. No clone, no build.',
    icon: 'repo',
  },
  {
    label: 'Bring your keys',
    title: 'BYOK',
    body: 'Connect your own agent and provider keys. Your courses, audio, and data stay where you put them.',
    icon: 'key',
  },
];

type ProviderLogoId = Parameters<typeof TtsProviderLogo>[0]['provider'];

interface SupportedProvider {
  key: string;
  name: string;
  logo: ProviderLogoId;
  capability: string;
}

const SUPPORTED_PROVIDERS: SupportedProvider[] = [
  { key: 'claude-code', name: 'Claude Code', logo: 'anthropic', capability: 'Agent' },
  { key: 'codex', name: 'Codex', logo: 'openai', capability: 'Agent' },
  { key: 'anthropic', name: 'Anthropic', logo: 'anthropic', capability: 'AI' },
  { key: 'openai', name: 'OpenAI', logo: 'openai', capability: 'AI · TTS · STT' },
  { key: 'google', name: 'Google Gemini', logo: 'google', capability: 'AI · Live' },
  { key: 'xai', name: 'xAI', logo: 'xai', capability: 'AI' },
  { key: 'deepseek', name: 'DeepSeek', logo: 'deepseek', capability: 'AI' },
  { key: 'mistral', name: 'Mistral', logo: 'mistral', capability: 'AI · TTS' },
  { key: 'groq', name: 'Groq', logo: 'groq', capability: 'AI · STT' },
  { key: 'nvidia', name: 'NVIDIA NIM', logo: 'nvidia', capability: 'AI' },
  { key: 'together', name: 'Together AI', logo: 'together', capability: 'AI · STT' },
  { key: 'elevenlabs', name: 'ElevenLabs', logo: 'elevenlabs', capability: 'TTS · STT' },
  { key: 'cartesia', name: 'Cartesia', logo: 'cartesia', capability: 'TTS · STT' },
  { key: 'hume', name: 'Hume AI', logo: 'hume', capability: 'TTS' },
  { key: 'fal', name: 'Fal', logo: 'fal', capability: 'TTS' },
  { key: 'replicate', name: 'Replicate', logo: 'replicate', capability: 'TTS' },
  { key: 'minimax', name: 'MiniMax', logo: 'minimax', capability: 'TTS' },
  { key: 'deepgram', name: 'Deepgram', logo: 'deepgram', capability: 'TTS · STT' },
  { key: 'rime', name: 'Rime', logo: 'rime', capability: 'TTS' },
  { key: 'playht', name: 'PlayHT', logo: 'playht', capability: 'TTS' },
  { key: 'assemblyai', name: 'AssemblyAI', logo: 'assemblyai', capability: 'STT' },
  { key: 'gladia', name: 'Gladia', logo: 'gladia', capability: 'STT' },
  { key: 'speechmatics', name: 'Speechmatics', logo: 'speechmatics', capability: 'STT' },
  { key: 'kokoro', name: 'Kokoro', logo: 'kokoro', capability: 'Local TTS' },
  { key: 'local', name: 'Local models', logo: 'local', capability: 'AI · TTS · STT' },
];

interface WalkProvider {
  name: string;
  meta: string;
  selected?: boolean;
}

interface WalkSource {
  label: string;
  meta: string;
  on: boolean;
}

interface WalkSkill {
  label: string;
  state: 'open' | 'locked';
}

interface WalkStep {
  num: string;
  label: string;
  title: string;
  titleAccent: string;
  body: string;
  caption: string;
  frame: 'agent' | 'context' | 'placement' | 'skills';
}

const WALK_STEPS: WalkStep[] = [
  {
    num: '01',
    label: 'Connect',
    title: 'Connect your',
    titleAccent: 'agent',
    body: 'Pick the Claude, Codex, or local model you already run. Sotto reuses your installed CLI, so there is nothing new to paste and nothing to proxy through us.',
    caption: 'Agent, reuse the CLI you already run',
    frame: 'agent',
  },
  {
    num: '02',
    label: 'Grant context',
    title: 'Grant the',
    titleAccent: 'context',
    body: 'Choose what it may read, source by source. Your repositories, reading list, notes, calendar. Every lesson is drawn from the world you share, and nothing leaves your machine.',
    caption: 'Context, you decide the scope',
    frame: 'context',
  },
  {
    num: '03',
    label: 'Get placed',
    title: 'Get placed at',
    titleAccent: 'your level',
    body: 'Answer a few questions in the target language. Sotto reads your range and sets a starting CEFR level, so the course begins exactly where you are, not at lesson one.',
    caption: 'Placement, your level in minutes',
    frame: 'placement',
  },
  {
    num: '04',
    label: 'Learn',
    title: 'Learn across',
    titleAccent: 'five skills',
    body: 'Grammar, reading, listening, speaking, and writing, each gated by mastery. Every word you meet joins a vocabulary memory graph that is entirely yours.',
    caption: 'Class hub, five skills and one memory',
    frame: 'skills',
  },
];

const WALK_PROVIDERS: WalkProvider[] = [
  { name: 'Claude', meta: 'Anthropic · CLI', selected: true },
  { name: 'Codex', meta: 'OpenAI · CLI' },
  { name: 'Local', meta: 'Ollama · llama.cpp' },
  { name: 'Custom', meta: 'OpenAI-compatible' },
];

const WALK_SOURCES: WalkSource[] = [
  { label: 'Code and repos', meta: 'what you build', on: true },
  { label: 'Reading list', meta: 'what you follow', on: true },
  { label: 'Notes', meta: 'what you think about', on: true },
  { label: 'Calendar', meta: 'your week', on: false },
];

const WALK_SKILLS: WalkSkill[] = [
  { label: 'Grammar', state: 'open' },
  { label: 'Reading', state: 'open' },
  { label: 'Listening', state: 'open' },
  { label: 'Speaking', state: 'locked' },
  { label: 'Writing', state: 'locked' },
];

/* ---- walkthrough frame mockups (static, CSS-built aula UI) ---- */

function AgentMock() {
  return (
    <div className={styles.mock}>
      <div className={styles.mockProviders}>
        {WALK_PROVIDERS.map((p) => (
          <div
            key={p.name}
            className={`${styles.mockProvider} ${p.selected ? styles.mockProviderSel : ''}`}
          >
            <span className={styles.mockProviderIco} aria-hidden="true">
              <Glyph name="plug" size={16} />
            </span>
            <span className={styles.mockProviderName}>{p.name}</span>
            <span className={styles.mockProviderMeta}>{p.meta}</span>
          </div>
        ))}
      </div>
      <div className={styles.mockTag}>
        <Glyph name="check" size={13} />
        Installed CLI, no key
      </div>
    </div>
  );
}

function ContextMock() {
  return (
    <div className={styles.mock}>
      <ul className={styles.mockSources}>
        {WALK_SOURCES.map((s) => (
          <li key={s.label} className={`${styles.mockSource} ${s.on ? styles.mockSourceOn : ''}`}>
            <span className={styles.mockSourceText}>
              <span className={styles.mockSourceLabel}>{s.label}</span>
              <span className={styles.mockSourceMeta}>{s.meta}</span>
            </span>
            <span
              className={`${styles.mockSwitch} ${s.on ? styles.mockSwitchOn : ''}`}
              aria-hidden="true"
            />
          </li>
        ))}
      </ul>
      <div className={styles.mockLock}>
        <Glyph name="lock" size={14} />
        Nothing leaves your machine
      </div>
    </div>
  );
}

function PlacementMock() {
  return (
    <div className={styles.mock}>
      <p className={styles.mockQ}>Question 4 of 6</p>
      <p className={styles.mockSentence}>Se avessi tempo, leggerei di più.</p>
      <p className={styles.mockGloss}>If I had time, I would read more.</p>
      <div className={styles.mockLevel}>
        <span className={styles.mockLevelFrom}>A2</span>
        <span className={styles.mockLevelArrow} aria-hidden="true">
          <Glyph name="arrow" size={15} />
        </span>
        <span className={styles.mockLevelTo}>B1</span>
      </div>
    </div>
  );
}

function SkillsMock() {
  return (
    <div className={styles.mock}>
      <ul className={styles.mockSkills}>
        {WALK_SKILLS.map((s) => (
          <li
            key={s.label}
            className={`${styles.mockSkillRow} ${s.state === 'locked' ? styles.mockSkillLocked : ''}`}
          >
            <span className={styles.mockSkillLabel}>{s.label}</span>
            <span className={styles.mockSkillState} aria-hidden="true">
              <Glyph name={s.state === 'locked' ? 'gate' : 'check'} size={14} />
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.mockGraph} aria-hidden="true">
        <span className={styles.mockGraphLine} />
        <span className={`${styles.mockNode} ${styles.mockNodeA}`} />
        <span className={`${styles.mockNode} ${styles.mockNodeB}`} />
        <span className={`${styles.mockNode} ${styles.mockNodeC}`} />
        <span className={`${styles.mockNode} ${styles.mockNodeD}`} />
      </div>
      <p className={styles.mockGraphNote}>Vocabulary memory graph</p>
    </div>
  );
}

function WalkFrameMock({ frame }: { frame: WalkStep['frame'] }) {
  switch (frame) {
    case 'agent':
      return <AgentMock />;
    case 'context':
      return <ContextMock />;
    case 'placement':
      return <PlacementMock />;
    case 'skills':
      return <SkillsMock />;
  }
}

export default function LandingPage() {
  const demoMode = !isSelfHosted();

  return (
    <div className={styles.root}>
      <JsonLd />
      <LandingHeader demoMode={demoMode} />

      <main className={styles.main}>
        {/* ---- hero ---- */}
        <section className={styles.hero} aria-labelledby="hero-title">
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowDash} aria-hidden="true" />
            Open-source · Self-hosted
          </p>
          <h1 id="hero-title" className={styles.heroTitle}>
            Learn a language, <em>taught in your own context.</em>
          </h1>
          <p className={styles.lede}>{BRAND.subline}</p>

          <LandingCTA withGhost demoMode={demoMode} />

          <p className={styles.whisper}>
            <span className={styles.whisperTag}>private by design</span>
            The agent that already knows you, now teaching you to speak.
          </p>
        </section>

        {/* ---- provider carousel ---- */}
        <section className={styles.providers} aria-labelledby="providers-title">
          <div className={styles.providersHead}>
            <p className={styles.sectionLabel}>Provider choice</p>
            <h2 id="providers-title" className={styles.providersTitle}>
              Connect the companies and models <em>you already trust</em>.
            </h2>
            <p className={styles.providersCopy}>
              AI, text-to-speech, speech-to-text, CLI agents, and local models all plug into the
              same self-hosted learning stack.
            </p>
          </div>

          <div className={styles.providerCarousel} aria-label="Supported providers">
            <div className={styles.providerTrack}>
              {[...SUPPORTED_PROVIDERS, ...SUPPORTED_PROVIDERS].map((provider, index) => (
                <div
                  key={`${provider.key}-${index}`}
                  className={styles.providerPill}
                  aria-hidden={index >= SUPPORTED_PROVIDERS.length}
                >
                  <span className={styles.providerMark}>
                    <TtsProviderLogo provider={provider.logo} size={30} />
                  </span>
                  <span className={styles.providerText}>
                    <span className={styles.providerName}>{provider.name}</span>
                    <span className={styles.providerCapability}>{provider.capability}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---- how it works ---- */}
        <section className={styles.section} aria-labelledby="how-title">
          <header className={styles.sectionHead}>
            <p className={styles.sectionLabel}>How it works</p>
            <h2 id="how-title" className={styles.sectionTitle}>
              Three steps, and the course is <em>yours</em>.
            </h2>
          </header>

          <ol className={styles.steps}>
            {STEPS.map((step) => (
              <li key={step.num} className={styles.step}>
                <div className={styles.stepIcon} aria-hidden="true">
                  <Glyph name={step.icon} size={20} />
                </div>
                <div className={styles.stepBody}>
                  <p className={styles.stepMeta}>
                    <span className={styles.stepNum}>{step.num}</span>
                    {step.label}
                  </p>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepText}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- five skills + memory ---- */}
        <section className={styles.section} aria-labelledby="skills-title">
          <header className={styles.sectionHead}>
            <p className={styles.sectionLabel}>Five skills · one memory</p>
            <h2 id="skills-title" className={styles.sectionTitle}>
              Every skill, drawn from <em>your world</em>.
            </h2>
            <p className={styles.sectionLede}>
              Grammar, reading, listening, speaking, and writing, each gated by demonstrated
              mastery, all feeding a vocabulary memory graph that is entirely yours.
            </p>
          </header>

          <ul className={styles.skillGrid}>
            {SKILLS.map((skill) => (
              <li key={skill.label} className={styles.skillCard}>
                <div className={styles.skillIcon} aria-hidden="true">
                  <Glyph name={skill.icon} size={20} />
                </div>
                <p className={styles.skillLabel}>{skill.label}</p>
                <h3 className={styles.skillName}>{skill.name}</h3>
                <p className={styles.skillText}>{skill.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ---- walkthrough ---- */}
        <section className={styles.section} aria-labelledby="walk-title">
          <header className={styles.sectionHead}>
            <p className={styles.sectionLabel}>Step by step</p>
            <h2 id="walk-title" className={styles.sectionTitle}>
              From your agent to your first <em>class</em>.
            </h2>
            <p className={styles.sectionLede}>
              Four steps, start to finish. Each one is the real screen you will see, drawn in the
              same calm interface you learn in.
            </p>
          </header>

          <ol className={styles.walk}>
            {WALK_STEPS.map((step) => (
              <li key={step.num} className={styles.walkStep}>
                <div className={styles.walkText}>
                  <p className={styles.walkMeta}>
                    <span className={styles.walkNum}>{step.num}</span>
                    {step.label}
                  </p>
                  <h3 className={styles.walkTitle}>
                    {step.title} <em>{step.titleAccent}</em>.
                  </h3>
                  <p className={styles.walkBody}>{step.body}</p>
                </div>
                <div className={styles.walkFrame}>
                  <ProductFrame
                    title={
                      step.frame === 'placement'
                        ? 'sotto.local / placement'
                        : step.frame === 'skills'
                          ? 'Sotto · Today'
                          : 'sotto.local / welcome'
                    }
                    caption={step.caption}
                    chrome={step.frame === 'skills' ? 'app' : 'browser'}
                  >
                    <WalkFrameMock frame={step.frame} />
                  </ProductFrame>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- ownership ---- */}
        <section className={styles.section} aria-labelledby="own-title">
          <header className={styles.sectionHead}>
            <p className={styles.sectionLabel}>Ownership</p>
            <h2 id="own-title" className={styles.sectionTitle}>
              Your keys, your data, <em>your stack</em>.
            </h2>
            <p className={styles.sectionLede}>
              A learning stack you fully control — your courses, progress, and keys live on
              infrastructure you own.
            </p>
          </header>

          <div className={styles.tenetGrid}>
            {TENETS.map((tenet) => (
              <article key={tenet.label} className={styles.tenet}>
                <div className={styles.tenetIcon} aria-hidden="true">
                  <Glyph name={tenet.icon} size={20} />
                </div>
                <p className={styles.tenetLabel}>{tenet.label}</p>
                <h3 className={styles.tenetTitle}>{tenet.title}</h3>
                <p className={styles.tenetText}>{tenet.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---- download ---- */}
        <section className={styles.section} aria-labelledby="download-title">
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDash} aria-hidden="true" />
              Run it yourself
            </p>
            <h2 id="download-title" className={styles.sectionTitle}>
              Get Sotto on <em>your own stack</em>.
            </h2>
            <p className={styles.sectionLede}>
              Run the whole thing on your computer in one click, or host it on a server for the
              household. Your courses, audio, and data stay where you put them.
            </p>
          </header>

          <div className={styles.downloadActions}>
            <Link href="/download" className={styles.downloadPrimary}>
              Download Sotto
              <span className={styles.downloadArrow} aria-hidden="true">
                <Glyph name="arrow" size={17} />
              </span>
            </Link>
            <a
              href={GITHUB_URL}
              className={styles.downloadGhost}
              target="_blank"
              rel="noopener noreferrer"
            >
              Host on a server
            </a>
          </div>

          <ul className={styles.runChips}>
            {RUN_CHIPS.map((chip) => (
              <li key={chip.label} className={styles.runChip}>
                <div className={styles.runChipIcon} aria-hidden="true">
                  <Glyph name={chip.icon} size={18} />
                </div>
                <p className={styles.runChipLabel}>{chip.label}</p>
                <h3 className={styles.runChipTitle}>{chip.title}</h3>
                <p className={styles.runChipText}>{chip.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ---- footer CTA ---- */}
        <section className={styles.convert} aria-labelledby="convert-title">
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowDash} aria-hidden="true" />
            {BRAND.cta}
          </p>
          <h2 id="convert-title" className={styles.convertTitle}>
            Place. Practice. <em>Progress.</em>
          </h2>
          <p className={styles.sectionLede}>
            Connect the agent you already own and take the first class today.
          </p>

          <LandingCTA demoMode={demoMode} />

          <p className={styles.whisper}>
            <span className={styles.whisperTag}>context you control</span>
            {BRAND.origin}
          </p>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Link href="/" className={styles.footerWordmark} aria-label="Sotto home">
            <GlassBead />
            <span className={styles.footerWordmarkText}>sotto</span>
          </Link>
          <nav className={styles.footerLinks} aria-label="Footer">
            <Link href="/about" className={styles.footerLink}>
              About
            </Link>
            <a
              href={GITHUB_URL}
              className={styles.footerLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              className={styles.footerLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              AGPL-3.0
            </a>
          </nav>
          <p className={styles.footerNote}>
            {BRAND.name}. {BRAND.tagline}
          </p>
        </div>
      </footer>
    </div>
  );
}
