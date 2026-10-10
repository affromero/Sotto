import {
  mockBlindResponse,
  mockTeachingResponse,
  SAMPLE_SCRIPT_RESULT,
} from '../../../helpers/runtime/listening-generation';

export function singleTurnScriptResponseFixture(text: string, schemaName?: string) {
  return JSON.stringify(
    schemaName === 'learning_script_turn_repair'
      ? { turnTexts: { '1': text } }
      : { ...SAMPLE_SCRIPT_RESULT, turns: [{ speaker: 'HOST', text }] }
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
