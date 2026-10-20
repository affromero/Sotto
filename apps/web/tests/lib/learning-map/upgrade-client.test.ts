// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSkillRequirements, type LearningUpgradeCursor } from '@sotto/shared';
import { runLearningMapUpgrade } from '../../../../../scripts/learning-map/upgrade-client';

describe('HTTP-only learning-map maintenance checkpoint', () => {
  let server: Server;
  let directory: string;
  let baseUrl: string;
  let userId: string;
  let bound: boolean;
  let linked: boolean;
  let loseResponse: boolean;
  let meaning: string;
  const seen: Array<{ method: string; authorization: string | undefined }> = [];
  const cutoff = '2026-10-20T00:00:00.000Z';
  const stages = ['COURSE', 'LESSONS', 'GRAMMAR', 'MATERIALS'] as const;
  const cursor = (stage: LearningUpgradeCursor['stage']) => ({
    schemaVersion: 1 as const,
    stage,
    afterId: null,
    cutoff,
    limit: 25,
    identityDigest: meaning,
  });
  const encode = (value: LearningUpgradeCursor) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const coverage = createSkillRequirements({
    scope: 'CLASS',
    nativeLang: 'en',
    targetLang: 'de',
    level: 'A2',
    ttsProvider: null,
    sttProvider: null,
  });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sotto-upgrade-client-'));
    userId = 'owned-profile';
    bound = false;
    linked = false;
    loseResponse = false;
    meaning = '3'.repeat(64);
    seen.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    server = createServer(async (request, response) => {
      seen.push({ method: request.method!, authorization: request.headers.authorization });
      const url = new URL(request.url!, 'http://localhost');
      if (url.pathname === '/api/v1/users/me') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ id: userId }));
        return;
      }
      if (url.pathname === '/api/v1/learning-map/upgrade') {
        response.end(
          JSON.stringify({
            courses: [{ id: 'owned-course', nativeLang: 'en', targetLang: 'de', level: 'A2' }],
            nextAfterId: null,
          })
        );
        return;
      }
      let selected = cursor('COURSE');
      let changed = { bindings: 0, lessonLinks: 0 };
      if (request.method === 'POST') {
        const parts: Buffer[] = [];
        for await (const part of request) parts.push(Buffer.from(part));
        const input = JSON.parse(Buffer.concat(parts).toString()) as { cursor: string };
        selected = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
        if (selected.stage === 'COURSE') {
          changed.bindings = bound ? 0 : 1;
          bound = true;
        }
        if (selected.stage === 'LESSONS') {
          changed.lessonLinks = linked ? 0 : 1;
          linked = true;
        }
        if (loseResponse) {
          loseResponse = false;
          response.destroy();
          return;
        }
      } else if (url.searchParams.has('cursor'))
        selected = JSON.parse(Buffer.from(url.searchParams.get('cursor')!, 'base64url').toString());
      const next = stages[stages.indexOf(selected.stage) + 1];
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          courseId: 'owned-course',
          courseGeneration: cutoff,
          level: 'A2',
          startLevel: 'A2',
          placementSource: 'NOTES',
          mode: request.method === 'POST' ? 'APPLY' : 'DRY_RUN',
          cursor: selected,
          nextCursor: next ? encode(cursor(next)) : null,
          pageDigest: '1'.repeat(64),
          catalog: { available: true, hash: '2'.repeat(64), version: 1, pinned: bound },
          coverage,
          upgrade: {
            available: false,
            targetHash: '2'.repeat(64),
            added: 0,
            removed: 0,
            changed: 0,
            earnedTransitionsPreserved: true,
          },
          items: [],
          changed,
          evidence: 'LEGACY_EVIDENCE_REMAINS_BROAD',
        })
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(directory, { recursive: true, force: true });
  });
  const options = () => ({
    baseUrl,
    apiKey: 'existing-pairing-key-fixture',
    checkpointPath: join(directory, 'checkpoint.json'),
  });
  it('defaults to dry-run and stores only a profile-bound metadata checkpoint', async () => {
    const state = await runLearningMapUpgrade(options());
    expect(state.complete).toBe(true);
    expect(state.userId).toBe(userId);
    expect(bound).toBe(false);
    expect(linked).toBe(false);
    expect(
      seen.every(
        (request) =>
          request.method === 'GET' &&
          request.authorization === 'Bearer existing-pairing-key-fixture'
      )
    ).toBe(true);
    const bytes = await readFile(options().checkpointPath, 'utf8');
    expect(bytes).not.toContain(options().apiKey);
    expect(JSON.parse(bytes)).toMatchObject({
      apply: false,
      origin: baseUrl,
      complete: true,
      pendingCourseIds: [],
    });
  });
  it('resumes after a lost applied response by rereading existing state and replaying without duplicate effects', async () => {
    loseResponse = true;
    await expect(runLearningMapUpgrade({ ...options(), apply: true })).rejects.toThrow();
    expect(bound).toBe(true);
    expect(linked).toBe(false);
    expect(JSON.parse(await readFile(options().checkpointPath, 'utf8'))).toMatchObject({
      complete: false,
      pendingCourseIds: ['owned-course'],
      cursor: null,
    });
    const state = await runLearningMapUpgrade({ ...options(), apply: true });
    expect(state.complete).toBe(true);
    expect(linked).toBe(true);
    expect(state.pendingCourseIds).toEqual([]);
    expect(JSON.parse(await readFile(options().checkpointPath, 'utf8'))).toMatchObject({
      apply: true,
      complete: true,
    });
  });
  it('retains its frozen meaning after a lost first-page response and rejects a changed band on resume', async () => {
    loseResponse = true;
    await expect(runLearningMapUpgrade({ ...options(), apply: true })).rejects.toThrow();
    const before = await readFile(options().checkpointPath, 'utf8');
    expect(JSON.parse(before).identityDigest).toBe(meaning);
    meaning = '4'.repeat(64);
    await expect(runLearningMapUpgrade({ ...options(), apply: true })).rejects.toThrow(
      'course, catalog or coverage changed'
    );
    expect(linked).toBe(false);
    expect(await readFile(options().checkpointPath, 'utf8')).toBe(before);
  });

  it('refuses a checkpoint belonging to another authenticated profile or apply mode', async () => {
    await runLearningMapUpgrade(options());
    const before = await readFile(options().checkpointPath, 'utf8');
    userId = 'another-profile';
    await expect(runLearningMapUpgrade(options())).rejects.toThrow('different server, profile');
    expect(await readFile(options().checkpointPath, 'utf8')).toBe(before);
    userId = 'owned-profile';
    await expect(runLearningMapUpgrade({ ...options(), apply: true })).rejects.toThrow(
      'different server, profile'
    );
    expect(bound).toBe(false);
  });
});
