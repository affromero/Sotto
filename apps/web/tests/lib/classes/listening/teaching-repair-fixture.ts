import {
  mockBlindResponse,
  mockTeachingResponse,
} from '../../../helpers/runtime/listening-generation';

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
      content: { passageText: string; question: string };
    }>;
    return {
      model: 'm',
      content: JSON.stringify({
        items: items.map(({ index, content }) => {
          const rejected = content.passageText.includes(firstText);
          const findings = rejected
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
                ...(mixed
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
