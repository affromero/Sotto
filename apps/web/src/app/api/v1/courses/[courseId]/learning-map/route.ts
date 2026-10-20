import { NextRequest, NextResponse } from 'next/server';
import { learningLevelSchema, learningMapResponseSchema } from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { learningMapOperation } from '@/lib/learning-map/http';
import { ownedLearningCourse, readLearningMap } from '@/lib/learning-map/read';

export function GET(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  return learningMapOperation(request, false, async (execution) => {
    const { courseId } = await params;
    const selected = request.nextUrl.searchParams.get('level');
    const level = selected === null ? undefined : learningLevelSchema.parse(selected);
    const map = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const actor = await execution.authorize(database);
        const course = await ownedLearningCourse(database, courseId, actor.userId);
        return readLearningMap(database, course, level);
      },
      { signal: request.signal }
    );
    return NextResponse.json(learningMapResponseSchema.parse(map), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  });
}
