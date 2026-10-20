// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';
import { applyReviewOutcome } from '@/lib/knowledge-graph';
import type { ReviewEvidence } from '@/lib/learning/review/events';
import { comparisonEventSchema } from '@/lib/learning/review/comparison';

const execute = promisify(execFile);

async function readPrivateSnapshot(filePath: string): Promise<string> {
  const file = await open(filePath, 'r');
  try {
    expect((await file.stat()).mode & 0o777).toBe(0o600);
    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('review observations committed with scheduler state', () => {
  let instance: SharedTestInstance;
  let courseId: string;
  let vocabId: string;
  let sessionId: string;
  let evidence: ReviewEvidence;
  let privateDirectory: string;
  const now = new Date('2026-10-20T00:00:00Z');
  beforeAll(async () => {
    instance = await createSharedTestInstance('review_events');
    privateDirectory = await mkdtemp(join(tmpdir(), 'sotto-review-export-'));
  });
  afterAll(async () => {
    await instance?.close();
    if (privateDirectory) await rm(privateDirectory, { recursive: true, force: true });
  });
  beforeEach(async () => {
    const { ownerId } = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'es',
        },
      })
    ).id;
    vocabId = (
      await instance.database.learnerVocab.create({
        data: { courseId, lemma: 'hola', translation: 'hello' },
      })
    ).id;
    sessionId = (
      await instance.database.practiceSession.create({
        data: { courseId, kind: 'VOCAB', items: [], seed: 'journal-fixture' },
      })
    ).id;
    evidence = {
      source: { practiceSessionId: sessionId, attempt: 1 },
      assessment: 'VOCAB_CHOICE',
      questionIdsByTarget: new Map([['vocab:hola', ['question-1']]]),
    };
  });
  const review = () =>
    instance.database.$transaction((tx) =>
      applyReviewOutcome(courseId, ['hola'], [], 1, 0, now, tx, evidence)
    );

  it('retains exact before and after states with the assessed target and source', async () => {
    await review();
    const event = await instance.database.learnerReviewEvent.findFirstOrThrow();
    const vocab = await instance.database.learnerVocab.findUniqueOrThrow({
      where: { id: vocabId },
    });
    expect(event).toMatchObject({
      courseId,
      vocabId,
      grammarId: null,
      practiceSessionId: sessionId,
      classId: null,
      quality: 1,
      questionIds: ['question-1'],
      assessment: 'VOCAB_CHOICE',
      schedulerVersion: 'sm2-v1',
    });
    expect(event.before).toMatchObject({ reps: 0, lastReviewed: null });
    expect(event.after).toMatchObject({
      reps: vocab.reps,
      mastery: vocab.mastery,
      dueAt: vocab.dueAt.toISOString(),
      lastReviewed: now.toISOString(),
    });
  });

  it('rolls back the scheduler update when the event cannot be persisted', async () => {
    const original = await instance.database.learnerVocab.findUniqueOrThrow({
      where: { id: vocabId },
    });
    evidence.source = { practiceSessionId: 'missing-source', attempt: 1 };
    await expect(review()).rejects.toThrow();
    expect(
      await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: vocabId } })
    ).toEqual(original);
    expect(await instance.database.learnerReviewEvent.count()).toBe(0);
  });

  it('refuses a source belonging to another course and rolls back the review', async () => {
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const other = await instance.database.course.create({
      data: {
        userId: course.userId,
        curriculumId: course.curriculumId,
        nativeLang: 'en',
        targetLang: 'fr',
      },
    });
    const source = await instance.database.practiceSession.create({
      data: { courseId: other.id, kind: 'VOCAB', items: [], seed: 'other-course' },
    });
    evidence.source = { practiceSessionId: source.id, attempt: 1 };
    await expect(review()).rejects.toThrow();
    expect(
      (await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: vocabId } })).reps
    ).toBe(0);
  });

  it('orders separate updates sharing a timestamp without collapsing their evidence', async () => {
    await review();
    await review();
    const events = await instance.database.learnerReviewEvent.findMany({
      orderBy: { sequence: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events[1]!.sequence).toBeGreaterThan(events[0]!.sequence);
    expect(events[1]!.before).toEqual(events[0]!.after);
  });

  it('exports exact UTC observations in a non-UTC timezone and replays without database access', async () => {
    await review();
    const { userId } = await instance.database.course.findUniqueOrThrow({
      where: { id: courseId },
    });
    const connection = new URL(process.env.SIDEDOOR_TEST_DATABASE_URL!);
    connection.searchParams.set('options', `-c search_path=${instance.schema},public`);
    const script = resolve(process.cwd(), '../../scripts/learning/compare-schedulers.ts');
    const file = join(privateDirectory, 'reviews.json');
    const cutoff = ['--test-after', '2026-10-01T00:00:00Z'];
    const options = {
      env: { ...process.env, TZ: 'Europe/Berlin', DIRECT_DATABASE_URL: connection.href },
    };
    const exported = await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        script,
        '--course-id',
        courseId,
        '--user-id',
        userId,
        '--export',
        file,
        ...cutoff,
      ],
      options
    );
    const content = await readPrivateSnapshot(file);
    const events = comparisonEventSchema.array().parse(JSON.parse(content));
    expect(events[0]!.reviewedAt).toBe(now.toISOString());
    expect(JSON.parse(exported.stdout).coverage).toMatchObject({
      sm2ReplayMatches: 1,
      sm2ReplayMismatches: 0,
    });
    const offline = await execute(
      process.execPath,
      ['--import', 'tsx', script, '--input', file, ...cutoff],
      { env: { ...process.env, DATABASE_URL: '', DIRECT_DATABASE_URL: '', TZ: 'Pacific/Honolulu' } }
    );
    expect(JSON.parse(offline.stdout)).toEqual(JSON.parse(exported.stdout));
    await expect(
      execute(
        process.execPath,
        ['--import', 'tsx', script, '--input', file, '--test-after', 'invalid'],
        options
      )
    ).rejects.toMatchObject({ code: 1, stdout: '' });
    await expect(
      execute(
        process.execPath,
        ['--import', 'tsx', script, '--input', file, '--export', file, ...cutoff],
        options
      )
    ).rejects.toMatchObject({ code: 1 });
    expect(await readPrivateSnapshot(file)).toBe(content);
  });

  it('refuses to export another learner’s course', async () => {
    await review();
    const connection = new URL(process.env.SIDEDOOR_TEST_DATABASE_URL!);
    connection.searchParams.set('options', `-c search_path=${instance.schema},public`);
    const file = join(privateDirectory, 'forbidden.json');
    await expect(
      execute(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(process.cwd(), '../../scripts/learning/compare-schedulers.ts'),
          '--course-id',
          courseId,
          '--user-id',
          'another-learner',
          '--export',
          file,
          '--test-after',
          '2026-10-01T00:00:00Z',
        ],
        { env: { ...process.env, DIRECT_DATABASE_URL: connection.href } }
      )
    ).rejects.toMatchObject({ code: 1, stdout: '' });
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['course', 'target', 'source'] as const)(
    'erases observations when their %s is deleted',
    async (kind) => {
      await review();
      if (kind === 'course') await instance.database.course.delete({ where: { id: courseId } });
      else if (kind === 'target')
        await instance.database.learnerVocab.delete({ where: { id: vocabId } });
      else await instance.database.practiceSession.delete({ where: { id: sessionId } });
      expect(await instance.database.learnerReviewEvent.count()).toBe(0);
    }
  );
});
