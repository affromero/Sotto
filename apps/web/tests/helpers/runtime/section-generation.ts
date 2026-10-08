export const GENERATED_PASSAGE =
  'En el laboratorio, la científica Marta encontró una nota antigua y decidió investigar.';

export const SAMPLE_QUESTIONS = [
  {
    question: '¿Qué descubrió el científico?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: 'x',
    passageRef: 'L1',
  },
  {
    question: '¿Cuándo ocurrió?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 1,
    explanation: 'y',
  },
];
SAMPLE_QUESTIONS.push(
  ...[2, 3, 4].map((index) => ({
    ...SAMPLE_QUESTIONS[0],
    question: `Question ${index}`,
    correctIndex: 0,
  }))
);

export const SAMPLE_SECTION_RESPONSE = JSON.stringify({
  passage: GENERATED_PASSAGE,
  questions: SAMPLE_QUESTIONS,
});
