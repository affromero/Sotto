import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { updateScriptSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import {
  cleanAndRenumberCitations,
  cleanAndRenumberMarkdown,
  buildRenumberMap,
} from '@/lib/script-updater';
import { getMinReferenceCount } from '@/lib/script-verifier';
import type { ScriptTurn } from '@/lib/script-generator';

type RouteParams = { params: Promise<{ episodeId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      userId: true,
      lowReferences: true,
      verificationProgress: true,
      verificationMode: true,
    },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }
  if (episode.userId !== authResult.userId) {
    return errorResponse('Forbidden', 403);
  }

  const script = await prisma.script.findUnique({
    where: { episodeId },
  });

  if (!script) {
    return errorResponse('Script not found', 404);
  }

  const references = await prisma.reference.findMany({
    where: { episodeId, verificationStatus: { not: 'REMOVED' } },
    orderBy: { number: 'asc' },
  });

  const response: Record<string, unknown> = {
    turns: script.turns as ScriptTurn[],
    references,
    version: script.version,
  };

  if (episode.lowReferences) {
    const discovery = await prisma.discovery.findUnique({
      where: { episodeId },
      select: { depth: true, durationTarget: true },
    });
    const depth = discovery?.depth ?? 'standard';
    const effectiveDepth = episode.verificationMode === 'relaxed' ? 'eli5' : depth;
    response.lowReferences = true;
    response.requiredRefCount = getMinReferenceCount(
      effectiveDepth,
      discovery?.durationTarget ?? 10
    );
    if (episode.verificationProgress) {
      response.verificationProgress = episode.verificationProgress;
    }
  }

  return NextResponse.json(response);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true, status: true },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }
  if (episode.userId !== authResult.userId) {
    return errorResponse('Forbidden', 403);
  }
  if (episode.status !== 'SCRIPT_READY') {
    return errorResponse('Script can only be edited when status is SCRIPT_READY', 400);
  }

  const body = await request.json();
  const parsed = updateScriptSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const script = await prisma.script.findUnique({
    where: { episodeId },
  });
  if (!script) {
    return errorResponse('Script not found', 404);
  }

  const oldTurns = script.turns as ScriptTurn[];
  const newTurns = parsed.data.turns;
  const activeReferenceCount = await prisma.reference.count({
    where: { episodeId, verificationStatus: { not: 'REMOVED' } },
  });
  if (activeReferenceCount > 0 && JSON.stringify(oldTurns) !== JSON.stringify(newTurns)) {
    return errorResponse(
      'Verified cited scripts cannot be edited. Regenerate the script to change cited claims.',
      409
    );
  }

  // If turns were removed, clean up citation references
  let finalTurns: ScriptTurn[] = newTurns;
  let finalMarkdown = generateMarkdown(newTurns);

  if (newTurns.length < oldTurns.length) {
    const references = await prisma.reference.findMany({
      where: { episodeId, verificationStatus: { not: 'REMOVED' } },
      orderBy: { number: 'asc' },
    });

    if (references.length > 0) {
      // Find citation numbers that are still referenced in the new turns
      const citationRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
      const referencedNumbers = new Set<number>();
      for (const turn of newTurns) {
        let match: RegExpExecArray | null;
        citationRegex.lastIndex = 0;
        while ((match = citationRegex.exec(turn.text)) !== null) {
          const nums = match[1].split(',').map((s) => parseInt(s.trim(), 10));
          nums.forEach((n) => referencedNumbers.add(n));
        }
      }

      // Remove unreferenced citations
      const allNumbers = references.map((r) => r.number);
      const removedNumbers = new Set(allNumbers.filter((n) => !referencedNumbers.has(n)));

      if (removedNumbers.size > 0) {
        const renumberMap = buildRenumberMap(allNumbers, removedNumbers);
        finalTurns = cleanAndRenumberCitations(newTurns, removedNumbers, renumberMap);
        finalMarkdown = cleanAndRenumberMarkdown(
          generateMarkdown(finalTurns),
          removedNumbers,
          renumberMap
        );
      }
    }
  }

  const updated = await prisma.script.update({
    where: { episodeId },
    data: {
      turns: finalTurns,
      markdown: finalMarkdown,
      version: { increment: 1 },
    },
  });

  return NextResponse.json({
    turns: updated.turns as ScriptTurn[],
    version: updated.version,
  });
}

function generateMarkdown(turns: ScriptTurn[]): string {
  return turns
    .map((turn) => {
      const direction = turn.direction ? ` _(${turn.direction})_` : '';
      return `**${turn.speaker}:**${direction} ${turn.text}`;
    })
    .join('\n\n');
}
