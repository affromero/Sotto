import {
  mockBlindResponse,
  mockTeachingResponse,
  SAMPLE_SCRIPT_RESULT,
} from '../../../helpers/runtime/listening-generation';

export function dialogueTurnsFixture(text: string, long = false) {
  if (long)
    return Array.from({ length: 30 }, (_, index) => ({
      speaker: index % 2 === 0 ? 'HOST' : 'EXPERT',
      text: ((index === 0 ? text : '') + ' Hallo.'.repeat(50)).trim(),
    }));
  return [
    { speaker: 'HOST', text },
    { speaker: 'EXPERT', text: 'Danke für die Erklärung.' },
  ];
}

export function dialogueTranscriptFixture(text: string, long = false) {
  return dialogueTurnsFixture(text, long)
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join('\n');
}

export function dialogueScriptResponseFixture(text: string, schemaName?: string, long = false) {
  const turns = dialogueTurnsFixture(text, long);
  return JSON.stringify(
    schemaName === 'learning_script_turn_repair'
      ? { turnTexts: long ? { '1': turns[0].text } : { '1': text, '2': turns[1].text } }
      : { ...SAMPLE_SCRIPT_RESULT, turns }
  );
}

export function configureSpokenTeachingRejection(
  approved: unknown,
  firstText: string,
  finalText: string,
  mixed = false
) {
  mockBlindResponse.mockResolvedValue({ content: JSON.stringify(approved), model: 'm' });
  mockTeachingResponse.mockImplementation(async (...args) => {
    const items = JSON.parse(args[1][0].content).items as Array<{
      index: number;
      content: { passageText?: string; question?: string };
    }>;
    const rejectedScript = items[0].content.passageText?.includes(firstText);
    return {
      model: 'm',
      content: JSON.stringify({
        items: items.map(({ index, content }) => {
          const rejected = rejectedScript && (index === 0 || (mixed && index === 1));
          const findings = rejected
            ? [
                ...(index === 0
                  ? [
                      {
                        issue: 'unnatural',
                        fieldPath: ['passageText'],
                        quote: firstText,
                        rule: 'Grammar terminology must be accurate.',
                        defect: 'Endlich does not mean finite.',
                        correction: finalText,
                        counterexample: null,
                      },
                    ]
                  : []),
                ...(index === 1
                  ? [
                      {
                        issue: 'unsupported',
                        fieldPath: ['question'],
                        quote: content.question,
                        rule: 'Questions must match the script.',
                        defect: 'Review this question against the corrected script.',
                        correction: 'Use facts from the corrected script.',
                        counterexample: null,
                      },
                    ]
                  : []),
              ]
            : [];
          return {
            index,
            acceptable: !rejected,
            issues: [...new Set(findings.map((f) => f.issue))],
            feedback: rejected ? ['Correct the spoken grammatical explanation.'] : [],
            findings,
            criticDecisions: [],
          };
        }),
      }),
    };
  });
}
