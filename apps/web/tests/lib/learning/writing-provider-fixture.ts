export const SAMPLE_PROMPTS = [
  {
    taskType: 'guided_reply',
    sourceText: 'Dinner invitation for Thursday. Accept. You can arrive at 19:00.',
    starterText: null,
    task: 'Reply to a friend inviting you to dinner.',
    guidance: 'Accept and suggest a time.',
    ideas: ['Gracias,', 'Gracias, me encantaría.'],
    modelAnswer: 'Gracias, me encantaría. Puedo llegar el jueves a las siete.',
    correctionReason: null,
  },
  {
    task: 'Correct the sentence.',
    taskType: 'correction',
    sourceText: 'Ayer yo va al cine.',
    starterText: null,
    modelAnswer: 'Ayer yo fui al cine.',
    correctionReason: 'Use the first-person preterite for the completed action yesterday.',
    guidance: null,
    ideas: null,
  },
  {
    task: 'Complete the supplied sentence.',
    taskType: 'completion',
    sourceText: 'Use the contraction of a and el before cine.',
    starterText: 'Mañana vamos',
    modelAnswer: 'Mañana vamos al cine.',
    correctionReason: null,
    guidance: null,
    ideas: null,
  },
];

export const writingResponse = (prompts: unknown) => JSON.stringify({ prompts });
