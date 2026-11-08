import { NextRequest, NextResponse } from 'next/server';
import { prismaUnfiltered } from '@/lib/prisma';
import { isAccessError } from 'thesidedoor-core/access';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { authenticateRequest } from '@/lib/api-keys';
import { updateScriptSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import {
  cleanAndRenumberCitations,
  cleanAndRenumberMarkdown,
  buildRenumberMap,
} from '@/lib/script-updater';
import { getMinReferenceCount } from '@/lib/reference-thresholds';
import type { ScriptTurn } from '@/lib/script-generator';

type RouteParams = { params: Promise<{ episodeId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, authResult);
        await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episodeId} AND "userId" = ${authResult.userId} FOR UPDATE`;
        const episode = await database.episode.findUnique({
          where: { id: episodeId },
          select: {
            userId: true,
            deletedAt: true,
            lowReferences: true,
            verificationProgress: true,
            verificationMode: true,
            assessmentSection: { select: { id: true } },
            assessmentAudioAssessmentId: true,
          },
        });
        if (!episode || episode.deletedAt)
          return { error: 'Episode not found', status: 404 } as const;
        if (episode.userId !== authResult.userId)
          return { error: 'Forbidden', status: 403 } as const;
        if (episode.assessmentSection || episode.assessmentAudioAssessmentId)
          return { error: 'Episode not found', status: 404 } as const;
        const script = await database.script.findUnique({ where: { episodeId } });
        if (!script) return { error: 'Script not found', status: 404 } as const;
        const references = await database.reference.findMany({
          where: { episodeId, verificationStatus: { not: 'REMOVED' } },
          orderBy: { number: 'asc' },
        });
        const response: Record<string, unknown> = {
          scriptId: script.id,
          turns: script.turns as ScriptTurn[],
          references,
          version: script.version,
        };
        if (episode.lowReferences) {
          const discovery = await database.discovery.findUnique({
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
          if (episode.verificationProgress)
            response.verificationProgress = episode.verificationProgress;
        }
        await requireOriginalSottoAdmission(database, request, authResult);
        request.signal.throwIfAborted();
        return { response } as const;
      },
      { signal: request.signal }
    );
    if ('error' in result && typeof result.error === 'string' && typeof result.status === 'number')
      return errorResponse(result.error, result.status, undefined, headers);
    return NextResponse.json(result.response, { headers });
  } catch (error) {
    if (isAccessError(error))
      return errorResponse(
        error.message,
        error.code === 'unauthorized' ? 401 : 409,
        undefined,
        headers
      );
    throw error;
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = updateScriptSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  try {
    return await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, authResult);
        await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episodeId} FOR UPDATE`;
        const episode = await database.episode.findUnique({
          where: { id: episodeId },
          select: {
            userId: true,
            status: true,
            deletedAt: true,
            assessmentSection: { select: { id: true } },
            assessmentAudioAssessmentId: true,
            classSection: { select: { id: true } },
            practiceSession: { select: { id: true } },
            examSection: { select: { id: true } },
          },
        });

        if (
          !episode ||
          episode.deletedAt ||
          episode.assessmentSection ||
          episode.assessmentAudioAssessmentId
        ) {
          return errorResponse('Episode not found', 404);
        }
        if (episode.userId !== authResult.userId) {
          return errorResponse('Forbidden', 403);
        }
        if (episode.status !== 'SCRIPT_READY') {
          return errorResponse('Script can only be edited when status is SCRIPT_READY', 400);
        }

        if (episode.classSection || episode.practiceSession || episode.examSection) {
          return errorResponse(
            'This script belongs to a learning exercise. Repair the exercise before changing its script.',
            409
          );
        }

        const script = await database.script.findUnique({
          where: { episodeId },
        });
        if (!script) {
          return errorResponse('Script not found', 404);
        }

        const oldTurns = script.turns as ScriptTurn[];
        const newTurns = parsed.data.turns;
        const activeReferenceCount = await database.reference.count({
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
          const references = await database.reference.findMany({
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

        await requireOriginalSottoAdmission(database, request, authResult);
        request.signal.throwIfAborted();
        const updated = await database.script.update({
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
      },
      { signal: request.signal }
    );
  } catch (error) {
    if (isAccessError(error))
      return errorResponse(error.message, error.code === 'unauthorized' ? 401 : 409);
    throw error;
  }
}

function generateMarkdown(turns: ScriptTurn[]): string {
  return turns
    .map((turn) => {
      const direction = turn.direction ? ` _(${turn.direction})_` : '';
      return `**${turn.speaker}:**${direction} ${turn.text}`;
    })
    .join('\n\n');
}
