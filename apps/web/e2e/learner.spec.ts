import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { classReceiptSchema, readingVocabularySchema } from '@sotto/shared';
import { prismaUnfiltered as database } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { initialStitchAttemptId } from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { verifyInitialStitchPublication } from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { listAssessmentAudioAttempts } from '@/lib/learning/classes/audio/assessment-audio-attempt';
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

test('compatible connections keep credentials bound through consent, model checks, and edits', async ({
  page,
}) => {
  const provider = process.env.SOTTO_BROWSER_PROVIDER!;
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('browser test household password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Browser learner/ }).click();
  await expect(page).toHaveURL(/\/(welcome|dashboard|learn)$/);
  await page.goto('/welcome?step=4');

  for (const connection of [
    { card: 'Local', width: 1280, token: 'browser-connection-alpha' },
    { card: 'Custom', width: 375, token: 'browser-connection-beta' },
  ]) {
    const expected = await page.request.post(provider + '/fixture/connection', {
      data: { token: connection.token, model: 'browser-fixture' },
    });
    expect(expected.ok()).toBe(true);
    await page.setViewportSize({ width: connection.width, height: 812 });
    await page.getByRole('button', { name: new RegExp('^' + connection.card) }).click();
    const save = page.getByRole('button', { name: 'Save configuration', exact: true });
    const secret = page.getByLabel(connection.card + ' API key');
    await page.getByLabel('Endpoint URL').fill(provider + '/v1');
    await secret.fill(connection.token);
    await expect(secret).toHaveAttribute('type', 'password');
    await expect(save).toBeDisabled();
    const model = page.getByLabel(connection.card + ' model name');
    await model.fill('browser-fixture');
    const configuration = page.waitForRequest(
      (request) =>
        request.method() === 'PATCH' && request.url().endsWith('/api/v1/admin/site-config')
    );
    await save.click();
    expect((await configuration).postDataJSON()).toEqual({
      aiProvider: 'local',
      aiBaseUrl: provider + '/v1',
      aiModel: 'browser-fixture',
    });
    const consent = page.getByRole('button', { name: 'Save without verification', exact: true });
    await expect(consent).toBeVisible();
    const authenticatedSave = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().endsWith('/api/v1/settings/ai-keys') &&
        request.postDataJSON().allowUnverified === true
    );
    await consent.click();
    const mutation = await authenticatedSave;
    expect(mutation.headers()['x-sotto-reviewed-ai-endpoint']).toBe(provider + '/v1');
    const command = mutation.postDataJSON();
    expect(command).toMatchObject({ provider: 'local', allowUnverified: true });
    expect(command.values ?? command.patch).toMatchObject({ apiKey: connection.token });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Endpoint configured', { exact: true })).toBeVisible();
    const generated = await page.request.post('/api/v1/admin/test-model', {
      headers: { origin: process.env.NEXT_PUBLIC_APP_URL! },
      data: { type: 'ai', provider: 'local', model: 'browser-fixture' },
    });
    expect(await generated.json()).toMatchObject({ success: true, response: 'Hello!' });
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(connection.token);
    await page.screenshot({
      path: test.info().outputPath('connection-' + connection.width + '.png'),
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      connection.width
    );
    await model.fill('changed-after-proof');
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeDisabled();
    await expect(page.getByText('Endpoint configured', { exact: true })).toHaveCount(0);
  }
});

test('a learner plays audio and completes all five skills on a narrow screen', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const fixture = await seedClass();
  const preparedClass = await database.courseClass.findUniqueOrThrow({
    where: { id: fixture.classId },
  });
  const readingQuestions = await database.lessonQuestion.findMany({
    where: { section: { classId: fixture.classId }, skill: 'READING' },
    orderBy: { order: 'asc' },
  });
  expect(readingVocabularySchema.parse(preparedClass.readingVocabulary).words).toEqual([
    {
      lemma: 'Hallo',
      gloss: 'hello',
      pos: 'interjection',
      sourceForm: 'Hallo',
      questionIds: readingQuestions.map(({ id }) => id),
    },
  ]);
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('browser test household password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Browser learner/ }).click();
  await expect(page).toHaveURL(/\/(dashboard|learn)$/);
  await page.goto(`/learn/class/${fixture.classId}`);
  const header = page.getByRole('banner', { name: 'Class header' });
  await expect(header.getByRole('link', { name: 'Back to Learn' })).toHaveAttribute(
    'href',
    '/learn'
  );
  await expect(header.getByRole('navigation', { name: 'Class location' })).toContainText(
    'Before you practise'
  );
  await page.getByRole('button', { name: 'Explain the basics' }).click();
  await expect(page.getByRole('heading', { name: 'A German greeting' })).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    page.getByText('Hallo is a greeting. Place the greeting before the person’s name.')
  ).toBeVisible();
  await expect(page.getByText('Hallo, Mia!', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark basics as read' }).click();
  await expect(header.getByRole('navigation', { name: 'Class location' })).toContainText(
    'Lesson overview'
  );
  const afterPrelude = await database.courseClass.findUniqueOrThrow({
    where: { id: fixture.classId },
  });
  expect(afterPrelude.adaptiveSeed).toMatchObject(
    preparedClass.adaptiveSeed as Record<string, unknown>
  );
  const illustration = page.locator('img[src*="class-conversation"]');
  await expect(illustration).toBeVisible();
  await illustration.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
  });
  expect(
    await illustration.evaluate((image: HTMLImageElement) => image.naturalWidth)
  ).toBeGreaterThan(0);
  const helpButton = page.getByRole('button', { name: 'Help in your language' });
  let helpAdmissions = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/lesson-help')) helpAdmissions++;
  });
  await helpButton.click();
  const languageHelp = page.getByRole('dialog', { name: 'Greet a friend in German' });
  await expect(languageHelp.getByText('Hello, Anna!', { exact: true })).toBeVisible();
  await expect(languageHelp.getByText('Hallo, Anna!', { exact: true }).first()).toHaveAttribute(
    'lang',
    'de'
  );
  await expect(languageHelp.getByText('Hallo, Mia!', { exact: true })).toHaveCount(0);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme
      );
      expect(
        await languageHelp.evaluate((element) => element.scrollWidth <= element.clientWidth)
      ).toBe(true);
      const bounds = await languageHelp.boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(15);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width - 15);
      await page.screenshot({
        path: test.info().outputPath(`class-language-help-${width}-${theme}.png`),
      });
    }
  }
  await page.keyboard.press('Escape');
  await expect(languageHelp).not.toBeVisible();
  await expect(helpButton).toBeFocused();
  await helpButton.click();
  await expect(languageHelp.getByText('Hello, Anna!', { exact: true })).toBeVisible();
  expect(helpAdmissions).toBe(1);
  await languageHelp.getByRole('button', { name: 'Back to lesson' }).click();
  await expect(helpButton).toBeFocused();
  expect(
    (await database.courseClass.findUniqueOrThrow({ where: { id: fixture.classId } })).adaptiveSeed
  ).toEqual(afterPrelude.adaptiveSeed);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      );
      await expect(header.getByRole('link', { name: 'Back to Learn' })).toBeInViewport();
      await page.screenshot({
        path: test.info().outputPath(`class-navigation-${width}-${theme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Begin the class' }).scrollIntoViewIfNeeded();
  await expect(header.getByRole('link', { name: 'Back to Learn' })).toBeInViewport();
  await page.getByRole('button', { name: 'Begin the class' }).click();
  await expect(header.getByRole('navigation', { name: 'Class location' })).toContainText('Grammar');
  await expect(header.getByRole('button', { name: 'Lesson overview' })).toBeVisible();
  for (const [skill, next] of [
    ['GRAMMAR', 'Reading'],
    ['READING', 'Listening'],
  ] as const) {
    const questions = page.getByRole('region', { name: /^Question \d+$/ });
    await expect(questions).toHaveCount(fixture.counts[skill]);
    for (let index = fixture.counts[skill] - 1; index >= 0; index--) {
      const question = page.getByRole('region', { name: `Question ${index + 1}`, exact: true });
      await expect(question.getByText('Hallo is a greeting.')).toHaveCount(0);
      await question.getByRole('button', { name: 'Option 1: Hallo' }).click();
      await expect(question.getByText('Hallo is a greeting.')).toBeVisible();
    }
    await page.getByRole('button', { name: `Continue · ${next}` }).click();
  }
  const audio = page.getByLabel('Lesson audio', { exact: true });
  await expect(audio).toBeVisible();
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  await audio.press('Space');
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0.3);
  await audio.press('Space');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await expect(page.getByRole('button', { name: 'Option 1: Hallo' })).toHaveCount(
    fixture.counts.LISTENING
  );
  for (let index = 0; index < fixture.counts.LISTENING; index++) {
    await page.getByRole('button', { name: 'Option 1: Hallo' }).nth(index).click();
  }
  await page.getByRole('button', { name: 'Continue · Speaking' }).click();
  for (let index = 0; index < fixture.counts.SPEAKING; index++) {
    await page.getByRole('button', { name: 'Start recording your pronunciation' }).click();
    await expect(page.getByText(/listening · [2-9]s/)).toBeVisible();
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await expect(page.getByText('Clear pronunciation.').first()).toBeVisible({ timeout: 30_000 });
    if (index + 1 < fixture.counts.SPEAKING) {
      await page.getByRole('button', { name: 'Next phrase' }).click();
    }
  }
  await page.getByRole('button', { name: 'Continue · Writing' }).click();
  await expect(page.getByRole('textbox')).toHaveCount(fixture.counts.WRITING);
  for (let index = 0; index < fixture.counts.WRITING; index++) {
    await page.getByRole('textbox').nth(index).fill('Guten Morgen, mein Freund!');
  }
  await page.getByRole('button', { name: 'Check writing', exact: true }).click();
  await expect(page.getByText('Your greeting is clear.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Finish class', exact: true }).click();
  const assessment = page.getByRole('region', { name: 'Show what you have learned' });
  await expect(assessment).toBeVisible();
  await assessment.getByRole('button', { name: 'Prepare assessment' }).click();
  const questions = assessment.locator('fieldset');
  await expect(questions.first()).toBeVisible({ timeout: 180_000 });
  const statusResponse = await page.request.get(
    `/api/v1/classes/${fixture.classId}/assessment/status`
  );
  const status = await statusResponse.json();
  expect(status.status).toBe('READY');
  const materialResponse = await page.request.get(
    `/api/v1/classes/${fixture.classId}/assessment/${status.assessmentId}`
  );
  const material = await materialResponse.json();
  expect(JSON.stringify(material)).not.toMatch(/correctIndex|rubric|privateTranscript/);
  for (const question of await questions.all()) {
    const legend = await question.locator('legend').innerText();
    const name = /greeting for (\w+) in/.exec(legend)?.[1];
    expect(name).toBeTruthy();
    await question.getByRole('radio', { name: `Guten Tag, ${name}!` }).check();
  }
  const listeningAudio = assessment.getByLabel('Assessment listening audio');
  await listeningAudio.evaluate((element: HTMLAudioElement) => element.load());
  await expect
    .poll(() => listeningAudio.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  const references = assessment.getByLabel('Speaking assessment reference audio');
  await expect(references).toHaveCount(fixture.counts.SPEAKING);
  const referenceUrl = await references.first().getAttribute('src');
  expect(referenceUrl).toBeTruthy();
  const referenceResponse = await page.request.get(referenceUrl!);
  expect(referenceResponse.ok()).toBe(true);
  expect(referenceResponse.headers()['content-type']).toContain('audio/wav');
  await references.first().evaluate((element: HTMLAudioElement) => element.load());
  await expect
    .poll(() => references.first().evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  const speakingTasks = assessment.locator('p').filter({ hasText: /^Guten Tag, [A-Za-z]+!$/ });
  await expect(speakingTasks).toHaveCount(fixture.counts.SPEAKING);
  for (const task of await speakingTasks.all()) {
    const text = await task.innerText();
    expect(
      (
        await page.request.post(`${process.env.SOTTO_BROWSER_PROVIDER}/fixture/transcription`, {
          data: { text },
        })
      ).ok()
    ).toBe(true);
    const card = task.locator('..');
    await card.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await page.waitForTimeout(2200);
    await card.getByRole('button', { name: 'Stop recording' }).click();
    await card.getByRole('button', { name: 'Save recording' }).click();
    await expect(card.getByText('Recording saved.')).toBeVisible({ timeout: 30_000 });
  }
  const writingTasks = assessment.getByRole('textbox');
  await expect(writingTasks).toHaveCount(fixture.counts.WRITING);
  for (const task of await writingTasks.all()) {
    const label = await task.getAttribute('id');
    const prompt = await assessment.locator(`label[for="${label}"]`).innerText();
    const name = /^Greet (\w+) in German\.$/.exec(prompt)?.[1];
    expect(name).toBeTruthy();
    await task.fill(`Guten Tag, ${name}!`);
    const card = task.locator('..');
    await card.getByRole('button', { name: 'Save response' }).click();
    let lastStatusCheck = 0;
    await expect
      .poll(
        async () => {
          if (await card.getByText('Response saved.').isVisible()) return true;
          if (
            Date.now() - lastStatusCheck >= 3000 &&
            (await card.getByText('Your response needs recovery before continuing.').isVisible())
          ) {
            lastStatusCheck = Date.now();
            await assessment.getByRole('button', { name: 'Check saved status' }).click();
          }
          return false;
        },
        { timeout: 60_000 }
      )
      .toBe(true);
  }
  const submissionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response
        .url()
        .endsWith(`/api/v1/classes/${fixture.classId}/assessment/${status.assessmentId}`)
  );
  await assessment.getByRole('button', { name: 'Submit assessment' }).click();
  expect((await submissionResponse).status()).toBe(200);
  await expect
    .poll(
      async () =>
        (await database.courseClass.findUniqueOrThrow({ where: { id: fixture.classId } })).status
    )
    .toBe('PASSED');
  await expect(page.getByRole('heading', { name: 'An hour, well spent.' })).toBeVisible();
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
  if (!saved.submission) throw new Error('Assessment submission missing');
  const receipt = classReceiptSchema.parse(saved.submission?.receipt);
  expect(receipt.source).toBe('ASSESSMENT');
  expect(receipt.sections).toHaveLength(5);
  expect(receipt.sections.every((section) => section.passed)).toBe(true);
  const recordings = saved.sections.flatMap((section) =>
    section.prompts.flatMap((prompt) => prompt.recordings)
  );
  expect(recordings).toHaveLength(fixture.counts.SPEAKING);
  for (const recording of recordings) {
    expect(recording).toMatchObject({ status: 'SCORED', transcript: 'Guten Morgen.' });
  }
  const assessmentAudio = await database.classAssessmentSection.findFirstOrThrow({
    where: { assessment: { classId: fixture.classId }, skill: 'LISTENING' },
    select: {
      assessmentId: true,
      episodeId: true,
      episode: { select: { audioUrl: true, segments: { select: { audioUrl: true } } } },
    },
  });
  expect(assessmentAudio.episodeId).toBeTruthy();
  await expect(
    sottoTransaction(
      database,
      async (tx) => {
        await tx.courseClass.update({
          where: { id: fixture.classId },
          data: { attempt: { increment: 1 } },
        });
        const savedAttempt = await tx.sidedoorState.findUniqueOrThrow({
          where: { id: initialStitchAttemptId(assessmentAudio.episodeId!) },
        });
        const state = savedAttempt.state;
        if (
          !state ||
          typeof state !== 'object' ||
          Array.isArray(state) ||
          typeof state.operationId !== 'string'
        )
          throw new Error('Stitch attempt missing');
        const stitch = await sottoJobOutbox(tx).read(state.operationId);
        if (!stitch) throw new Error('Stitch operation missing');
        await expect(verifyInitialStitchPublication(tx, stitch)).rejects.toThrow();
        await expect(
          verifyInitialStitchPublication(tx, stitch, undefined, { allowHistoricalAssessment: true })
        ).resolves.toMatchObject({ kind: 'READY' });
        throw new Error('Rollback historical audio check');
      },
      { timeoutMs: 30_000 }
    )
  ).rejects.toThrow('Rollback historical audio check');
  await database.courseClass.update({
    where: { id: fixture.classId },
    data: { attempt: { increment: 1 } },
  });
  const attempts = await sottoTransaction(database, (tx) =>
    listAssessmentAudioAttempts(tx, {
      classId: fixture.classId,
      courseId: fixture.courseId,
      userId: saved.submission!.userId,
    })
  );
  expect(attempts).toHaveLength(1);
  const attempt = attempts[0]!;
  const executions = await database.$queryRaw<Array<{ state: unknown }>>`
    SELECT state FROM "SidedoorState"
    WHERE state->>'kind' = 'job_execution'
      AND state->>'parentId' = ${attempt.operationId}
      AND state->>'status' = 'settled'`;
  const settled = executions.find((row) => {
    const value = row.state;
    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'id' in value &&
      typeof value.id === 'string' &&
      'executorId' in value &&
      typeof value.executorId === 'string' &&
      'fingerprint' in value &&
      value.fingerprint === attempt.fingerprint
    );
  });
  if (
    !settled ||
    !settled.state ||
    typeof settled.state !== 'object' ||
    Array.isArray(settled.state) ||
    !('id' in settled.state) ||
    !('executorId' in settled.state) ||
    typeof settled.state.id !== 'string' ||
    typeof settled.state.executorId !== 'string'
  )
    throw new Error('Settled audio execution missing');
  const claimPrefix = createHash('sha256')
    .update(JSON.stringify([fixture.classId, saved.createdAt.getTime()]))
    .digest('hex');
  const claimId = `${SIDEDOOR_STATE_ID}:assessment-audio-claim:${claimPrefix}:${attempt.operationId}`;
  await database.sidedoorState.create({
    data: {
      id: claimId,
      revision: randomUUID(),
      state: {
        classId: fixture.classId,
        classGeneration: saved.createdAt.getTime(),
        assessmentId: assessmentAudio.assessmentId,
        operationId: attempt.operationId,
        fingerprint: attempt.fingerprint,
        nonce: randomUUID(),
        status: 'RELEASED',
        execution: {
          id: settled.state.id,
          parentId: attempt.operationId,
          fingerprint: attempt.fingerprint,
          executorId: settled.state.executorId,
        },
      },
    },
  });
  const referencePrompts = await database.speakingPrompt.findMany({
    where: { assessmentSection: { assessment: { classId: fixture.classId } } },
    select: { assessmentReference: { select: { currentUrl: true } } },
  });
  const audioUrls = [
    assessmentAudio.episode?.audioUrl,
    ...(assessmentAudio.episode?.segments.map((segment) => segment.audioUrl) ?? []),
    ...referencePrompts.map((prompt) => prompt.assessmentReference?.currentUrl),
  ];
  expect(audioUrls).toHaveLength(2 + fixture.counts.SPEAKING);
  const audioPaths = audioUrls.map((url) => {
    expect(url).toMatch(/^\/api\/v1\/storage\//);
    return join(
      process.env.SOTTO_BROWSER_DIRECTORY!,
      'storage',
      url!.slice('/api/v1/storage/'.length)
    );
  });
  for (const path of audioPaths) expect((await stat(path)).size).toBeGreaterThan(0);
  const classListening = await database.classSection.findFirstOrThrow({
    where: { classId: fixture.classId, skill: 'LISTENING' },
    include: { episode: true },
  });
  expect(classListening.episode?.audioUrl).toMatch(/^\/api\/v1\/storage\//);
  const classListeningPath = join(
    process.env.SOTTO_BROWSER_DIRECTORY!,
    'storage',
    classListening.episode!.audioUrl!.slice('/api/v1/storage/'.length)
  );
  expect((await stat(classListeningPath)).size).toBeGreaterThan(0);
  const deletedClass = await page.request.delete(`/api/v1/classes/${fixture.classId}`);
  const classDeletion = await deletedClass.json();
  expect(deletedClass.status(), JSON.stringify(classDeletion)).toBe(200);
  expect(classDeletion).toMatchObject({ deleted: true });
  expect(await database.courseClass.findUnique({ where: { id: fixture.classId } })).toBeNull();
  expect(
    await database.episode.findUnique({ where: { id: classListening.episodeId! } })
  ).toBeNull();
  await expect(stat(classListeningPath)).rejects.toMatchObject({ code: 'ENOENT' });
  for (const path of audioPaths) await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  const deleted = await page.request.delete(`/api/v1/courses/${fixture.courseId}`, {
    data: { confirm: 'de' },
  });
  const deletion = await deleted.json();
  expect(deleted.status(), JSON.stringify(deletion)).toBe(200);
  expect(deletion).toMatchObject({ deleted: true, filesFailed: 0, cleanupPendingJobs: 0 });
  expect(await database.course.findUnique({ where: { id: fixture.courseId } })).toBeNull();
  expect(await database.sidedoorState.findUnique({ where: { id: claimId } })).toBeNull();
  expect(
    await database.episode.findUnique({ where: { id: assessmentAudio.episodeId! } })
  ).toBeNull();
  for (const path of audioPaths) await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
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
  await page.getByRole('button', { name: /^Resume Full catch-up, Started .* practice$/ }).click();
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
    await expect
      .poll(async () => {
        const bounds = await grammar
          .getByRole('button', { name: 'Option 1: gesehen' })
          .boundingBox();
        return (
          bounds !== null && bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width
        );
      })
      .toBe(true);
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
