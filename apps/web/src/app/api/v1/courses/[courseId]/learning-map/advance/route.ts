import { NextRequest, NextResponse } from 'next/server';
import { advanceLearningLevelSchema, learningLevelCompletionSchema } from '@sotto/shared';
import { learningMapOperation, learningMapJson } from '@/lib/learning-map/http';
import { advanceLearningLevel } from '@/lib/learning-map/progression/advance';

export function POST(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  return learningMapOperation(request, true, async (execution) => {
    const { courseId } = await params;
    const input = advanceLearningLevelSchema.parse(await learningMapJson(request));
    const receipt = await advanceLearningLevel(courseId, input, execution);
    return NextResponse.json(learningLevelCompletionSchema.parse(receipt), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  });
}
