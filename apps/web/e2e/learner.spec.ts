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
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
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

test('Local and Custom save URL, key, and model and use them for a real compatible request', async ({
  page,
}) => {
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('browser test household password');
  await page.getByRole('button', { name: /sign in|continue|enter/i }).click();
  await page.getByRole('button', { name: /Browser learner/ }).click();
  await expect(page).toHaveURL(/\/(welcome|dashboard|learn)$/);
  await page.goto('/welcome?step=4');
  for (const [provider, width, key] of [
    ['Local', 1280, 'browser-local-key'],
    ['Custom', 375, 'browser-custom-key'],
  ] as const) {
    await page.setViewportSize({ width, height: 812 });
    await page.getByRole('button', { name: new RegExp(`^${provider}`) }).click();
    const endpoint = page.getByLabel('Endpoint URL');
    const apiKey = page.getByLabel(`${provider} API key`);
    const model = page.getByLabel(`${provider} model name`);
    await endpoint.fill(`${process.env.SOTTO_BROWSER_PROVIDER}/v1`);
    await apiKey.fill(key);
    await expect(apiKey).toHaveAttribute('type', 'password');
    await expect(
      page.getByRole('button', { name: 'Save configuration', exact: true })
    ).toBeDisabled();
    await model.fill('browser-fixture');
    await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
    await page.getByRole('button', { name: 'Save without verification', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Save configuration', exact: true })
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
    await expect(page.getByText('Endpoint configured', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    const response = await page.request.post('/api/v1/admin/test-model', {
      headers: { origin: process.env.NEXT_PUBLIC_APP_URL! },
      data: { type: 'ai', provider: 'local', model: 'browser-fixture' },
    });
    expect(await response.json()).toMatchObject({ success: true, response: 'Hello!' });
    await model.fill('another-model');
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeDisabled();
    await model.fill('browser-fixture');
  }
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

test('full practice keeps skill sections usable on desktop and a 375px screen', async ({
  page,
}) => {
  const fixture = await seedClass();
  const listening = await database.classSection.findFirstOrThrow({
    where: { classId: fixture.classId, skill: 'LISTENING' },
  });
  const session = await database.practiceSession.create({
    data: {
      courseId: fixture.courseId,
      kind: 'FULL',
      seed: 'browser-contextual-practice',
      episodeId: listening.episodeId,
      items: [
        {
          id: 'g0',
          prompt: 'Mia hat gestern einen Film _____.',
          options: ['gesehen', 'sehen', 'sieht', 'sah'],
          correctIndex: 0,
          explanation: 'Perfekt uses gesehen.',
          vocabLemma: null,
          focusTargetId: null,
        },
        {
          id: 'g1',
          prompt: 'Mia ist ins Kino _____.',
          options: ['gegangen', 'gehen', 'geht', 'ging'],
          correctIndex: 0,
          explanation: 'Perfekt uses gegangen.',
          vocabLemma: null,
          focusTargetId: null,
        },
        {
          id: 'r0',
          prompt: 'Wo war Mia?',
          options: ['Im Kino', 'Zu Hause', 'Im Park', 'Im Café'],
          correctIndex: 0,
          explanation: 'The text says Kino.',
          passageText: 'Mia war gestern im Kino.',
          vocabLemma: null,
          focusTargetId: null,
        },
        {
          id: 'l0',
          prompt: 'Welche Begrüßung hörst du?',
          options: ['Hallo', 'Danke', 'Bitte', 'Tschüss'],
          correctIndex: 0,
          explanation: 'Hallo is a greeting.',
          vocabLemma: null,
          focusTargetId: null,
        },
      ],
      prompts: {
        create: { order: 1, targetPhrase: 'Guten Morgen.', translation: 'Good morning.' },
      },
      writingPrompts: { create: { order: 1, task: 'Setze ins Perfekt.\n\nMia geht ins Kino.' } },
    },
  });
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('browser test household password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Browser learner/ }).click();
  await expect(page).toHaveURL(/\/(dashboard|learn)$/);
  await page.goto('/learn/practice');
  await page.getByRole('button', { name: 'Resume Full catch-up practice' }).click();
  const grammar = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Grammar' }) });
  await grammar.locator('summary').focus();
  await page.keyboard.press('Enter');
  await grammar.getByRole('button', { name: 'Option 1: gesehen' }).click();
  await grammar.getByRole('button', { name: 'Next question' }).click();
  await expect(grammar.getByText('Mia ist ins Kino _____.')).toBeVisible();
  await expect(grammar.getByText('Mia hat gestern einen Film _____.')).toHaveCount(0);
  await grammar.getByRole('button', { name: 'Previous question' }).click();
  await grammar.locator('summary').click();
  await grammar.locator('summary').click();
  await expect(grammar.getByRole('button', { name: 'Option 1: gesehen' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const writing = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Writing' }) });
  await writing.locator('summary').click();
  await writing.getByRole('textbox').fill('Mia ist ins Kino gegangen.');
  await writing.locator('summary').click();
  await writing.locator('summary').click();
  await expect(writing.getByRole('textbox')).toHaveValue('Mia ist ins Kino gegangen.');
  const audioSection = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Listening' }) });
  await audioSection.locator('summary').click();
  const audio = audioSection.getByLabel('Practice audio');
  await expect(audio).toBeVisible();
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0.3);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  const speaking = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Speaking' }) });
  await speaking.locator('summary').click();
  await expect(speaking.getByText('Guten Morgen.', { exact: true })).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect(grammar.getByRole('button', { name: 'Option 1: gesehen' })).toBeVisible();
    await expect(writing.getByRole('textbox')).toHaveValue('Mia ist ins Kino gegangen.');
    const optionBounds = await grammar
      .getByRole('button', { name: 'Option 1: gesehen' })
      .boundingBox();
    expect(optionBounds).not.toBeNull();
    expect(optionBounds!.x).toBeGreaterThanOrEqual(0);
    expect(optionBounds!.x + optionBounds!.width).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: 'Practice menu' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`practice-${width}.png`) });
  }
  const rejected = await page.request.post(`/api/v1/practice/${session.id}/submit`, {
    data: { answers: [{ itemId: 'l0', selectedIndex: 0 }] },
  });
  expect(rejected.status()).toBe(409);
  expect(
    (await database.practiceSession.findUniqueOrThrow({ where: { id: session.id } })).status
  ).toBe('ACTIVE');
});
