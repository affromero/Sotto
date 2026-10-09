export const approved = {
  passageFindings: [],
  issues: [],
  questions: [0, 2, 0, 2].map((key, index) => ({
    index,
    acceptableOptionIndices: [key],
    issues: [],
  })),
};
export const firstText = '„Bin“ ist hier endlich und passt zu „ich“.';
export const finalText = '„Bin“ ist die konjugierte Form von „sein“ und passt zu „ich“.';
export const rejected = {
  ...approved,
  issues: ['unnatural'],
  passageFindings: [
    { sourcePartIndex: 0, issue: 'unnatural', reason: 'Endlich does not mean finite.' },
  ],
};
export const finalRejected = {
  ...rejected,
  passageFindings: [
    {
      sourcePartIndex: 0,
      issue: 'unnatural',
      reason: 'The replacement still fails the supplied review.',
    },
  ],
};
export const causalBlindRejection = {
  ...approved,
  questions: approved.questions.map((item) =>
    item.index === 0 ? { ...item, acceptableOptionIndices: [1], issues: ['incorrect'] } : item
  ),
};
