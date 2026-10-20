import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import {
  learningMapResponseSchema,
  startPracticeResponseSchema,
  type LearningMapResponse,
} from '@sotto/shared';
import { prismaUnfiltered as database } from '@/lib/prisma';
import { seedLearningMapCourse } from './learning-map-fixture';

test.afterAll(async () => database.$disconnect());

async function signIn(page: Page) {
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('browser test household password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Browser learner/ }).click();
  await expect(page).toHaveURL(/\/(dashboard|learn)$/);
}

async function readMap(page: Page, courseId: string, level?: string) {
  const response = await page.request.get(
    `/api/v1/courses/${courseId}/learning-map${level ? `?level=${level}` : ''}`
  );
  expect(response.ok()).toBe(true);
  return learningMapResponseSchema.parse(await response.json());
}

async function openObjective(page: Page, map: LearningMapResponse) {
  const leaf = map.nodes.find((entry) => entry.node.kind === 'OBJECTIVE');
  if (!leaf || leaf.node.kind !== 'OBJECTIVE')
    throw new Error('The real catalog has no objective.');
  const ancestors = [];
  let parent = leaf.node.parentId;
  while (parent) {
    const row = map.nodes.find((entry) => entry.node.id === parent);
    if (!row) throw new Error('The real catalog has an incomplete ancestor path.');
    ancestors.unshift(row.node);
    parent = row.node.parentId;
  }
  for (const node of [...ancestors, leaf.node]) {
    const summary = page
      .locator('summary')
      .filter({ has: page.getByText(node.title, { exact: true }) });
    await expect(summary).toBeVisible();
    if (!(await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)))
      await summary.click();
  }
  await expect(page.getByText(leaf.node.assessment, { exact: true })).toBeVisible();
  await expect(page.getByText(leaf.node.examples[0], { exact: true })).toBeVisible();
  return leaf.node;
}

test('the authenticated learning map shows real A1 requirements and rejects unearned advancement', async ({
  page,
}) => {
  const course = await seedLearningMapCourse('fr', 'A1');
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await page.goto('/learn');
  await page
    .getByRole('link', {
      name: 'Learning map and level requirements for French browser learning map',
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/learn/map\\?course=${course.id}`));
  await expect(page.getByRole('heading', { name: 'A1 requirements', exact: true })).toBeVisible();
  const map = await readMap(page, course.id);
  expect(map.currentLevel).toBe('A1');
  expect(map.viewedLevel).toBe('A1');
  expect(map.coverage).toMatchObject({ scope: 'CLASS', level: 'A1', targetLang: 'fr' });
  expect(map.requirementId).not.toBeNull();
  expect(map.readiness).toMatchObject({ ready: false, confidentCount: 0 });
  expect(map.readiness.unassessedCount).toBe(map.readiness.requiredCount);
  await expect(
    page.getByText('A2 is locked until the remaining required objectives are confident.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Advance to A2', exact: true })).toHaveCount(0);
  await openObjective(page, map);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: test.info().outputPath('learning-map-375.png') });
  const refused = await page.request.post(`/api/v1/courses/${course.id}/learning-map/advance`, {
    headers: { origin: process.env.NEXT_PUBLIC_APP_URL! },
    data: { requestId: randomUUID(), expectedLevel: 'A1', catalogHash: map.catalogHash },
  });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({
    error: 'Master the remaining required objectives before advancing.',
  });
  expect((await database.course.findUniqueOrThrow({ where: { id: course.id } })).currentLevel).toBe(
    'A1'
  );
  expect(await database.learningLevelCompletion.count({ where: { courseId: course.id } })).toBe(0);
  expect(await database.learningObservation.count({ where: { courseId: course.id } })).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A1 requirements', exact: true })).toBeVisible();
});

test('future preview cannot practise and lower review saves its explicit A1 difficulty without demotion', async ({
  page,
}) => {
  const course = await seedLearningMapCourse('ja', 'A2');
  await signIn(page);
  await page.goto(`/learn/map?course=${course.id}`);
  await expect(page.getByRole('heading', { name: 'A2 requirements', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: /^Viewing level/ }).selectOption('B1');
  await expect(page.getByText('Reach this level to practise its objectives.')).toBeVisible();
  const future = await readMap(page, course.id, 'B1');
  expect(future.currentLevel).toBe('A2');
  expect(future.viewedLevel).toBe('B1');
  const futureObjective = await openObjective(page, future);
  await expect(
    page.getByRole('checkbox', {
      name: `Select ${futureObjective.title} for practice`,
      exact: true,
    })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Generate B1 practice', exact: true })
  ).toBeDisabled();
  const futureSelection = await page.request.post(
    `/api/v1/courses/${course.id}/learning-map/selection`,
    {
      headers: { origin: process.env.NEXT_PUBLIC_APP_URL! },
      data: { catalogVersion: future.catalogVersion, nodeIds: [futureObjective.id], level: 'B1' },
    }
  );
  expect(futureSelection.status()).toBe(409);
  expect(await database.practiceSession.count({ where: { courseId: course.id } })).toBe(0);
  await page.getByRole('combobox', { name: /^Viewing level/ }).selectOption('A1');
  await expect(page.getByText('Reviewing A1. Your current level stays A2.')).toBeVisible();
  const lower = await readMap(page, course.id, 'A1');
  const objective = await openObjective(page, lower);
  await page
    .getByRole('checkbox', { name: `Select ${objective.title} for practice`, exact: true })
    .check();
  await page.getByRole('combobox', { name: /^Practice format/ }).selectOption('GRAMMAR');
  const admitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/v1/courses/${course.id}/practice`)
  );
  await page.getByRole('button', { name: 'Generate A1 practice', exact: true }).click();
  const response = await admitted;
  expect(response.status()).toBe(202);
  const receipt = startPracticeResponseSchema.parse(await response.json());
  expect(receipt.status).toBe('preparing');
  await expect(
    page.getByText('Focused practice at A1. Your course level stays the same.').first()
  ).toBeVisible();
  const saved = await database.practiceSession.findFirstOrThrow({ where: { courseId: course.id } });
  expect(saved.practiceLevel).toBe('A1');
  expect(saved.learningSelection).toMatchObject({
    level: 'A1',
    nodeIds: [objective.id],
    objectives: [expect.objectContaining({ id: objective.id })],
  });
  expect((await database.course.findUniqueOrThrow({ where: { id: course.id } })).currentLevel).toBe(
    'A2'
  );
  expect(await database.learningObservation.count({ where: { courseId: course.id } })).toBe(0);
});
