import { NextRequest, NextResponse } from 'next/server';
import { learningMapOperation } from '@/lib/learning-map/http';
import { upgradeCourseId } from '@/lib/learning-map/upgrade/context';
import { listLearningUpgradeCourses } from '@/lib/learning-map/upgrade/service';

export function GET(request: NextRequest) {
  return learningMapOperation(request, false, async (execution) => {
    const after = request.nextUrl.searchParams.get('afterId');
    const result = await listLearningUpgradeCourses(
      execution,
      after === null ? null : upgradeCourseId.parse(after)
    );
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
