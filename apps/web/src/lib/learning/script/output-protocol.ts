import type { GeneratedVocabularyEntry, ScriptTurn } from '../../script-generator';

const messages = {
  script_vocabulary_duplicate_number: 'Script vocabulary contains duplicate entry numbers.',
  script_vocabulary_ambiguous_identity: 'Script vocabulary marker has an ambiguous entry identity.',
  script_vocabulary_missing_identity: 'Script vocabulary marker has no matching entry.',
} as const;

export type ScriptOutputProtocolCode = keyof typeof messages;
export type ScriptOutputProtocolFailure = {
  candidate: string | null;
  issues: Array<{ code: ScriptOutputProtocolCode }>;
};

/** Only canonical marker validation can attach actual rejected output. */
export class ScriptOutputProtocolError extends Error {
  constructor(code: ScriptOutputProtocolCode) {
    super(messages[code]);
    this.name = 'ScriptOutputProtocolError';
  }
}

const failures = new WeakMap<object, ScriptOutputProtocolFailure>();

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
  function reject(code: ScriptOutputProtocolCode): never {
    const error = new ScriptOutputProtocolError(code);
    failures.set(error, {
      candidate: Buffer.byteLength(rawCandidate, 'utf8') <= 32 * 1024 ? rawCandidate : null,
      issues: [{ code }],
    });
    throw error;
  }
  const byNumber = new Map(vocabulary.map((entry) => [entry.number, entry]));
  if (byNumber.size !== vocabulary.length) reject('script_vocabulary_duplicate_number');
  return turns.map((turn) => ({
    ...turn,
    text: turn.text.replace(/\[V(\d+):([^\]]+)\]/g, (marker, number: string, word: string) => {
      const current = byNumber.get(Number(number));
      if (current?.word === word) return marker;
      const matches = vocabulary.filter((entry) => entry.word === word);
      if (matches.length === 1) return `[V${matches[0].number}:${word}]`;
      if (matches.length > 1) reject('script_vocabulary_ambiguous_identity');
      if (!current) reject('script_vocabulary_missing_identity');
      return marker;
    }),
  }));
}
