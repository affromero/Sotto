import { NextRequest, NextResponse } from 'next/server';
import { learningLevelSchema } from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { learningMapOperation } from '@/lib/learning-map/http';
import { ownedLearningCourse } from '@/lib/learning-map/read';
import { readLearningObjective } from '@/lib/learning-map/library';

export function GET(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string; objectiveId: string }> }
) {
  return learningMapOperation(request, false, async (execution) => {
    const { courseId, objectiveId } = await params;
    const selected = request.nextUrl.searchParams.get('level');
    const result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const actor = await execution.authorize(database);
        const course = await ownedLearningCourse(database, courseId, actor.userId);
        const level = selected === null ? course.currentLevel : learningLevelSchema.parse(selected);
        return readLearningObjective(database, course, objectiveId, level);
      },
      { signal: request.signal }
    );
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  });
}
