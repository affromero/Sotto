// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  learningUpgradeReportSchema,
  learningUpgradeCoursesSchema,
  createSkillRequirements,
  type LearningUpgradeReport,
} from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  GET as preview,
  POST as apply,
} from '@/app/api/v1/courses/[courseId]/learning-map/upgrade/route';
import { GET as list } from '@/app/api/v1/learning-map/upgrade/route';
import { ensureLearningLevelBinding } from '@/lib/learning-map/binding';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { publishLearningCatalog } from '@/lib/learning-map/catalog';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('owned missing-only learning-map upgrade over HTTP and PostgreSQL', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  let curriculumId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('learning_upgrade_http');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
    await instance.database.curriculum.deleteMany();
    await instance.database.learningMapRevision.deleteMany();
    await instance.database.learningNodeIdentity.deleteMany();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Legacy German fixture' },
      update: {},
    });
    curriculumId = curriculum.id;
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          nativeLang: 'en',
          targetLang: 'de',
          curriculumId,
          currentLevel: 'A2',
          startLevel: 'A2',
          placementSource: 'NOTES',
        },
      })
    ).id;
  });
  afterEach(async () => {
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS synthetic_upgrade_failure ON "LessonLearningObjective"'
    );
    await instance.database.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS synthetic_upgrade_failure()'
    );
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  function request(
    body?: unknown,
    cursor?: string,
    token = identity.ownerToken,
    origin = 'http://localhost:3000'
  ) {
    return new NextRequest(
      `http://localhost:3000/api/v1/courses/${courseId}/learning-map/upgrade${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }
    );
  }
  const params = () => ({ params: Promise.resolve({ courseId }) });
  async function read(cursor?: string) {
    const response = await preview(request(undefined, cursor), params());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return learningUpgradeReportSchema.parse(await response.json());
  }
  const body = (page: LearningUpgradeReport) => ({
    schemaVersion: 1,
    cursor: Buffer.from(JSON.stringify(page.cursor)).toString('base64url'),
    expectedLevel: page.level,
    expectedCatalogHash: page.catalog.hash,
    expectedPageDigest: page.pageDigest,
  });
  async function commit(page: LearningUpgradeReport) {
    const response = await apply(request(body(page)), params());
    expect(response.status).toBe(200);
    return learningUpgradeReportSchema.parse(await response.json());
  }
  async function lesson(order: number, keys = ['perfect-tense']) {
    return instance.database.lesson.upsert({
      where: { curriculumId_order: { curriculumId, order } },
      create: {
        curriculumId,
        order,
        slug: `legacy-upgrade-${order}`,
        level: 'A2',
        title: 'Past events',
        objective: 'Describe a completed trip.',
        grammarPoints: keys,
        vocabThemes: [],
        targetVocab: [],
      },
      update: { grammarPoints: keys },
    });
  }

  it('previews exact aliases, broad grammar and retained originals without publishing requirements or evidence', async () => {
    const mapped = await lesson(1);
    await lesson(2, ['unknown-legacy-alias']);
    const grammar = await instance.database.learnerGrammar.create({
      data: {
        courseId,
        topicKey: 'perfect-tense',
        title: 'Perfect',
        cefrLevel: 'A2',
        mastery: 0.98,
        reps: 50,
      },
    });
    await instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        courseId,
        name: 'Legacy retained.txt',
        mimeType: 'text/plain',
        byteSize: 100,
        extractedText: 'Legacy complete text',
      },
    });
    await instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        courseId,
        name: 'Old original.txt',
        mimeType: 'text/plain',
        byteSize: 100,
        originalUrl: 'local://legacy-retained-original.txt',
        extractedText: 'An old extract with no retained original digest.',
      },
    });
    const pages: LearningUpgradeReport[] = [];
    let page = await read();
    for (;;) {
      pages.push(page);
      if (!page.nextCursor) break;
      page = await read(page.nextCursor);
    }
    expect(pages.flatMap((page) => page.items)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: mapped.id,
          disposition: 'MAPPED',
          objectiveIds: ['de.g.perfekt-haben-sein'],
          missingLinks: 1,
        }),
        expect.objectContaining({
          disposition: 'MAPPING_UNRESOLVED',
          unresolvedKeys: ['unknown-legacy-alias'],
        }),
        expect.objectContaining({
          id: grammar.id,
          disposition: 'BROAD_LEGACY',
          objectiveIds: ['de.g.perfekt-haben-sein'],
        }),
        expect.objectContaining({ kind: 'MATERIAL', disposition: 'ORIGINAL_UNAVAILABLE' }),
        expect.objectContaining({
          kind: 'MATERIAL',
          disposition: 'ORIGINAL_VERIFICATION_REQUIRED',
        }),
      ])
    );
    expect(await instance.database.learningLevelBinding.count()).toBe(0);
    expect(await instance.database.lessonLearningObjective.count()).toBe(0);
    expect(await instance.database.learningMapRevision.count()).toBe(0);
    expect(await instance.database.learningObservation.count()).toBe(0);
    expect(await instance.database.learnerObjectiveState.count()).toBe(0);
    expect(await instance.database.materialExtractionRun.count()).toBe(0);
    expect(await instance.database.materialAnalysis.count()).toBe(0);
    expect(
      await instance.database.learnerGrammar.findUniqueOrThrow({ where: { id: grammar.id } })
    ).toEqual(grammar);
  });

  it('applies only missing current-band bindings and links while preserving placement, submissions and explicit scopes on replay', async () => {
    const explicit = await lesson(1);
    const missing = await lesson(2);
    await instance.database.$transaction((database) =>
      publishLearningCatalog(database, getLanguageCatalog('de'))
    );
    await instance.database.lessonLearningObjective.create({
      data: {
        lessonId: explicit.id,
        objectiveId: 'de.g.perfekt-haben-sein',
        criterionVersion: 7,
        role: 'EXPLICIT_GENERATION',
      },
    });
    const placement = await instance.database.placementResult.create({
      data: {
        courseId,
        level: 'A2',
        responses: [{ legacy: 'retained' }],
        scoreBySkill: { grammar: 0.8 },
      },
    });
    const classRow = await instance.database.courseClass.create({
      data: { courseId, lessonId: explicit.id, order: 1, status: 'PASSED' },
    });
    const submission = await instance.database.classSubmission.create({
      data: {
        classId: classRow.id,
        userId: identity.ownerId,
        passed: true,
        overallScore: 0.91,
        receipt: { legacy: 'retained' },
      },
    });
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const initial = await read();
    expect((await commit(initial)).changed.bindings).toBe(1);
    expect((await commit(initial)).changed.bindings).toBe(0);
    const pinned = await instance.database.learningLevelBinding.findFirstOrThrow({
      where: { courseId },
    });
    const lessonPage = await read(initial.nextCursor!);
    const first = await commit(lessonPage);
    expect(first.changed.lessonLinks).toBe(1);
    expect((await commit(lessonPage)).changed.lessonLinks).toBe(0);
    expect(
      await instance.database.lessonLearningObjective.findUniqueOrThrow({
        where: {
          lessonId_objectiveId: { lessonId: explicit.id, objectiveId: 'de.g.perfekt-haben-sein' },
        },
      })
    ).toMatchObject({ criterionVersion: 7, role: 'EXPLICIT_GENERATION' });
    expect(
      await instance.database.lessonLearningObjective.count({ where: { lessonId: missing.id } })
    ).toBe(1);
    expect(await instance.database.learningLevelBinding.findMany({ where: { courseId } })).toEqual([
      pinned,
    ]);
    expect(await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })).toEqual(
      course
    );
    expect(
      await instance.database.placementResult.findUniqueOrThrow({ where: { courseId } })
    ).toEqual(placement);
    expect(
      await instance.database.classSubmission.findUniqueOrThrow({ where: { id: submission.id } })
    ).toEqual(submission);
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: classRow.id } })
    ).toEqual(classRow);
    expect(await instance.database.learningLevelCompletion.count()).toBe(0);
    expect(await instance.database.learningObservation.count()).toBe(0);
    expect(await instance.database.learnerObjectiveState.count()).toBe(0);
  });

  it('rejects changed page meaning and resumes a rolled-back bounded batch without partial mappings', async () => {
    const first = await lesson(1);
    await lesson(2);
    const last = await lesson(3);
    const initial = await read();
    await commit(initial);
    let page = await read(initial.nextCursor!);
    await instance.database.lesson.update({
      where: { id: first.id },
      data: { grammarPoints: ['unknown-replacement'] },
    });
    expect((await apply(request(body(page)), params())).status).toBe(409);
    expect(await instance.database.lessonLearningObjective.count()).toBe(0);
    page = await read(initial.nextCursor!);
    expect((await apply(request({ ...body(page), expectedLevel: 'B1' }), params())).status).toBe(
      409
    );
    expect(
      (await apply(request({ ...body(page), expectedCatalogHash: '0'.repeat(64) }), params()))
        .status
    ).toBe(409);
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION synthetic_upgrade_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."lessonId" = '${last.id}' THEN RAISE EXCEPTION 'Synthetic maintenance insert failure'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER synthetic_upgrade_failure BEFORE INSERT ON "LessonLearningObjective" FOR EACH ROW EXECUTE FUNCTION synthetic_upgrade_failure()'
    );
    expect((await apply(request(body(page)), params())).status).toBe(503);
    expect(await instance.database.lessonLearningObjective.count()).toBe(0);
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER synthetic_upgrade_failure ON "LessonLearningObjective"'
    );
    const [left, right] = await Promise.all([commit(page), commit(page)]);
    expect(left.changed.lessonLinks + right.changed.lessonLinks).toBe(2);
    expect(await instance.database.lessonLearningObjective.count()).toBe(2);
  });

  it('rejects a resumed cursor after the course band changes instead of adopting new requirements', async () => {
    await lesson(1);
    const page = await read();
    await instance.database.course.update({
      where: { id: courseId },
      data: { currentLevel: 'B1' },
    });
    expect((await preview(request(undefined, page.nextCursor!), params())).status).toBe(409);
    expect((await apply(request(body(page)), params())).status).toBe(409);
    expect(await instance.database.learningLevelBinding.count()).toBe(0);
    expect(await instance.database.lessonLearningObjective.count()).toBe(0);
    expect(await instance.database.learningObservation.count()).toBe(0);
  });

  it('retains unavailable language courses and unknown aliases without substituting a grammar catalog', async () => {
    const curriculum = await instance.database.curriculum.create({
      data: { nativeLang: 'en', targetLang: 'sv', title: 'Existing Swedish' },
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'sv',
          currentLevel: 'B2',
          startLevel: 'B1',
        },
      })
    ).id;
    const initial = await read();
    expect(initial.catalog.available).toBe(false);
    expect(initial.items[0].disposition).toBe('CATALOG_UNAVAILABLE');
    expect((await commit(initial)).changed).toEqual({ bindings: 0, lessonLinks: 0 });
    expect(await instance.database.learningLevelBinding.count()).toBe(0);
    expect(await instance.database.learningMapRevision.count()).toBe(0);
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
    ).toMatchObject({ currentLevel: 'B2', startLevel: 'B1', placementSource: null });
    const foreign = await identity.household('Foreign upgrade owner');
    expect((await preview(request(undefined, undefined, foreign.token), params())).status).toBe(
      404
    );
    expect(
      (
        await apply(
          request(body(initial), undefined, identity.ownerToken, 'https://foreign.example'),
          params()
        )
      ).status
    ).toBe(403);
  });

  it('previews newer requirement inventory while preserving pinned coverage and earned transition receipts', async () => {
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const coverage = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A2',
      ttsProvider: 'openai',
      sttProvider: 'openai',
    });
    const binding = await instance.database.$transaction((database) =>
      ensureLearningLevelBinding(database, course, 'A2', coverage)
    );
    const completion = await instance.database.learningLevelCompletion.create({
      data: {
        courseId,
        level: 'A2',
        nextLevel: 'B1',
        bindingId: binding.id,
        requestId: randomUUID(),
        intentHash: 'retained',
        evidenceHash: 'retained',
        receipt: { retained: true },
      },
    });
    const newer = structuredClone(getLanguageCatalog('de'));
    newer.version++;
    const objective = newer.nodes.find((node) => node.kind === 'OBJECTIVE' && node.level === 'A2');
    if (!objective || objective.kind !== 'OBJECTIVE')
      throw new Error('Expected an authored A2 objective.');
    newer.nodes.push({
      ...objective,
      id: 'de.g.synthetic-new-requirement',
      grammarKeys: ['synthetic-new-requirement'],
      order: 10000,
    });
    await instance.database.$transaction((database) => publishLearningCatalog(database, newer));
    const page = await read();
    expect(page.upgrade).toMatchObject({
      available: true,
      added: 1,
      removed: 0,
      changed: 0,
      earnedTransitionsPreserved: true,
    });
    expect(page.coverage).toEqual(coverage);
    await commit(page);
    expect(
      await instance.database.learningLevelBinding.findUniqueOrThrow({
        where: { id: binding.id },
        include: { revision: true },
      })
    ).toEqual(binding);
    expect(
      await instance.database.learningLevelCompletion.findUniqueOrThrow({
        where: { id: completion.id },
      })
    ).toEqual(completion);
  });

  it('pages at most twenty owned courses and excludes another learner from the upgrade index', async () => {
    const natives = [
      'es',
      'fr',
      'pt',
      'it',
      'ja',
      'zh',
      'ko',
      'ar',
      'ru',
      'pl',
      'nl',
      'sv',
      'da',
      'no',
      'fi',
      'tr',
      'uk',
      'cs',
      'el',
      'he',
    ];
    for (const nativeLang of natives)
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          nativeLang,
          targetLang: 'de',
          curriculumId,
          currentLevel: 'A1',
        },
      });
    const foreign = await identity.household('Another course owner');
    await instance.database.course.create({
      data: { userId: foreign.id, nativeLang: 'en', targetLang: 'de', curriculumId },
    });
    const send = (afterId?: string) =>
      list(
        new NextRequest(
          `http://localhost:3000/api/v1/learning-map/upgrade${afterId ? `?afterId=${encodeURIComponent(afterId)}` : ''}`,
          { headers: { cookie: `sotto_session=${identity.ownerToken}` } }
        )
      );
    const first = learningUpgradeCoursesSchema.parse(await (await send()).json());
    expect(first.courses).toHaveLength(20);
    expect(first.nextAfterId).not.toBeNull();
    const second = learningUpgradeCoursesSchema.parse(
      await (await send(first.nextAfterId!)).json()
    );
    expect(second.courses).toHaveLength(1);
    expect(second.nextAfterId).toBeNull();
    expect(new Set([...first.courses, ...second.courses].map((course) => course.id)).size).toBe(21);
  });
});
