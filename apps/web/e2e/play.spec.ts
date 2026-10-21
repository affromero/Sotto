import { expect, test, type Page } from '@playwright/test';
import { playRoomViewSchema } from '@sotto/shared';

async function gameView(page: Page, roomId: string) {
  const response = await page.request.get(`/api/v1/play/rooms/${encodeURIComponent(roomId)}`);
  expect(response.status()).toBe(200);
  return playRoomViewSchema.parse(await response.json());
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('two learners play all six rounds, keep private phrases and discover the same rematch', async ({
  page: host,
  browser,
}) => {
  test.setTimeout(240_000);
  const guestBrowser = await browser.browserType().launch();
  const guest = await guestBrowser.newPage({
    baseURL: process.env.NEXT_PUBLIC_APP_URL,
    viewport: { width: 375, height: 812 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const errors: string[] = [];
  host.on('pageerror', (error) => errors.push(error.message));
  guest.on('pageerror', (error) => errors.push(error.message));
  try {
    await host.setViewportSize({ width: 375, height: 812 });
    await host.goto('/access');
    await host.getByLabel(/password/i).fill('browser test household password');
    await host.getByRole('button', { name: 'Continue', exact: true }).click();
    await host.getByRole('button', { name: /Browser learner/ }).click();
    await expect(host).toHaveURL(/\/(welcome|dashboard|learn)$/);
    await host.goto('/play/safety');
    const conduct = host.getByRole('checkbox', { name: /I accept this server/ });
    await expect(conduct).not.toBeChecked();
    await expect(host.getByRole('button', { name: 'Accept game conduct' })).toBeDisabled();
    await conduct.check();
    await host.getByRole('button', { name: 'Accept game conduct' }).click();
    await expect(host.getByText('Conduct accepted for this profile.')).toBeVisible();
    await host.goto('/play');
    await host.getByLabel('What are you in the mood for?').selectOption('FOOD');
    await host.getByRole('button', { name: 'Make a game for two' }).click();
    await expect(host).toHaveURL(/\/play\/rooms\//);
    const roomId = new URL(host.url()).pathname.split('/').at(-1)!;
    const invitation = host.getByLabel('Invitation link');
    await expect(invitation).toHaveValue(/\/play\/join\?v=1&code=/);
    const link = await invitation.inputValue();
    await expect(host.getByRole('img', { name: /Scan to open/ })).toBeVisible();
    await noHorizontalOverflow(host);

    // The host deliberately leaves the game before the newcomer requests admission.
    await host.goto('/play');
    await guest.goto(link);
    await expect(guest.getByText('Your host needs to return before you can enter.')).toBeVisible();
    await expect(guest.getByLabel('What should your partner call you?')).toBeDisabled();
    await guest.getByRole('checkbox', { name: /I accept this server/ }).check();
    await guest.getByLabel('What should your partner call you?').fill('Partner browser');
    await guest.getByLabel(/Create a persistent profile for me/).check();
    await guest.getByLabel('Language to practice').selectOption('es');
    await guest.getByLabel('Your comfort level').selectOption('B1');
    await guest.getByRole('button', { name: 'Ask to join', exact: true }).click();
    await expect(guest.getByText(/server owner needs to approve/)).toBeVisible();
    expect((await guest.request.get(`/api/v1/play/rooms/${roomId}`)).status()).toBe(401);
    await host.goto(`/play/rooms/${roomId}`);
    await expect(host.getByText('You’re here and waiting.')).toBeVisible();
    await host.getByRole('button', { name: 'Approve profile and let in' }).click();
    await expect(guest).toHaveURL(new RegExp(`/play/rooms/${roomId}$`));
    await expect(guest.getByText('You are in. Your host can start the game.')).toBeVisible();
    const newProfile = (await gameView(guest, roomId)).guest!;
    expect(newProfile.settings).toEqual({ nativeLang: 'en', targetLang: 'es', level: 'B1' });
    const forbiddenEnrollment = await guest.request.post('/api/v1/profiles', {
      headers: { origin: process.env.NEXT_PUBLIC_APP_URL! },
      data: { name: 'Unapproved third learner' },
    });
    expect(forbiddenEnrollment.status()).toBe(403);
    await host.getByRole('button', { name: 'Start playing' }).click();

    for (let index = 0; index < 6; index++) {
      const learner = index % 2 === 0 ? host : guest;
      const partner = index % 2 === 0 ? guest : host;
      const language = index % 2 === 0 ? 'DE · A1' : 'ES · B1';
      await expect(learner.getByText(new RegExp(`${language} · Your language turn`))).toBeVisible();
      if (index < 2) {
        const options = learner.getByRole('region', { name: 'Pick & predict' }).getByRole('button');
        await options.filter({ hasText: /^A/ }).first().click();
        await expect(learner.getByText(/Your pick is locked/)).toBeVisible();
        const privateView = (await gameView(partner, roomId)).round;
        expect(privateView).toMatchObject({
          mode: 'KNOW_ME',
          otherAnswer: null,
          ownAnswer: null,
          otherCommitted: true,
        });
        await partner
          .getByRole('region', { name: 'Pick & predict' })
          .getByRole('button')
          .filter({ hasText: /^A/ })
          .first()
          .click();
        await expect(learner.getByText('You picked the same card!')).toBeVisible();
      } else if (index < 4) {
        const target = index === 2 ? 'Känguru' : 'jirafa';
        await learner.getByLabel('Your secret word or phrase').fill(target);
        await learner.getByRole('button', { name: 'Keep this secret' }).click();
        expect(JSON.stringify(await gameView(partner, roomId))).not.toContain(target);
        await learner
          .getByLabel('One clue, without saying the word')
          .fill(index === 2 ? 'Es lebt in Australien.' : 'Tiene un cuello largo.');
        await learner.getByRole('button', { name: 'Send clue' }).click();
        await partner.getByLabel('Your guess').fill(target);
        await partner.getByRole('button', { name: 'Make a guess' }).click();
        await partner.getByRole('button', { name: 'Yes, understood', exact: true }).click();
        await expect(learner.getByText('You understood each other.')).toBeVisible();
        await learner.getByText('Keep a word or sentence', { exact: true }).click();
        await learner.getByLabel('Choose visible text').selectOption({ label: target });
        await learner.getByRole('combobox', { name: 'Save as', exact: true }).selectOption('WORD');
        await learner.getByRole('button', { name: 'Save to notebook' }).click();
        await expect(learner.getByText('Saved to your private notebook.')).toBeVisible();
      } else {
        const learnerView = (await gameView(learner, roomId)).round;
        const partnerView = (await gameView(partner, roomId)).round;
        expect(learnerView).toMatchObject({ mode: 'MISSION', otherObjective: null, twist: null });
        expect(partnerView).toMatchObject({ mode: 'MISSION', otherObjective: null, twist: null });
        for (let message = 0; message < 4; message++) {
          const speaker = message % 2 === 0 ? learner : partner;
          if (message > 0)
            await expect(
              speaker
                .getByRole('region', { name: 'Secret mission' })
                .getByText(`Mensaje ${message}: vamos juntos.`, { exact: true })
            ).toBeVisible();
          await speaker.getByLabel('Your next line').fill(`Mensaje ${message + 1}: vamos juntos.`);
          await speaker.getByRole('button', { name: 'Send line' }).click();
          await expect
            .poll(async () => {
              const round = (await gameView(speaker, roomId)).round;
              return round?.mode === 'MISSION' ? round.messages.length : 0;
            })
            .toBe(message + 1);
        }
        await expect(learner.getByText('Plot twist', { exact: true })).toBeVisible();
        await expect(partner.getByText('Plot twist', { exact: true })).toBeVisible();
        await learner.getByRole('button', { name: 'Yes, got it' }).click();
        await partner.getByRole('button', { name: 'Yes, got it' }).click();
        await partner.getByRole('button', { name: 'Yes, understood', exact: true }).click();
        await expect(learner.getByText('You understood each other.')).toBeVisible();
      }
      await noHorizontalOverflow(host);
      await noHorizontalOverflow(guest);
      await host
        .getByRole('button', { name: index === 5 ? 'See your recap' : 'Next round. Swap turns.' })
        .click();
    }
    await expect(host.getByRole('heading', { name: 'That was your game.' })).toBeVisible();
    await expect(guest.getByRole('heading', { name: 'That was your game.' })).toBeVisible();
    expect((await gameView(host, roomId)).points).toBe(12);
    const hostNotebook = await (await host.request.get('/api/v1/play/phrases')).json();
    const guestNotebook = await (await guest.request.get('/api/v1/play/phrases')).json();
    expect(hostNotebook.phrases.map((item: { text: string }) => item.text)).toEqual(['Känguru']);
    expect(guestNotebook.phrases.map((item: { text: string }) => item.text)).toEqual(['jirafa']);
    await host.screenshot({ path: '/tmp/sotto-play-recap-375.png', fullPage: true });
    await guest.screenshot({ path: '/tmp/sotto-play-recap-dark-375.png', fullPage: true });
    await host.getByRole('button', { name: 'Play another together' }).click();
    await expect(host).not.toHaveURL(new RegExp(`/play/rooms/${roomId}$`));
    const successor = new URL(host.url()).pathname;
    const follow = guest.getByRole('link', { name: 'Your next game is ready' });
    await expect(follow).toHaveAttribute('href', successor);
    await follow.click();
    await expect(guest).toHaveURL(new RegExp(`${successor}$`));
    await guest.getByRole('button', { name: 'Report or block partner' }).click();
    await guest.getByRole('button', { name: 'Block partner', exact: true }).click();
    await guest.getByRole('button', { name: 'Confirm block partner' }).click();
    await expect(guest.getByText('Partner blocked.', { exact: true })).toBeVisible();
    await guest.getByLabel('Explanation (optional)').fill('Please review this test player name.');
    await guest.getByRole('button', { name: 'Send report to server owner' }).click();
    await expect(guest.getByText(/Report sent to this server/)).toBeVisible();
    await noHorizontalOverflow(guest);
    await guest.getByRole('link', { name: 'Blocks and report responses' }).click();
    await expect(guest.getByRole('heading', { name: 'Your blocked players' })).toBeVisible();
    await guest.screenshot({ path: '/tmp/sotto-game-safety-dark-375.png', fullPage: true });
    await host.goto('/play/safety/review');
    await host.getByRole('combobox', { name: 'Action', exact: true }).selectOption('DISMISS');
    const response = 'I have reviewed this report. Your block stays in place.';
    await host.getByRole('textbox', { name: 'Response to the reporting player' }).fill(response);
    await host.getByRole('button', { name: 'Review decision' }).click();
    await host.getByRole('button', { name: 'Confirm decision' }).click();
    await expect(guest.getByText(response, { exact: true })).toBeVisible();
    await noHorizontalOverflow(host);
    await noHorizontalOverflow(guest);
    await host.screenshot({ path: '/tmp/sotto-game-owner-review-375.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await guestBrowser.close();
  }
});
