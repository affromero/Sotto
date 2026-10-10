import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CapturedLearningAi } from '../../../learning-ai';
import { learningCredentialFingerprint } from '../../preparation-selection';
import { teachingReviewCandidate } from './request-candidate';
import type { requestTeachingReview } from './request';
import {
  ReviewerProtocolError,
  parseTeachingNovelFindingCorroborationResponse,
  teachingNovelFindingCorroborationResponseSchema,
  type TeachingAdjudicator,
  type TeachingCritic,
  type TeachingNovelFindingCorroboration,
  type TeachingNovelFindingProposal,
  type TeachingReviewPacket,
} from '../teaching-review-protocol';

type ReviewRequest = Parameters<typeof requestTeachingReview>[0];
type Receipt = {
  status: 'pending' | 'completed' | 'failed';
  candidateSha256: string;
  candidate: unknown;
  context: Record<string, string>;
  originalCandidate: unknown;
  originalContext: Record<string, string>;
  originalCritic: TeachingCritic | undefined;
  authority: {
    provider: string;
    model: string;
    endpoint: string | undefined;
    userId: string;
    credentialFingerprint: string | null;
  };
  originalAdjudicatorResponse: string;
  originalAdjudicator: TeachingAdjudicator;
  response: string | null;
  decisions: TeachingNovelFindingCorroboration['decisions'] | null;
  passageConcernDecisions: TeachingNovelFindingCorroboration['passageConcernDecisions'] | null;
  adjudicator: TeachingAdjudicator | null;
};
const receipts = new WeakMap<CapturedLearningAi, Receipt[]>();

/** Private evidence lives only as long as this exact captured execution selection. */
export function teachingNovelFindingReceipts(ai: CapturedLearningAi): readonly Receipt[] {
  return structuredClone(receipts.get(ai) ?? []);
}

/** Independently corroborate only the ordinary findings first proposed by the adjudicator. */
export async function corroborateTeachingAdjudicator(options: {
  originalResponse: string;
  originalAdjudicator: TeachingAdjudicator;
  baseRequest: ReviewRequest;
  parse: (content: string) => TeachingAdjudicator;
  request: (
    request: ReviewRequest,
    parse: (content: string) => TeachingNovelFindingCorroboration,
    capture: (content: string) => void
  ) => Promise<TeachingNovelFindingCorroboration>;
}): Promise<Pick<TeachingReviewPacket, 'adjudicator' | 'novelFindingCorroboration'>> {
  const original = options.originalAdjudicator;
  const proposals: TeachingNovelFindingProposal[] = original.items.flatMap((item) => {
    const prefix = item.criticDecisions.filter(
      (decision) => decision.decision === 'supported'
    ).length;
    return item.findings.slice(prefix).map((finding, index) => {
      const findingIndex = prefix + index;
      const passageConcerns = (original.passageConcernDecisions ?? []).flatMap((concern) => {
        if (
          concern.decision !== 'supported' ||
          concern.itemIndex !== item.index ||
          concern.findingIndex !== findingIndex
        )
          return [];
        const source = (
          options.baseRequest.readingPassageReview ?? options.baseRequest.listeningPassageReview
        )?.passageFeedback[concern.concernIndex];
        if (!source) throw new ReviewerProtocolError();
        return [{ concernIndex: concern.concernIndex, quote: source.quote, reason: source.reason }];
      });
      return {
        itemIndex: item.index,
        findingIndex,
        finding: structuredClone(finding),
        ...(passageConcerns.length ? { passageConcerns } : {}),
      };
    });
  });
  if (!proposals.length) return { adjudicator: original };
  const retained = receipts.get(options.baseRequest.ai) ?? [];
  if (retained.length >= 64) throw new ReviewerProtocolError();
  const schema = {
    name: 'class_teaching_novel_finding_corroboration',
    strict: true,
    schema: z.toJSONSchema(teachingNovelFindingCorroborationResponseSchema(proposals)),
  };
  const request: ReviewRequest = {
    ...options.baseRequest,
    criticisms: undefined,
    criticAssignment: undefined,
    protocolCorrection: undefined,
    prompt: 'class/review-teaching-novel-findings.md',
    novelFindingProposals: proposals,
    jsonSchema: schema,
    variables: {
      ...options.baseRequest.variables,
      INTRO_REVIEW_ROLE: 'corroborator',
      TEACHING_REVIEW_ROLE: 'corroborator',
      REVIEW_SCHEMA: JSON.stringify(schema.schema),
    },
  };
  const candidate = teachingReviewCandidate(request);
  const authority = {
    provider: request.ai.provider,
    model: request.ai.model,
    endpoint: request.ai.endpoint,
    userId: request.userId,
    credentialFingerprint: learningCredentialFingerprint(request.ai.execution.credential),
  };
  const receipt: Receipt = {
    status: 'pending',
    candidateSha256: createHash('sha256')
      .update(JSON.stringify({ candidate, context: request.variables, authority }))
      .digest('hex'),
    candidate: structuredClone(candidate),
    context: structuredClone(request.variables),
    originalCandidate: structuredClone(teachingReviewCandidate(options.baseRequest)),
    originalContext: structuredClone(options.baseRequest.variables),
    originalCritic: structuredClone(options.baseRequest.criticisms),
    authority,
    originalAdjudicatorResponse: options.originalResponse,
    originalAdjudicator: structuredClone(original),
    response: null,
    decisions: null,
    passageConcernDecisions: null,
    adjudicator: null,
  };
  const receiptIndex = retained.length;
  retained.push(receipt);
  receipts.set(request.ai, retained);
  try {
    const verification = await options.request(
      request,
      (content) => parseTeachingNovelFindingCorroborationResponse(content, proposals),
      (content) => {
        receipt.response = content;
      }
    );
    receipt.decisions = structuredClone(verification.decisions);
    receipt.passageConcernDecisions = structuredClone(verification.passageConcernDecisions);
    if (
      verification.decisions.some((decision) => decision.decision === 'uncertain') ||
      verification.passageConcernDecisions?.some((decision) => decision.decision === 'uncertain')
    )
      throw new ReviewerProtocolError();
    const raw = JSON.parse(options.originalResponse) as {
      items: Array<{ index: number; newFindings: unknown[] }>;
      passageConcernDecisions?: Array<{
        concernIndex: number;
        decision: string;
        reason: string;
        itemIndex?: number;
        findingIndex?: number;
      }>;
    };
    const remapping = new Map<number, Map<number, number>>();
    for (const item of raw.items) {
      const parsed = original.items.find((row) => row.index === item.index);
      if (!parsed) throw new ReviewerProtocolError();
      const prefix = parsed.criticDecisions.filter(
        (decision) => decision.decision === 'supported'
      ).length;
      if (prefix + item.newFindings.length !== parsed.findings.length)
        throw new ReviewerProtocolError();
      const indices = new Map(Array.from({ length: prefix }, (_, index) => [index, index]));
      let next = prefix;
      item.newFindings = item.newFindings.filter((_finding, index) => {
        const decision = verification.decisions.find(
          (row) => row.itemIndex === item.index && row.findingIndex === prefix + index
        );
        if (!decision) throw new ReviewerProtocolError();
        if (decision.decision === 'dismissed') return false;
        indices.set(prefix + index, next++);
        return true;
      });
      remapping.set(item.index, indices);
    }
    raw.passageConcernDecisions = raw.passageConcernDecisions?.map((concern) => {
      if (concern.decision !== 'supported') return concern;
      const decision = verification.passageConcernDecisions?.find(
        (row) => row.concernIndex === concern.concernIndex
      );
      if (decision?.decision === 'dismissed')
        return {
          concernIndex: concern.concernIndex,
          decision: 'dismissed',
          reason: decision.reason,
        };
      const index = remapping.get(concern.itemIndex!)?.get(concern.findingIndex!);
      if (index === undefined) throw new ReviewerProtocolError();
      return { ...concern, findingIndex: index };
    });
    const adjudicator = options.parse(JSON.stringify(raw));
    receipt.adjudicator = structuredClone(adjudicator);
    receipt.status = 'completed';
    return {
      adjudicator,
      novelFindingCorroboration: {
        candidateSha256: receipt.candidateSha256,
        receiptIndex,
      },
    };
  } catch (error) {
    receipt.status = 'failed';
    throw error;
  }
}
