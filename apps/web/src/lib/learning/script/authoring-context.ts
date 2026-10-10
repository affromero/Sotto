export function scriptSpeakerDescription(role: 'HOST' | 'EXPERT', forLearning?: boolean): string {
  if (forLearning)
    return role === 'HOST'
      ? "An ordinary participant in the situation. Asks natural questions and shares relevant experiences in simple, idiomatic language at the learner's CEFR level."
      : "An ordinary conversation partner in the same situation. Responds naturally and describes concrete experiences in simple, idiomatic language at the learner's CEFR level.";
  return role === 'HOST'
    ? 'Warm, curious, asks great questions, guides the conversation. Represents the listener. Reacts naturally — laughs, expresses surprise, interjects with short reactions.'
    : 'Knowledgeable, vivid storyteller, uses analogies, examples, and occasionally humor. Explains complex topics in ways that create "aha" moments.';
}

export function scriptObjectiveInstruction(topic: string, forLearning?: boolean): string {
  return forLearning
    ? `Communicative objective: ${topic}\nUse the objective's language forms within a concrete situation the speakers experience. The objective describes what to practice in conversation, not a topic for the speakers to explain.`
    : `Topic: ${topic}`;
}

export function scriptReviewTargetInstruction(mode?: string | null, forLearning?: boolean): string {
  return forLearning && mode === 'full_immersion'
    ? 'Use these targets naturally in the concrete situation. Reuse them where the conversation calls for them, without adding a spoken vocabulary checkpoint'
    : 'Prioritize these targets for anticipation and recall';
}
