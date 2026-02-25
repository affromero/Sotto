export interface ClaimContext {
  sentences: string[]; // sentences from script turns that cite this reference
  speakerTurns: string[]; // which speaker made each claim
}

export function extractClaimContexts(
  turns: Array<{ speaker: string; text: string }>,
  referenceNumbers: number[]
): Map<number, ClaimContext> {
  const result = new Map<number, ClaimContext>();
  for (const num of referenceNumbers) {
    const contexts: ClaimContext = { sentences: [], speakerTurns: [] };
    for (const turn of turns) {
      const sentences = turn.text.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (new RegExp(`\\[${num}\\]`).test(sentence)) {
          contexts.sentences.push(sentence.replace(/\[\d+\]/g, '').trim());
          contexts.speakerTurns.push(turn.speaker);
        }
      }
    }
    result.set(num, contexts);
  }
  return result;
}
