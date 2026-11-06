import type { Job } from 'bullmq';
import { expect, it, vi } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import { requestClassPreparation, classPreparationStore } from '@/lib/classes/preparation';
import { readPristineRegenerationSnapshot } from '@/lib/classes/regeneration/pristine';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { processClassPreparation } from '@/workers/classes/class-preparation.worker';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';

export function registerPreparationDiagnosticTests(
  context: () => {
    instance: SharedTestInstance;
    courseId: string;
    execution: SottoProviderExecution;
    lesson: () => Promise<{ id: string }>;
  }
) {
  it.each([true, false])('uses the admitted beginner policy %s in the worker', async (initial) => {
    const { instance, courseId, execution, lesson } = context();
    const priorLesson = await lesson();
    if (!initial)
      await instance.database.courseClass.create({
        data: {
          courseId,
          lessonId: priorLesson.id,
          order: 1,
          status: 'PASSED',
          skillRequirements: createSkillRequirements({
            scope: 'CLASS',
            nativeLang: 'en',
            targetLang: 'de',
            level: 'A1',
            ttsProvider: 'disabled',
            sttProvider: 'disabled',
          }),
        },
      });
    const operation = await requestClassPreparation(courseId, execution, {
      maxProviderRequests: 2,
    });
    const parent = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!parent) throw new Error('Missing worker fixture');
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.endsWith('/moderations'))
        return Response.json({
          results: [{ flagged: false, categories: {}, category_scores: {} }],
        });
      requests.push(await request.text());
      return Response.json({ error: { message: 'Fixture generation rejected' } }, { status: 422 });
    });
    await processClassPreparation({
      id: operation.id,
      name: 'class-preparation.v1',
      data: { operationId: operation.id, fingerprint: parent.fingerprint },
    } as Job<unknown>);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.join('\n').includes('do not assume prior de knowledge')).toBe(initial);
  });

  it.each([true, false])(
    'uses the saved policy for regeneration and records safe worker failure: %s',
    async (initial) => {
      const { instance, courseId, execution, lesson } = context();
      const target = await lesson();
      if (!initial)
        await instance.database.courseClass.create({
          data: {
            courseId,
            lessonId: target.id,
            order: 1,
            status: 'PASSED',
            createdAt: new Date('2020-01-01T00:00:00Z'),
            skillRequirements: createSkillRequirements({
              scope: 'CLASS',
              nativeLang: 'en',
              targetLang: 'de',
              level: 'A1',
              ttsProvider: 'disabled',
              sttProvider: 'disabled',
            }),
          },
        });
      const cls = await instance.database.courseClass.create({
        data: { courseId, lessonId: target.id, order: 1, status: 'AVAILABLE' },
      });
      const operation = await requestClassPreparation(courseId, execution, {
        maxProviderRequests: 2,
        intent: {
          kind: 'REGENERATE',
          classId: cls.id,
          expectedAttempt: 1,
          pristineSnapshot: await readPristineRegenerationSnapshot(cls.id, execution),
        },
      });
      const parent = await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operation.id)
      );
      if (!parent) throw new Error('Missing worker diagnostic fixture');
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const providerRequests: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname.endsWith('/moderations'))
          return Response.json({
            results: [{ flagged: false, categories: {}, category_scores: {} }],
          });
        providerRequests.push(await request.text());
        return Response.json(
          {
            error: { message: 'private-provider-payload-sentinel', code: 'private-code-sentinel' },
          },
          { status: 422 }
        );
      });
      const job = {
        id: operation.id,
        name: 'class-preparation.v1',
        data: { operationId: operation.id, fingerprint: parent.fingerprint },
      } as Job<unknown>;
      await processClassPreparation(job);
      expect(providerRequests.length).toBeGreaterThan(0);
      expect(providerRequests.join('\n').includes('do not assume prior de knowledge')).toBe(
        initial
      );
      expect(await classPreparationStore(instance.database, courseId).read()).toMatchObject({
        id: operation.id,
        status: 'FAILED',
        failure: 'generation_failed',
      });
      const messages = errors.mock.calls.map(([message]) => String(message));
      const entry = messages.find((message) => message.includes('Class preparation failed'));
      expect(entry).toBeDefined();
      expect(JSON.parse(entry!.slice(entry!.indexOf('{')))).toMatchObject({
        operationId: operation.id,
        courseId,
        uncertain: false,
        category: 'generation_failed',
        type: 'unknown',
        code: 'unknown',
      });
      expect(messages.join('\n')).not.toContain('private-provider-payload-sentinel');
      expect(messages.join('\n')).not.toContain('private-code-sentinel');
    }
  );
}
