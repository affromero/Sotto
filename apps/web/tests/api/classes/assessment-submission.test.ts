import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const boundary = vi.hoisted(() => ({ authenticate: vi.fn(), submit: vi.fn() }));
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: boundary.authenticate }));
vi.mock('@/lib/learning/classes/lifecycle/assessment-submission', () => ({
  submitAssessment: boundary.submit,
  AssessmentSpeakingUnavailable: class AssessmentSpeakingUnavailable extends Error {},
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  sottoRequestExecution: (_request: Request, identity: { userId: string }) => identity,
}));

import { POST } from '@/app/api/v1/classes/[classId]/assessment/[assessmentId]/route';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { AssessmentSpeakingUnavailable } from '@/lib/learning/classes/lifecycle/assessment-submission';

const receipt = {
  source: 'ASSESSMENT',
  passed: true,
  overallScore: 1,
  passedSections: 1,
  totalSections: 1,
  sections: [{ id: 'section', skill: 'GRAMMAR', score: 1, passed: true }],
};
const params = { params: Promise.resolve({ classId: 'class', assessmentId: 'assessment' }) };
function post(body: string) {
  return POST(
    new NextRequest('http://localhost/api/v1/classes/class/assessment/assessment', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
      body,
    }),
    params
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.authenticate.mockResolvedValue({ userId: 'learner' });
  boundary.submit.mockResolvedValue(receipt);
});

describe('independent assessment submission', () => {
  it('requires an authenticated learner', async () => {
    boundary.authenticate.mockResolvedValue(null);
    expect((await post('{"choices":[]}')).status).toBe(401);
  });

  it('returns the validated receipt without private fields', async () => {
    boundary.submit.mockResolvedValue({ ...receipt, privateRubric: 'secret' });
    const response = await post('{"choices":[{"itemId":"item","selectedIndex":1}]}');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual(receipt);
  });

  it.each([
    '{',
    '{"choices":[],"score":1}',
    '{"choices":[{"itemId":"a","selectedIndex":0},{"itemId":"a","selectedIndex":1}]}',
    '{"choices":[{"itemId":"a","selectedIndex":4}]}',
  ])('rejects invalid input before submission', async (body) => {
    expect((await post(body)).status).toBe(400);
  });

  it('rejects oversized input before submission', async () => {
    expect((await post(JSON.stringify({ choices: [], padding: 'x'.repeat(200_000) }))).status).toBe(
      413
    );
  });

  it.each([new AssessmentFenceConflict(), new AssessmentSpeakingUnavailable()])(
    'reports unavailable assessment work as a conflict',
    async (error) => {
      boundary.submit.mockRejectedValue(error);
      expect((await post('{"choices":[]}')).status).toBe(409);
    }
  );

  it('does not reveal unexpected internal errors', async () => {
    boundary.submit.mockRejectedValue(new Error('private detail'));
    const response = await post('{"choices":[]}');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private detail');
  });

  it('treats an invalid stored receipt as a server error', async () => {
    boundary.submit.mockResolvedValue({ ...receipt, overallScore: 2 });
    expect((await post('{"choices":[]}')).status).toBe(500);
  });
});
