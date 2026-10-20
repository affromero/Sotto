import { NextRequest, NextResponse } from 'next/server';
import { learningMapOperation, learningMapJson } from '@/lib/learning-map/http';
import { upgradeCourseId } from '@/lib/learning-map/upgrade/context';
import { previewLearningUpgrade, applyLearningUpgrade } from '@/lib/learning-map/upgrade/service';

export function GET(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  return learningMapOperation(request, false, async (execution) => {
    const courseId = upgradeCourseId.parse((await params).courseId);
    const result = await previewLearningUpgrade(
      execution,
      courseId,
      request.nextUrl.searchParams.get('cursor')
    );
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
export function POST(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  return learningMapOperation(request, true, async (execution) => {
    const courseId = upgradeCourseId.parse((await params).courseId);
    const result = await applyLearningUpgrade(execution, courseId, await learningMapJson(request));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
