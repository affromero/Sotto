import assert from 'node:assert/strict';
import { expect as baseExpect } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 30_000 });

export async function webHost(browser, server) {
  const context = await browser.newContext({
    baseURL: server,
    viewport: { width: 375, height: 812 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto('/access');
  await page.getByLabel(/password/i).fill('browser test household password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Browser learner/ }).click();
  await expect(page).toHaveURL(/\/(welcome|dashboard|learn)$/);
  await page.goto('/play');
  await page.getByRole('button', { name: 'Make a game for two' }).click();
  await expect(page).toHaveURL(/\/play\/rooms\//);
  const roomID = new URL(page.url()).pathname.split('/').at(-1);
  const input = page.getByLabel('Invitation link');
  await expect(input).toHaveValue(/\/play\/join\?v=1&code=/);
  return { context, page, roomID, invitation: await input.inputValue() };
}

export async function playWithNativeGuest(host, control, directory, name) {
  const { page, roomID } = host;
  await page
    .getByRole('button', { name: 'Approve profile and let in' })
    .click({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Start playing' })).toBeEnabled({
    timeout: 120_000,
  });
  await control.wait('joined');
  await page.getByRole('button', { name: 'Start playing' }).click();
  async function view() {
    const response = await page.request.get(`/api/v1/play/rooms/${roomID}`);
    assert.equal(response.status(), 200);
    return response.json();
  }
  for (let order = 0; order < 6; order++) {
    await expect.poll(async () => (await view()).round?.order).toBe(order);
    if (order < 2) {
      await page
        .getByRole('region', { name: 'Pick & predict' })
        .getByRole('button')
        .filter({ hasText: /^A/ })
        .first()
        .click();
      await expect(page.getByText('You picked the same card!')).toBeVisible({ timeout: 30_000 });
    } else if (order < 4) {
      const target = order === 2 ? 'Brot' : 'pan';
      if (order === 2) {
        await page.getByLabel('Your secret word or phrase').fill(target);
        await page.getByRole('button', { name: 'Keep this secret' }).click();
        await page.getByLabel('One clue, without saying the word').fill('Ein Wort zum Essen.');
        await page.getByRole('button', { name: 'Send clue' }).click();
      } else {
        await page.getByLabel('Your guess').fill(target);
        await page.getByRole('button', { name: 'Make a guess' }).click();
        await page.getByRole('button', { name: 'Yes, understood', exact: true }).click();
      }
      await expect(page.getByText('You understood each other.')).toBeVisible({ timeout: 30_000 });
      if (order === 2) {
        await page.getByText('Keep a word or sentence', { exact: true }).click();
        await page.getByLabel('Choose visible text').selectOption({ label: target });
        await page.getByRole('button', { name: 'Save to notebook' }).click();
        await expect(page.getByText('Saved to your private notebook.')).toBeVisible();
      }
    } else {
      const learner = order === 4;
      if (!learner) await expect.poll(async () => (await view()).round.messages.length).toBe(1);
      for (let line = 0; line < 2; line++) {
        if (line > 0)
          await expect.poll(async () => (await view()).round.messages.length).toBe(learner ? 2 : 3);
        const preceding = line * 2 + (learner ? 0 : 1);
        await expect(
          page.getByText(`${6 - preceding} messages left between you`, { exact: true })
        ).toBeVisible();
        await page.getByLabel('Your next line').fill(`Zusammen planen wir ${line + 1}.`);
        const [sent] = await Promise.all([
          page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === `/api/v1/play/rooms/${roomID}/actions` &&
              response.request().method() === 'POST'
          ),
          page.getByRole('button', { name: 'Send line' }).click(),
        ]);
        assert.equal(sent.status(), 200, await sent.text());
        await expect
          .poll(async () => (await view()).round.messages.length)
          .toBeGreaterThanOrEqual(learner ? line * 2 + 1 : line * 2 + 2);
      }
      await expect.poll(async () => (await view()).round.messages.length).toBe(4);
      await expect(page.getByText('Plot twist', { exact: true })).toBeVisible();
      assert.equal((await view()).round.otherObjective, null);
      await page.getByRole('button', { name: 'Yes, got it' }).click();
      if (!learner)
        await page.getByRole('button', { name: 'Yes, understood', exact: true }).click();
      await expect(page.getByText('You understood each other.')).toBeVisible({ timeout: 30_000 });
    }
    control.configure({ partnerRound: order });
    await expect
      .poll(() => control.events.some((event) => event.type === 'round' && event.round === order), {
        timeout: 60_000,
      })
      .toBe(true);
    await page
      .getByRole('button', { name: order === 5 ? 'See your recap' : 'Next round. Swap turns.' })
      .click();
  }
  await expect(page.getByRole('heading', { name: 'That was your game.' })).toBeVisible();
  assert.equal((await view()).points, 12);
  const notebook = await (await page.request.get('/api/v1/play/phrases')).json();
  assert.ok(notebook.phrases.some((entry) => entry.roomId === roomID && entry.text === 'Brot'));
  assert.ok(notebook.phrases.every((entry) => entry.roomId !== roomID || entry.text !== 'pan'));
  await page.screenshot({ path: `${directory}/${name}-web-recap.png`, fullPage: true });
  await control.wait('completed');
  await page.getByRole('button', { name: 'Play another together' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/play/rooms/${roomID}$`));
  const nativeDone = await control.wait('done');
  assert.equal(nativeDone.rematchId, new URL(page.url()).pathname.split('/').at(-1));
  return { roomID, rematch: new URL(page.url()).pathname };
}
