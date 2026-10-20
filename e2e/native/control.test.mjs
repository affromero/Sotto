import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeControl } from './control.mjs';

test('native peers exchange only an invitation and round completion over actual HTTP', async () => {
  const host = await nativeControl({ server: 'http://127.0.0.1:3000', role: 'HOST' });
  const guest = await nativeControl({ server: 'http://127.0.0.1:3000', role: 'GUEST' });
  host.link(guest);
  try {
    const post = (body) => fetch(host.url, { method: 'POST', body: JSON.stringify(body) });
    const invitation = 'http://127.0.0.1:3000/play/join?v=1&code=ABCDEFGH2345';
    assert.equal((await post({ type: 'invitation', invitation })).status, 200);
    assert.equal((await host.wait('invitation')).invitation, invitation);
    assert.equal((await post({ type: 'round', round: 3 })).status, 200);
    assert.equal((await (await fetch(guest.url)).json()).partnerRound, 3);
    assert.equal(
      (await post({ type: 'invitation', invitation: invitation.replace('3000', '4000') })).status,
      400
    );
    assert.equal((await post({ type: 'round', round: 6 })).status, 400);
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});

test('missing native events fail within their deadline and closed controllers stop waiting', async () => {
  const control = await nativeControl({ server: 'http://127.0.0.1:3000', role: 'GUEST' });
  try {
    await assert.rejects(control.wait('done', 10), /deadline/);
  } finally {
    await control.close();
  }
  await assert.rejects(control.wait('done'), /deadline/);
});
