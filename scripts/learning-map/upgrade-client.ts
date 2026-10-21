import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  learningUpgradeReportSchema,
  learningUpgradeCoursesSchema,
  meResponseSchema,
} from '@sotto/shared';

const checkpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    origin: z.url(),
    userId: z.string(),
    apply: z.boolean(),
    courseId: z.string().nullable(),
    pendingCourseIds: z.array(z.string()).max(20),
    afterCourseId: z.string().nullable(),
    listedAll: z.boolean(),
    cursor: z.string().nullable(),
    identityDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    complete: z.boolean(),
  })
  .strict();
interface Options {
  baseUrl: string;
  apiKey: string;
  checkpointPath: string;
  apply?: boolean;
  courseId?: string;
  signal?: AbortSignal;
}
async function save(path: string, value: z.infer<typeof checkpointSchema>) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(checkpointSchema.parse(value), null, 2) + '\n', {
    mode: 0o600,
  });
  await rename(temporary, path);
}
/** HTTP-only maintenance uses the learner's existing pairing key and server-owned domain logic. */
export async function runLearningMapUpgrade(options: Options) {
  const base = new URL(options.baseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    !options.apiKey.trim()
  )
    throw new Error('Provide an HTTP(S) Sotto URL and an existing SOTTO_API_KEY.');
  const send = async (path: string, body?: unknown) => {
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: options.signal,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Learning-map maintenance stopped with HTTP ${response.status}. The checkpoint is retained; preview the changed page before continuing.`
      );
    return response.json() as Promise<unknown>;
  };
  const user = meResponseSchema.parse(await send('/api/v1/users/me'));
  let state: z.infer<typeof checkpointSchema>;
  try {
    state = checkpointSchema.parse(JSON.parse(await readFile(options.checkpointPath, 'utf8')));
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    state = {
      schemaVersion: 1,
      origin: base.origin,
      userId: user.id,
      apply: options.apply === true,
      courseId: options.courseId ?? null,
      pendingCourseIds: options.courseId ? [options.courseId] : [],
      afterCourseId: null,
      listedAll: Boolean(options.courseId),
      cursor: null,
      identityDigest: null,
      complete: false,
    };
    await save(options.checkpointPath, state);
  }
  if (
    state.origin !== base.origin ||
    state.userId !== user.id ||
    state.apply !== (options.apply === true) ||
    state.courseId !== (options.courseId ?? null)
  )
    throw new Error(
      'This checkpoint belongs to a different server, profile, mode or course. Use the matching checkpoint.'
    );
  while (!state.complete) {
    options.signal?.throwIfAborted();
    if (!state.pendingCourseIds.length) {
      if (state.listedAll) {
        state.complete = true;
        await save(options.checkpointPath, state);
        break;
      }
      const page = learningUpgradeCoursesSchema.parse(
        await send(
          `/api/v1/learning-map/upgrade${state.afterCourseId ? `?afterId=${encodeURIComponent(state.afterCourseId)}` : ''}`
        )
      );
      state.pendingCourseIds = page.courses.map((course) => course.id);
      state.afterCourseId = page.nextAfterId;
      state.listedAll = page.nextAfterId === null;
      await save(options.checkpointPath, state);
      if (!state.pendingCourseIds.length) continue;
    }
    const courseId = state.pendingCourseIds[0];
    const path = `/api/v1/courses/${encodeURIComponent(courseId)}/learning-map/upgrade`;
    let report = learningUpgradeReportSchema.parse(
      await send(`${path}${state.cursor ? `?cursor=${encodeURIComponent(state.cursor)}` : ''}`)
    );
    if (state.identityDigest !== null && state.identityDigest !== report.cursor.identityDigest)
      throw new Error(
        'The course, catalog or coverage changed during maintenance. Keep this checkpoint and start a fresh preview.'
      );
    if (state.identityDigest === null) {
      state.identityDigest = report.cursor.identityDigest;
      await save(options.checkpointPath, state);
    }
    if (options.apply && ['COURSE', 'LESSONS'].includes(report.cursor.stage))
      report = learningUpgradeReportSchema.parse(
        await send(path, {
          schemaVersion: 1,
          cursor: Buffer.from(JSON.stringify(report.cursor)).toString('base64url'),
          expectedLevel: report.level,
          expectedCatalogHash: report.catalog.hash,
          expectedPageDigest: report.pageDigest,
        })
      );
    process.stdout.write(`${JSON.stringify(report)}\n`);
    state.cursor = report.nextCursor;
    if (state.cursor === null) {
      state.pendingCourseIds.shift();
      state.identityDigest = null;
    }
    await save(options.checkpointPath, state);
  }
  return state;
}
