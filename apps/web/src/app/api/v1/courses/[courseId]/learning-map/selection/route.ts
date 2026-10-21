import { NextRequest, NextResponse } from 'next/server';
import { learningSelectionRequestSchema, learningSelectionPreviewSchema } from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { learningMapOperation, learningMapJson } from '@/lib/learning-map/http';
import { ownedLearningCourse } from '@/lib/learning-map/read';
import { capturePracticeLearningSelection } from '@/lib/learning-map/selection';

/** Resolve a concrete bounded selection before admission, without pinning a new band. */
export function POST(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  return learningMapOperation(request, true, async (execution) => {
    const { courseId } = await params;
    const selection = learningSelectionRequestSchema.parse(await learningMapJson(request));
    const preview = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const actor = await execution.authorize(database);
        const course = await ownedLearningCourse(database, courseId, actor.userId);
        const resolved = await capturePracticeLearningSelection(
          database,
          execution,
          course,
          selection,
          'FULL'
        );
        const binding = await database.learningLevelBinding.findUnique({
          where: { courseId_level: { courseId, level: selection.level } },
          select: { id: true },
        });
        return { ...resolved, requirementId: binding?.id ?? null };
      },
      { signal: request.signal }
    );
    return NextResponse.json(
      learningSelectionPreviewSchema.parse({
        selection: preview.selection,
        requirementId: preview.requirementId,
        availableKinds: preview.availableKinds,
      }),
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  });
}
