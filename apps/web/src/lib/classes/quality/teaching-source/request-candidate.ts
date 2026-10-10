import { buildListeningSourceUnits } from '../listening-audit/passage-witness';
import { literalQuestionCompletions } from '../../section-quality';
import { teachingFindingSource } from '../teaching-review-protocol';
import type { requestTeachingReview } from '../teaching-quality';

/** Keep source evidence and proposed operands visible without exposing approval labels. */
export function teachingReviewCandidate(options: Parameters<typeof requestTeachingReview>[0]) {
  const listeningUnits = options.listeningTurns
    ? buildListeningSourceUnits(options.items[0], options.listeningTurns, options.variables.TARGET)
    : undefined;
  return {
    ...(options.introContext ? { introContext: options.introContext } : {}),
    ...(options.novelFindingProposals
      ? { novelFindingProposals: options.novelFindingProposals }
      : {}),
    ...(options.listeningSource !== undefined ? { listeningSource: options.listeningSource } : {}),
    ...(options.listeningTurns
      ? {
          listeningTurns: options.listeningTurns,
          listeningUnits,
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
              ...(options.introContext
                ? {
                    findingSources: findings.map((finding, findingIndex) => ({
                      findingIndex,
                      sourceText: teachingFindingSource(
                        finding,
                        (options.items[index] as { fields: unknown } | undefined)?.fields
                      ),
                    })),
                  }
                : {}),
              ...(passageWitness
                ? {
                    passagePairs: passageWitness.pairs.map((pair) => {
                      const premiseUnit = listeningUnits?.units[pair.premiseUnitIndex];
                      const exampleUnit = listeningUnits?.units[pair.exampleUnitIndex];
                      if (!premiseUnit || !exampleUnit)
                        throw new Error('Listening teaching operands require bound source units.');
                      return {
                        pairIndex: pair.pairIndex,
                        premiseUnitIndex: pair.premiseUnitIndex,
                        exampleUnitIndex: pair.exampleUnitIndex,
                        premiseUnit,
                        exampleUnit,
                        relation: pair.relation,
                      };
                    }),
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
