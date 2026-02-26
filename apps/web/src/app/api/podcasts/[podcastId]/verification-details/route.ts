import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { errorResponse } from '@/lib/api-response';
import type { ClaimAnalysis } from '@/lib/script-verifier';

type RouteParams = { params: Promise<{ podcastId: string }> };

export interface VerificationDetailsResponse {
  hasClaims: boolean;
  summary: {
    totalClaims: number;
    commonKnowledge: number;
    adequatelySourcing: number;
    unsupported: number;
    unreliableSources: number;
    misattributed: number;
  };
  unsupportedClaims: Array<{
    claim: string;
    speaker: string;
    turnIndex: number;
    note: string;
  }>;
  unreliableSourceClaims: Array<{
    claim: string;
    speaker: string;
    turnIndex: number;
    note: string;
  }>;
  misattributedClaims: Array<{
    claim: string;
    speaker: string;
    turnIndex: number;
    note: string;
  }>;
  feedback: string | null;
  feasibilitySuggestion: string | null;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, status: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }
  if (podcast.userId !== session.user.id) {
    return errorResponse('Forbidden', 403);
  }

  const script = await prisma.script.findUnique({
    where: { podcastId },
    select: {
      verificationClaims: true,
      verificationFeedback: true,
    },
  });

  // feasibilitySuggestion will be populated by the topic assessor (Phase 2).
  // For now we read it via raw SQL to avoid Prisma schema dependency.
  let feasibilitySuggestion: string | null = null;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ feasibilitySuggestion: string | null }>>(
      `SELECT "feasibilitySuggestion" FROM "Discovery" WHERE "podcastId" = $1 LIMIT 1`,
      podcastId,
    );
    feasibilitySuggestion = rows[0]?.feasibilitySuggestion ?? null;
  } catch {
    // Column doesn't exist yet — return null
  }

  if (!script || !script.verificationClaims) {
    return NextResponse.json({
      hasClaims: false,
      summary: {
        totalClaims: 0,
        commonKnowledge: 0,
        adequatelySourcing: 0,
        unsupported: 0,
        unreliableSources: 0,
        misattributed: 0,
      },
      unsupportedClaims: [],
      unreliableSourceClaims: [],
      misattributedClaims: [],
      feedback: null,
      feasibilitySuggestion,
    } satisfies VerificationDetailsResponse);
  }

  const claims = script.verificationClaims as unknown as ClaimAnalysis[];

  const commonKnowledge = claims.filter((c) => c.isCommonKnowledge);
  const sourcingRequired = claims.filter((c) => !c.isCommonKnowledge);
  const unsupported = sourcingRequired.filter((c) => c.existingCitations.length === 0);
  const unreliable = sourcingRequired.filter((c) => c.hasUnreliableSource);
  const misattributed = sourcingRequired.filter((c) => c.hasMisattribution);
  const adequate = sourcingRequired.filter(
    (c) =>
      c.existingCitations.length > 0 &&
      !c.needsMoreCitations &&
      !c.hasUnreliableSource &&
      !c.hasMisattribution
  );

  const formatClaim = (c: ClaimAnalysis) => ({
    claim: c.claimText,
    speaker: c.speaker,
    turnIndex: c.turnIndex,
    note: c.verificationNote,
  });

  const response: VerificationDetailsResponse = {
    hasClaims: true,
    summary: {
      totalClaims: claims.length,
      commonKnowledge: commonKnowledge.length,
      adequatelySourcing: adequate.length,
      unsupported: unsupported.length,
      unreliableSources: unreliable.length,
      misattributed: misattributed.length,
    },
    unsupportedClaims: unsupported.map(formatClaim),
    unreliableSourceClaims: unreliable.map(formatClaim),
    misattributedClaims: misattributed.map(formatClaim),
    feedback: script.verificationFeedback,
    feasibilitySuggestion,
  };

  return NextResponse.json(response);
}
