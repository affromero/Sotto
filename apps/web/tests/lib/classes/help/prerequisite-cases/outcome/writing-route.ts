import { expect, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import type { SharedTestIdentity } from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import type { captureAssessmentForEvaluation } from '@/lib/learning/classes/material/assessment-read';

interface WritingRouteContext {
  audioQueue: typeof import('@/lib/queue') | undefined;
  provider: { generate: Mock };
  boundary: { execution: SottoProviderExecution | null };
  heldOutWriting: { id: string };
  writingRoute: typeof import('@/app/api/v1/classes/[classId]/assessment/[assessmentId]/writing/[promptId]/route');
  classId: string;
  fence: ReturnType<typeof assessmentWorkSchema.parse>['fence'];
  other: { id: string; token: string };
  identity: SharedTestIdentity;
  writingSection: Extract<
    Awaited<ReturnType<typeof captureAssessmentForEvaluation>>['material']['sections'][number],
    { skill: 'WRITING' }
  >;
  readWritingHttp: (token: string, promptId?: string) => Promise<Response>;
}

export async function checkAssessmentWritingRoute({
  audioQueue,
  provider,
  boundary,
  heldOutWriting,
  writingRoute,
  classId,
  fence,
  other,
  identity,
  writingSection,
  readWritingHttp,
}: WritingRouteContext) {
  if (!audioQueue) throw new Error('Private queue is unavailable');
  let dispatches = 0;
  provider.generate.mockImplementation(async () => {
    const request = boundary.execution?.providerRequest;
    if (!request) throw new Error('Writing provider journal missing');
    const response = await request(
      new Request('https://provider.example/writing', {
        method: 'POST',
        body: 'fixture',
      }),
      async () => {
        dispatches += 1;
        return Response.json({ overallScore: 0.75, corrections: [], feedback: 'Bien.' });
      }
    );
    return { content: await response.text(), model: 'fixture' };
  });
  const { runQueuedAssessmentWriting } =
    await import('@/lib/learning/classes/writing/assessment-writing-run');
  const worker = audioQueue.createWorker('learning-writing', runQueuedAssessmentWriting, {
    concurrency: 1,
  });
  await worker.pause();
  const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL!).origin;
  const post = (token: string, text: string, origin = appOrigin, promptId = heldOutWriting.id) =>
    writingRoute.POST(
      new NextRequest(
        `${appOrigin}/api/v1/classes/${classId}/assessment/${fence.assessmentId}/writing/${promptId}`,
        {
          method: 'POST',
          headers: {
            cookie: `sotto_session=${token}`,
            origin,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text }),
        }
      ),
      {
        params: Promise.resolve({
          classId,
          assessmentId: fence.assessmentId,
          promptId,
        }),
      }
    );
  try {
    expect((await post(other.token, 'Ответ')).status).toBe(409);
    expect((await post(identity.ownerToken, 'Ответ', 'https://untrusted.example')).status).toBe(
      403
    );
    expect((await post(identity.ownerToken, '   ')).status).toBe(400);
    const otherPrompt = writingSection.items[1];
    if (!otherPrompt) throw new Error('Second writing prompt missing');
    const unavailable = vi
      .spyOn(audioQueue.createQueue('learning-writing'), 'getJob')
      .mockRejectedValueOnce(new Error('Redis unavailable'));
    try {
      expect(
        (await post(identity.ownerToken, 'Сохранено.', appOrigin, otherPrompt.id)).status
      ).toBe(503);
    } finally {
      unavailable.mockRestore();
    }
    expect(await (await readWritingHttp(identity.ownerToken, otherPrompt.id)).json()).toEqual({
      status: 'RUNNING',
      text: 'Сохранено.',
    });
    const delivery = await import('@/lib/sidedoor/jobs/core/job-delivery');
    const erased = vi.spyOn(delivery, 'deliverSottoJob').mockResolvedValueOnce('erased');
    try {
      expect(
        (await post(identity.ownerToken, 'Сохранено.', appOrigin, otherPrompt.id)).status
      ).toBe(409);
    } finally {
      erased.mockRestore();
    }
    const finished = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Writing worker did not finish')), 30000);
      worker.on('completed', () => {
        clearTimeout(timer);
        resolve();
      });
      worker.on('failed', (_job, error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const responses = await Promise.all([
      post(identity.ownerToken, 'Мой ответ.'),
      post(identity.ownerToken, 'Мой ответ.'),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ status: 'RUNNING', text: 'Мой ответ.' });
    }
    await worker.resume();
    await finished;
    boundary.execution = null;
    const replay = await post(identity.ownerToken, 'Мой ответ.');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ status: 'COMPLETED', text: 'Мой ответ.' });
    expect(boundary.execution).toBeNull();
    expect((await post(identity.ownerToken, 'Другой ответ.')).status).toBe(409);
    expect(dispatches).toBe(1);
    const recovered = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Saved writing did not recover')), 30000);
      worker.once('completed', () => {
        clearTimeout(timer);
        resolve();
      });
      worker.once('failed', (_job, error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    expect((await post(identity.ownerToken, 'Сохранено.', appOrigin, otherPrompt.id)).status).toBe(
      202
    );
    await recovered;
    expect(await (await readWritingHttp(identity.ownerToken, otherPrompt.id)).json()).toEqual({
      status: 'COMPLETED',
      text: 'Сохранено.',
    });
    expect(dispatches).toBe(2);
  } finally {
    await worker.close();
  }
  return;
}
