import type { GeneratedVocabularyEntry, ScriptTurn } from '../../script-generator';
import { cleanTextForTts } from '../../tts-text-cleaner';
import { stripInlineAudioTags } from '../../tts-expression-mapper';

export const MAX_DIALOGUE_TURN_WORDS = 60;

const messages = {
  script_vocabulary_duplicate_number: 'Script vocabulary contains duplicate entry numbers.',
  script_vocabulary_ambiguous_identity: 'Script vocabulary marker has an ambiguous entry identity.',
  script_vocabulary_missing_identity: 'Script vocabulary marker has no matching entry.',
  script_dialogue_unknown_speaker: 'Listening dialogue uses a speaker outside the supplied list.',
  script_dialogue_missing_exchange: 'Listening dialogue needs at least two supplied speakers.',
  script_dialogue_turn_too_long: `Listening dialogue turns must contain at most ${MAX_DIALOGUE_TURN_WORDS} spoken words.`,
  script_dialogue_embedded_speaker: 'Listening dialogue must put each speaker in a separate turn.',
} as const;

export type ScriptOutputProtocolCode = keyof typeof messages;
export type ScriptOutputProtocolFailure = {
  candidate: string | null;
  issues: Array<{ code: ScriptOutputProtocolCode }>;
};

/** Only canonical script validation can attach actual rejected output. */
export class ScriptOutputProtocolError extends Error {
  constructor(code: ScriptOutputProtocolCode) {
    super(messages[code]);
    this.name = 'ScriptOutputProtocolError';
  }
}

const failures = new WeakMap<object, ScriptOutputProtocolFailure>();

function reject(code: ScriptOutputProtocolCode, rawCandidate: string): never {
  const error = new ScriptOutputProtocolError(code);
  failures.set(error, {
    candidate: Buffer.byteLength(rawCandidate, 'utf8') <= 32 * 1024 ? rawCandidate : null,
    issues: [{ code }],
  });
  throw error;
}

export function scriptOutputProtocolFailure(
  error: unknown
): ScriptOutputProtocolFailure | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const failure = failures.get(error);
  return (
    failure && {
      candidate: failure.candidate,
      issues: failure.issues.map((issue) => ({ ...issue })),
    }
  );
}

/** Preserve unique exact-word alignment; ambiguous identities never select a translation. */
export function alignScriptVocabularyMarkers(
  turns: ScriptTurn[],
  vocabulary: GeneratedVocabularyEntry[],
  rawCandidate: string
): ScriptTurn[] {
  const byNumber = new Map(vocabulary.map((entry) => [entry.number, entry]));
  if (byNumber.size !== vocabulary.length)
    reject('script_vocabulary_duplicate_number', rawCandidate);
  return turns.map((turn) => ({
    ...turn,
    text: turn.text.replace(/\[V(\d+):([^\]]+)\]/g, (marker, number: string, word: string) => {
      const current = byNumber.get(Number(number));
      if (current?.word === word) return marker;
      const matches = vocabulary.filter((entry) => entry.word === word);
      if (matches.length === 1) return `[V${matches[0].number}:${word}]`;
      if (matches.length > 1) reject('script_vocabulary_ambiguous_identity', rawCandidate);
      if (!current) reject('script_vocabulary_missing_identity', rawCandidate);
      return marker;
    }),
  }));
}

/** Preserve one bounded, explicitly attributed audio segment per dialogue turn. */
export function assertLearningDialogue(
  turns: readonly ScriptTurn[],
  options: { speakers: readonly { name: string }[]; locale?: string | null },
  rawCandidate: string
): void {
  const supplied = new Set(options.speakers.map((speaker) => speaker.name));
  if (supplied.size < 2) return;
  const segmenter = new Intl.Segmenter(options.locale ?? undefined, { granularity: 'word' });
  const names = [...supplied].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const speakerLabel = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${names.join('|')})\\s*:`, 'iu');
  for (const turn of turns) {
    if (!supplied.has(turn.speaker)) reject('script_dialogue_unknown_speaker', rawCandidate);
    const spoken = stripInlineAudioTags(cleanTextForTts(turn.text));
    const words = [...segmenter.segment(spoken)].filter((word) => word.isWordLike).length;
    if (words > MAX_DIALOGUE_TURN_WORDS) reject('script_dialogue_turn_too_long', rawCandidate);
    if (speakerLabel.test(turn.text)) reject('script_dialogue_embedded_speaker', rawCandidate);
  }
  if (new Set(turns.map((turn) => turn.speaker)).size < 2)
    reject('script_dialogue_missing_exchange', rawCandidate);
}
