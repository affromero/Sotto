'use client';

import type { GlyphName } from '@/components/Glyph';
import { BASE_LANGS, LANGUAGES, PLACEMENT_LEVEL_GUIDES, type CefrLevel } from '../data';
import type { ContextItem, ContextItemKind } from '../WelcomeFlow';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.styles';

interface Props {
  baseLang: string;
  language: string;
  level: CefrLevel | null;
  contextItems: ContextItem[];
  onNext: () => void;
  onBack: () => void;
}

const KIND_LABELS: Record<ContextItemKind, string> = {
  link: 'link',
  book: 'book',
  article: 'article/news',
  music: 'music/audio',
  topic: 'topic',
  file: 'file',
  text: 'note',
};

const LEVEL_APPROACH: Record<CefrLevel, { diagnosis: string; moves: string[]; icon: GlyphName }> = {
  A1: {
    diagnosis:
      'Treat the context as familiar ground, then reduce it to sounds, greetings, concrete nouns, and reusable first sentences.',
    moves: [
      'Build pronunciation and survival phrases before long source material.',
      'Use short, repeated examples drawn from the submitted topics.',
      'Keep every task supported by translations, audio, and visible patterns.',
    ],
    icon: 'gate',
  },
  A2: {
    diagnosis:
      'Turn the context into everyday scenes: short exchanges, practical questions, and vocabulary that can be reused quickly.',
    moves: [
      'Practice routines and simple choices around the submitted material.',
      'Add listening at controlled speed before native-speed excerpts.',
      'Use small grammar gates for tense, gender, word order, and connectors.',
    ],
    icon: 'today',
  },
  B1: {
    diagnosis:
      'Use the context for independent practice: main ideas, short explanations, opinions, and supported native material.',
    moves: [
      'Ask for summaries, preferences, and simple arguments about the topics.',
      'Mix adapted readings with brief authentic excerpts.',
      'Repair recurring gaps with targeted grammar and recall checks.',
    ],
    icon: 'book',
  },
  B2: {
    diagnosis:
      'Let the context stay recognizable while increasing speed, abstraction, argument structure, and precision.',
    moves: [
      'Move from summaries into stance, cause, tradeoffs, and nuance.',
      'Use longer readings and listening passages with fewer supports.',
      'Score output for accuracy, register, and natural phrasing.',
    ],
    icon: 'graph',
  },
  C1: {
    diagnosis:
      'Use the context almost directly: long-form input, implied meaning, register shifts, and controlled reformulation.',
    moves: [
      'Practice explaining the same idea in formal, casual, and concise registers.',
      'Use authentic source excerpts with narrow correction passes.',
      'Focus on idiom, precision, rhetorical structure, and speed.',
    ],
    icon: 'spark',
  },
  C2: {
    diagnosis:
      'Treat the context as native-level material and polish exact wording, style, cultural inference, irony, and compression.',
    moves: [
      'Push toward unscaffolded reading, listening, and spontaneous response.',
      'Use style imitation, paraphrase, and high-precision correction.',
      'Tune for subtle distinctions rather than broad comprehension.',
    ],
    icon: 'flame',
  },
};

function compact(value: string, max = 150) {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 3).trim()}...` : oneLine;
}

function cleanCandidate(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/^file:\s*/i, '')
    .replace(/^uploaded placement material:\s*/i, '')
    .replace(/^uploaded file reference:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/g, '');
}

function candidateParts(value: string) {
  return value
    .split(/\n|,|;|\u2022|\s+-\s+|\s+and\s+/i)
    .map(cleanCandidate)
    .filter((part) => part.length >= 3 && part.length <= 80);
}

function topicSignals(items: ContextItem[]) {
  const seen = new Set<string>();
  const signals: string[] = [];

  for (const item of items) {
    const raw =
      item.kind === 'topic' || item.kind === 'music' || item.kind === 'book'
        ? [item.label, ...candidateParts(item.value)]
        : item.kind === 'article' || item.kind === 'link'
          ? [item.label]
          : [item.label];

    for (const candidate of raw.map(cleanCandidate).filter(Boolean)) {
      const key = candidate.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      signals.push(candidate);
      if (signals.length >= 7) return signals;
    }
  }

  return signals;
}

function contextMix(items: ContextItem[]) {
  const counts = items.reduce<Record<ContextItemKind, number>>(
    (acc, item) => {
      acc[item.kind] += 1;
      return acc;
    },
    { link: 0, book: 0, article: 0, music: 0, topic: 0, file: 0, text: 0 }
  );

  return Object.entries(counts)
    .filter((entry): entry is [ContextItemKind, number] => entry[1] > 0)
    .map(([kind, count]) => `${count} ${KIND_LABELS[kind]}`)
    .join(', ');
}

function firstPlanItems(topics: string[], lvl: CefrLevel) {
  const anchor = topics[0] ?? 'your submitted context';
  const second = topics[1] ?? 'the same material';
  const advanced = lvl === 'C1' || lvl === 'C2';

  return [
    {
      icon: 'book' as const,
      title: 'Reading',
      body: advanced
        ? `Start with authentic excerpts around ${anchor}, then ask for tone, implication, and reformulation.`
        : `Start with short adapted readings around ${anchor}, then unlock harder source excerpts.`,
    },
    {
      icon: 'wave' as const,
      title: 'Listening',
      body: `Build listening scenes from ${second}, with speed and support matched to CEFR ${lvl}.`,
    },
    {
      icon: 'mic' as const,
      title: 'Speaking',
      body: `Practice explaining, asking about, and reacting to ${anchor} instead of generic travel phrases.`,
    },
    {
      icon: 'graph' as const,
      title: 'Vocabulary',
      body: 'Seed the memory graph with useful words from the context, then gate recall before new material.',
    },
  ];
}

export function StepContextReview({
  baseLang,
  language,
  level,
  contextItems,
  onNext,
  onBack,
}: Props) {
  const lvl = level ?? 'A2';
  const target = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
  const base = BASE_LANGS.find((b) => b.code === baseLang) ?? BASE_LANGS[0];
  const guide = PLACEMENT_LEVEL_GUIDES[baseLang]?.[lvl] ?? PLACEMENT_LEVEL_GUIDES.en[lvl];
  const approach = LEVEL_APPROACH[lvl];
  const topics = topicSignals(contextItems);
  const planItems = firstPlanItems(topics, lvl);
  const mix = contextMix(contextItems);

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>07 ·</span> Read context
      </div>
      <h1 className={t.title}>
        Review the <em>teaching brief</em>.
      </h1>
      <p className={t.lede}>
        Before composing, Sotto reads only the context you gave it and turns that into a teacher
        brief: what to lean on, how hard to push, and where the first lessons should begin.
      </p>

      <section className={c.reviewShell} aria-label="Context teaching brief">
        <div className={c.reviewPanel}>
          <div className={c.reviewPanelHead}>
            <span className={c.reviewKicker}>Extracted context</span>
            <span className={c.reviewCount}>
              {contextItems.length} item{contextItems.length === 1 ? '' : 's'}
            </span>
          </div>
          {contextItems.length > 0 ? (
            <div className={c.reviewContextList}>
              {contextItems.map((item) => (
                <div key={item.id} className={c.reviewContextItem}>
                  <span className={c.reviewKind}>{KIND_LABELS[item.kind]}</span>
                  <span className={c.reviewContextText}>
                    <span className={c.reviewContextLabel}>{item.label}</span>
                    <span className={c.reviewContextPreview}>{compact(item.value)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={c.reviewEmpty}>
              No context has been added yet. Go back and add at least one note, topic, source, file,
              or material sample.
            </p>
          )}
        </div>

        <div className={c.reviewPanel}>
          <div className={c.reviewPanelHead}>
            <span className={c.reviewKicker}>Teacher read</span>
            <span className={c.reviewCount}>CEFR {lvl}</span>
          </div>
          <p className={c.reviewDiagnosis}>
            You are learning {target.name} from {base.name}. Placement says CEFR {lvl}
            {guide ? `, ${guide.title.toLocaleLowerCase()}` : ''}. The context mix is{' '}
            {mix || 'limited'}, so the course should make those references do real work rather than
            treat them as decoration.
          </p>
          <p className={c.reviewDiagnosis}>{approach.diagnosis}</p>
        </div>
      </section>

      <section className={c.reviewTopics} aria-label="Interesting topics to lean on">
        <div>
          <span className={c.reviewKicker}>Interesting topics to lean on</span>
          <div className={c.reviewTopicChips}>
            {(topics.length ? topics : ['your submitted context']).map((topic) => (
              <span key={topic} className={c.reviewTopicChip}>
                {topic}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className={c.reviewStrategyGrid} aria-label="Course approach">
        <div className={c.reviewStrategy}>
          <span className={c.reviewStrategyIcon}>
            <Glyph name={approach.icon} size={18} />
          </span>
          <div>
            <span className={c.reviewKicker}>Approach</span>
            <ul className={c.reviewMoveList}>
              {approach.moves.map((move) => (
                <li key={move}>{move}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className={c.reviewStrategy}>
          <span className={c.reviewStrategyIcon}>
            <Glyph name="spark" size={18} />
          </span>
          <div>
            <span className={c.reviewKicker}>Course focus</span>
            <p className={c.reviewStrategyCopy}>
              {guide?.course ??
                'Build a course that connects your submitted context to structured practice.'}
            </p>
          </div>
        </div>
      </section>

      <section className={c.reviewPlanGrid} aria-label="First lesson priorities">
        {planItems.map((item) => (
          <div key={item.title} className={c.reviewPlanItem}>
            <span className={c.reviewPlanIcon}>
              <Glyph name={item.icon} size={17} />
            </span>
            <span>
              <b>{item.title}</b>
              <small>{item.body}</small>
            </span>
          </div>
        ))}
      </section>

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onBack}>
          ← Back
        </button>
        <span className={t.spacer} />
        <button
          className={`${t.btn} ${t.btnPrimary}`}
          disabled={contextItems.length === 0 || !level}
          onClick={onNext}
        >
          Compose from this brief{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
