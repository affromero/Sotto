import { test, expect } from '@playwright/test';
import { prismaUnfiltered as database } from '@/lib/prisma';
import { setSiteConfig } from '@/lib/site-config';

const entries = [
  ['Bahnhof', 'station'],
  ['Fahrkarte', 'ticket'],
  ['Bäckerei', 'bakery'],
  ['Rechnung', 'bill'],
  ['Wohnung', 'apartment'],
  ['Schlüssel', 'key'],
  ['Fenster', 'window'],
  ['Treppe', 'stairs'],
  ['Wetter', 'weather'],
  ['Wolke', 'cloud'],
  ['Sonne', 'sun'],
  ['Regen', 'rain'],
  ['Termin', 'appointment'],
  ['Freundschaft', 'friendship'],
  ['Weltanschauung', 'worldview'],
];
test.afterAll(async () => database.$disconnect());

test('uploaded words flow through the dictionary, local pronunciation, study, and assessed recall', async ({
  page,
}) => {
  const user = await database.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  await database.user.update({
    where: { id: user.id },
    data: {
      hasCompletedOnboarding: true,
      showAgentUsageStatus: false,
      preferredAiProvider: 'local',
      preferredAiModel: 'local:browser-fixture',
      preferredTtsProvider: 'local',
      preferredTtsModel: 'local',
    },
  });
  await setSiteConfig(
    {
      ttsProvider: 'local',
      ttsBaseUrl: process.env.SOTTO_BROWSER_PROVIDER!,
      ttsVoices: 'fixture-voice',
      aiProvider: 'local',
      aiModel: 'browser-fixture',
      aiBaseUrl: `${process.env.SOTTO_BROWSER_PROVIDER}/v1`,
    },
    user.id
  );
  const curriculum = await database.curriculum.upsert({
    where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
    create: { nativeLang: 'en', targetLang: 'de', title: 'German vocabulary browser' },
    update: { title: 'German vocabulary browser' },
  });
  const course = await database.course.upsert({
    where: {
      userId_nativeLang_targetLang: { userId: user.id, nativeLang: 'en', targetLang: 'de' },
    },
    create: {
      userId: user.id,
      curriculumId: curriculum.id,
      nativeLang: 'en',
      targetLang: 'de',
      vocabularySupport: 'MEANING_RECALL',
    },
    update: { vocabularySupport: 'MEANING_RECALL' },
  });
  await database.learnerVocab.upsert({
    where: { courseId_lemma: { courseId: course.id, lemma: 'Gedächtnis' } },
    create: {
      courseId: course.id,
      lemma: 'Gedächtnis',
      translation: 'memory',
      mastery: 0.005,
      reps: 1,
      lastReviewed: new Date(),
    },
    update: { mastery: 0.005, reps: 1, lastReviewed: new Date() },
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('browser test household password');
  await page.getByRole('button', { name: /sign in|continue|enter/i }).click();
  await expect(page).toHaveURL(/\/profiles$/);
  const selected = await page.request.post('/api/v1/profiles/switch', {
    data: { profileId: user.id },
    headers: { Origin: process.env.NEXT_PUBLIC_APP_URL! },
  });
  expect(selected.status()).toBe(200);
  await page.goto('/learn');
  const card = page
    .getByRole('listitem')
    .filter({ has: page.getByText('German vocabulary browser', { exact: true }) });
  await card.getByRole('button', { name: /Course notes/ }).click();
  await card.getByLabel('Upload course note files').setInputFiles({
    name: 'Vocab Deutsch.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(entries.map(([lemma, meaning]) => `${lemma} = ${meaning}`).join('\n')),
  });
  await expect(card.getByText('Vocabulary indexing is queued.', { exact: false })).toBeVisible();
  await card.getByRole('link', { name: 'View vocabulary and import progress' }).click();
  await expect(page.getByRole('heading', { name: /Your words/ })).toBeVisible();
  await expect(page.getByText('Coverage verified', { exact: true })).toBeVisible({
    timeout: 60000,
  });
  expect(
    await database.learnerVocab.count({
      where: { courseId: course.id, lemma: { in: entries.map(([lemma]) => lemma!) } },
    })
  ).toBe(entries.length);
  const word = await database.learnerVocab.findUniqueOrThrow({
    where: { courseId_lemma: { courseId: course.id, lemma: 'Bahnhof' } },
  });
  expect(word).toMatchObject({ mastery: 0, reps: 0, lastReviewed: null, introducedAt: null });
  await page.getByRole('checkbox', { name: 'Select Bahnhof', exact: true }).check();
  await page.getByLabel('Practice mode').selectOption('FLASHCARDS');
  await page.getByRole('button', { name: 'Practice selection' }).click();
  await expect(page.getByRole('heading', { name: 'Bahnhof', exact: true })).toBeVisible();
  await expect(page.getByText('station', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('vocabulary-study-375.png') });
  await page.getByRole('button', { name: 'Play local pronunciation' }).click();
  await expect
    .poll(
      async () =>
        (await database.vocabularyPronunciation.findFirst({ where: { courseId: course.id } }))
          ?.status
    )
    .toBe('READY');
  await expect(page.getByRole('button', { name: 'Play local pronunciation' })).toBeEnabled();
  const audio = await database.vocabularyPronunciation.findFirstOrThrow({
    where: { courseId: course.id },
  });
  await page.getByRole('button', { name: 'Play local pronunciation' }).click();
  await expect(page.getByRole('button', { name: 'Play local pronunciation' })).toBeEnabled();
  expect(
    await database.vocabularyPronunciation.findUniqueOrThrow({ where: { id: audio.id } })
  ).toEqual(audio);
  await page.getByRole('button', { name: 'Reveal meaning' }).click();
  await expect(page.getByText('station', { exact: true })).toBeVisible();
  expect(await database.learnerVocab.findUniqueOrThrow({ where: { id: word.id } })).toMatchObject({
    mastery: 0,
    reps: 0,
    lastReviewed: null,
  });
  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByText(/1 word studied/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to vocabulary' }).click();
  await page.getByLabel('Practice mode').selectOption('MEANING_RECALL');
  await page.getByRole('button', { name: 'Practice selection' }).click();
  await page.getByRole('textbox', { name: 'Its meaning' }).fill('station');
  await page.getByRole('textbox', { name: 'Its meaning' }).press('Enter');
  await expect(page.getByText('Recalled', { exact: true })).toBeVisible();
  const recalled = await database.learnerVocab.findUniqueOrThrow({ where: { id: word.id } });
  expect(recalled.reps).toBe(1);
  expect(recalled.mastery).toBeGreaterThan(0);
  expect(
    await database.learnerReviewEvent.count({
      where: { vocabId: word.id, assessment: 'MEANING_RECALL' },
    })
  ).toBe(1);
  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByText(/1 of 1 recalled/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/1 of 1 recalled/)).toBeVisible();
  expect(
    await database.learnerReviewEvent.count({
      where: { vocabId: word.id, assessment: 'MEANING_RECALL' },
    })
  ).toBe(1);
  await page.getByRole('button', { name: 'Back to vocabulary' }).click();
  const reviewedWord = page.getByRole('listitem').filter({
    has: page.getByRole('checkbox', { name: 'Select Bahnhof', exact: true }),
  });
  await expect(reviewedWord.getByText('Recall estimate <1%', { exact: false })).toBeVisible();
  for (const [width, height, theme] of [
    [375, 812, 'light'],
    [812, 375, 'light'],
    [375, 812, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const practiceTitle = await page
      .getByRole('heading', { name: 'Make the meaning stick.' })
      .boundingBox();
    expect(practiceTitle?.width).toBeGreaterThanOrEqual(200);
    for (const button of await page
      .getByRole('region', { name: 'Vocabulary', exact: true })
      .getByRole('button')
      .all()) {
      if (!(await button.isVisible())) continue;
      const bounds = await button.boundingBox();
      if (bounds) expect(bounds.height, await button.innerText()).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: test.info().outputPath(`vocabulary-${width}-${height}-${theme}.png`),
      fullPage: true,
    });
    await page.screenshot({
      path: test.info().outputPath(`vocabulary-viewport-${width}-${height}-${theme}.png`),
    });
  }
});
