import { z } from 'zod';
import { buildTeachingSourceParts } from './protocol';

const constraintKinds = ['actor', 'action', 'time_order', 'negation', 'quantity', 'scope'] as const;
const partIndex = z.number().int().nonnegative();
const passageIndices = z.array(partIndex).max(3);
const supportStatus = z.enum(['supported', 'contradicted', 'unstated']);

const evidenceShape = {
  options: z
    .array(
      z
        .object({
          optionIndex: z.number().int().min(0).max(3),
          status: supportStatus,
          passagePartIndices: passageIndices,
        })
        .strict()
    )
    .length(4),
  constraints: z
    .array(
      z
        .object({
          kind: z.enum(constraintKinds),
          status: z.enum(['satisfied', 'violated', 'unstated', 'not_applicable']),
          questionPartIndex: partIndex.nullable(),
          passagePartIndices: passageIndices,
          reason: z.string().trim().min(1).max(80),
        })
        .strict()
    )
    .length(6),
  explanation: z
    .object({
      status: supportStatus,
      explanationPartIndex: partIndex,
      passagePartIndices: passageIndices,
      reason: z.string().trim().min(1).max(100),
    })
    .strict(),
};

function checkEvidence(
  value: z.infer<ReturnType<typeof unboundSchema>>,
  context: z.RefinementCtx
): void {
  const invalid = (path: PropertyKey[]) =>
    context.addIssue({ code: 'custom', path, message: 'Invalid reading answer-support evidence.' });
  if (new Set(value.options.map((option) => option.optionIndex)).size !== 4) invalid(['options']);
  if (new Set(value.constraints.map((constraint) => constraint.kind)).size !== 6)
    invalid(['constraints']);
  function checkPassage(indices: number[], required: boolean, path: PropertyKey[]) {
    if (new Set(indices).size !== indices.length || (required && indices.length === 0))
      invalid(path);
  }
  value.options.forEach((option, index) =>
    checkPassage(option.passagePartIndices, option.status !== 'unstated', [
      'options',
      index,
      'passagePartIndices',
    ])
  );
  value.constraints.forEach((constraint, index) => {
    const absent = constraint.status === 'not_applicable';
    if (
      absent !== (constraint.questionPartIndex === null) ||
      (absent && constraint.passagePartIndices.length !== 0)
    )
      invalid(['constraints', index]);
    checkPassage(
      constraint.passagePartIndices,
      constraint.status === 'satisfied' || constraint.status === 'violated',
      ['constraints', index, 'passagePartIndices']
    );
  });
  checkPassage(value.explanation.passagePartIndices, value.explanation.status !== 'unstated', [
    'explanation',
    'passagePartIndices',
  ]);
}

function unboundSchema() {
  return z.object(evidenceShape).strict();
}

/** Optional in historical packets; new reading provider responses require the bound schema. */
export const readingAnswerSupportEvidenceSchema = unboundSchema().superRefine(checkEvidence);
export type ReadingAnswerSupport = z.infer<typeof readingAnswerSupportEvidenceSchema>;

/** Evidence addresses only the exact current question, options, explanation and passage. */
export function readingAnswerSupportSchema(fields: unknown) {
  if (!fields || typeof fields !== 'object')
    throw new Error('Reading support requires question fields.');
  const item = fields as Record<string, unknown>;
  for (const key of ['question', 'explanation', 'passageText'])
    if (!Object.hasOwn(item, key) || typeof item[key] !== 'string' || !item[key].trim())
      throw new Error('Reading support requires complete question fields.');
  if (
    !Object.hasOwn(item, 'options') ||
    !Array.isArray(item.options) ||
    item.options.length !== 4 ||
    item.options.some((option) => typeof option !== 'string' || !option.trim())
  )
    throw new Error('Reading support requires four options.');
  const parts = buildTeachingSourceParts(fields);
  function domain(field: string) {
    const indices = parts
      .filter((part) => part.fieldPath.length === 1 && part.fieldPath[0] === field)
      .map((part) => part.index);
    if (!indices.length) throw new Error('Reading support requires source addresses.');
    return z.literal(indices);
  }
  const passage = z.array(domain('passageText')).max(3);
  return z
    .object({
      options: z
        .array(evidenceShape.options.element.extend({ passagePartIndices: passage }))
        .length(4),
      constraints: z
        .array(
          evidenceShape.constraints.element.extend({
            questionPartIndex: domain('question').nullable(),
            passagePartIndices: passage,
          })
        )
        .length(6),
      explanation: evidenceShape.explanation.extend({
        explanationPartIndex: domain('explanation'),
        passagePartIndices: passage,
      }),
    })
    .strict()
    .superRefine(checkEvidence);
}

export function parseReadingAnswerSupport(value: unknown, fields: unknown): ReadingAnswerSupport {
  return readingAnswerSupportSchema(fields).parse(value);
}

/** A complete semantic negative rejects directly, even when ordinary findings are empty. */
export function readingAnswerSupportFailure(
  witness: ReadingAnswerSupport,
  correctIndex: number
): string | undefined {
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3)
    throw new Error('Reading support requires a valid key.');
  const supported = witness.options
    .filter((option) => option.status === 'supported')
    .map((option) => option.optionIndex);
  const failed = witness.constraints.filter(
    (constraint) => constraint.status !== 'satisfied' && constraint.status !== 'not_applicable'
  );
  const failures: string[] = [];
  if (supported.length !== 1 || supported[0] !== correctIndex)
    failures.push(`options=[${supported.join(',')}] key=${correctIndex}`);
  if (failed.length) failures.push(`constraints=${failed.map((check) => check.kind).join(',')}`);
  if (witness.explanation.status !== 'supported')
    failures.push(`explanation=${witness.explanation.status}`);
  if (!failures.length) return undefined;
  const reason =
    failed[0]?.reason ??
    (witness.explanation.status !== 'supported' ? witness.explanation.reason : undefined);
  return `Reading answer support failed: ${failures.join('; ')}.${reason ? ` Untrusted witness reason: ${reason}` : ''}`;
}
