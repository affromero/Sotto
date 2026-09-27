import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { prismaUnfiltered as database } from '@/lib/prisma';
import { seedClass } from './class-fixture';

test.afterAll(async () => database.$disconnect());

test('an incorrect household password cannot access learner data', async ({ page }) => {
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('incorrect household password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await page.request.get('/api/v1/courses')).status()).toBe(401);
});

test('a learner configures local providers and creates a persistent course', async ({ page }) => {
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('browser test household password');
  await page.getByRole('button', { name: /sign in|continue|enter/i }).click();
  await page.getByRole('button', { name: /Browser learner/ }).click();
  await expect(page).toHaveURL(/\/(welcome|dashboard|learn)$/);
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await expect(page.getByText('How Sotto works', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByLabel('Admin display name').fill('Browser learner');
  await page.getByRole('button', { name: 'Continue with admin profile' }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Learn Spanish' }).click();
  await page.getByRole('button', { name: 'Continue to agent setup' }).click();
  await page.getByRole('button', { name: /^Local/ }).click();
  await page.getByLabel('Endpoint URL').fill(`${process.env.SOTTO_BROWSER_PROVIDER}/v1`);
  await page.getByLabel('Local model name').fill('browser-fixture');
  await page.getByRole('button', { name: 'Save endpoint', exact: true }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await page.getByRole('button', { name: /^Kokoro/ }).click();
  await page.getByRole('button', { name: /^Whisper/ }).click();
  await page.getByLabel('Kokoro endpoint URL (optional)').fill(process.env.SOTTO_BROWSER_PROVIDER!);
  await page
    .getByLabel('Whisper endpoint URL (optional)')
    .fill(`${process.env.SOTTO_BROWSER_PROVIDER}/v1`);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await page
    .getByLabel('Storage directory')
    .fill(join(process.env.SOTTO_BROWSER_DIRECTORY!, 'storage'));
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await page.getByLabel('Material details').fill('I want to greet Spanish-speaking friends.');
  await page.getByRole('button', { name: 'Add material' }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await page.getByRole('button', { name: 'Choose my CEFR level' }).click();
  await page.getByRole('button', { name: /^A1\b/ }).click();
  await page.getByRole('button', { name: 'Compose my course', exact: true }).click();
  await page.getByRole('button', { name: 'Compose from this brief' }).click();
  await page.getByRole('button', { name: 'Enter Sotto' }).click();
  await page.getByRole('button', { name: "Open today's session" }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await page.reload();
  await expect(page.getByText('Spanish', { exact: true }).first()).toBeVisible();
  const course = await database.course.findFirstOrThrow({ include: { user: true, note: true } });
  expect(course).toMatchObject({
    nativeLang: 'en',
    targetLang: 'es',
    currentLevel: 'A1',
    user: { hasCompletedOnboarding: true },
  });
  expect(course.note?.body).toContain('greet Spanish-speaking friends');
});

test('a learner plays audio and completes all five skills on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const fixture = await seedClass();
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('browser test household password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Browser learner/ }).click();
  await expect(page).toHaveURL(/\/(dashboard|learn)$/);
  await page.goto(`/learn/class/${fixture.classId}`);
  await page.getByRole('button', { name: 'Begin the class' }).click();
  for (const next of ['Reading', 'Listening']) {
    await page.getByRole('button', { name: 'Option 1: Hallo' }).click();
    await expect(page.getByText('Hallo is a greeting.').first()).toBeVisible();
    await page.getByRole('button', { name: 'See result', exact: true }).click();
    await page.getByRole('button', { name: `Continue · ${next}` }).click();
  }
  const audio = page.getByLabel('Lesson audio', { exact: true });
  await page.getByRole('button', { name: 'Play audio', exact: true }).click();
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0.3);
  await page.getByRole('button', { name: 'Pause audio', exact: true }).click();
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.getByRole('button', { name: 'Option 1: Hallo' }).click();
  await page.getByRole('button', { name: 'Continue · Speaking' }).click();
  await page.getByRole('button', { name: 'Start recording your pronunciation' }).click();
  await expect(page.getByText(/listening · [2-9]s/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByText('Clear pronunciation.').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Continue · Writing' }).click();
  await page.getByRole('textbox').fill('Guten Morgen, mein Freund!');
  await page.getByRole('button', { name: 'Check writing', exact: true }).click();
  await expect(page.getByText('Your greeting is clear.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Finish class', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await database.courseClass.findUniqueOrThrow({ where: { id: fixture.classId } })).status
    )
    .toBe('PASSED');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'An hour, well spent.' })).toBeVisible();
  const saved = await database.courseClass.findUniqueOrThrow({
    where: { id: fixture.classId },
    include: {
      submission: true,
      sections: { include: { prompts: { include: { recordings: true } } } },
    },
  });
  expect(saved.submission).toMatchObject({ passed: true });
  expect(saved.sections.every((section) => section.passed)).toBe(true);
  expect(
    saved.sections.flatMap((section) => section.prompts.flatMap((prompt) => prompt.recordings))
  ).toEqual([expect.objectContaining({ status: 'SCORED', transcript: 'Guten Morgen.' })]);
});
