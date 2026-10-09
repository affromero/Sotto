import { buildListeningSourceUnits } from '../listening-audit/passage-witness';
import { literalQuestionCompletions } from '../../section-quality';
import type { requestTeachingReview } from '../teaching-quality';

/** Keep source evidence and proposed operands visible without exposing approval labels. */
export function teachingReviewCandidate(options: Parameters<typeof requestTeachingReview>[0]) {
  return {
    ...(options.introContext ? { introContext: options.introContext } : {}),
    ...(options.listeningSource !== undefined ? { listeningSource: options.listeningSource } : {}),
    ...(options.listeningTurns
      ? {
          listeningTurns: options.listeningTurns,
          listeningUnits: buildListeningSourceUnits(
            options.items[0],
            options.listeningTurns,
            options.variables.TARGET
          ),
        }
      : {}),
    ...(options.criticAssignment ? { criticAssignment: options.criticAssignment } : {}),
    items: options.items.map((content, index) => {
      const completedOptions =
        options.variables.KIND === 'explanations' ? literalQuestionCompletions(content) : undefined;
      return {
        index,
        content,
        ...(completedOptions ? { completedOptions } : {}),
        ...(options.sourceParts ? { sourceParts: options.sourceParts[index] } : {}),
      };
    }),
    ...(options.criticisms
      ? {
          criticisms: {
            items: options.criticisms.items.map(({ index, findings, passageWitness }) => ({
              index,
              findings,
              ...(passageWitness
                ? {
                    passagePairs: passageWitness.pairs.map((pair) => ({
                      pairIndex: pair.pairIndex,
                      premiseUnitIndex: pair.premiseUnitIndex,
                      exampleUnitIndex: pair.exampleUnitIndex,
                      premiseMeaning: pair.premiseMeaning,
                      exampleMeaning: pair.exampleMeaning,
                      relation: pair.relation,
                    })),
                  }
                : {}),
            })),
          },
        }
      : {}),
    ...(options.readingPassageReview
      ? {
          readingPassageReview: {
            passageFeedback: options.readingPassageReview.passageFeedback.map(
              ({ quote, reason }, concernIndex) => ({ concernIndex, quote, reason })
            ),
          },
        }
      : {}),
    ...(options.listeningPassageReview
      ? {
          listeningPassageReview: {
            passageFeedback: options.listeningPassageReview.passageFeedback.map(
              ({ quote, reason }, concernIndex) => ({ concernIndex, quote, reason })
            ),
          },
        }
      : {}),
  };
}
