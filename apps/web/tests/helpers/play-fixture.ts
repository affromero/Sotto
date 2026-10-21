import { randomUUID } from 'node:crypto';
import { PLAY_CONDUCT_VERSION } from '@sotto/shared';
import { acceptPlayConduct } from '@/lib/play/safety/preferences';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SharedTestIdentity, SharedTestInstance } from './setup/shared-instance';

export async function playTestActor(instance: SharedTestInstance, token: string) {
  const request = new Request('http://localhost/api/v1/play', {
    headers: { cookie: `sotto_session=${token}` },
  });
  const identity = await sottoTransaction(instance.database, (database) =>
    resolveSottoRequest(database, request)
  );
  if (identity?.kind !== 'content') throw new Error('Play fixture requires canonical admission');
  return { database: instance.database, request, identity };
}

/** Existing gameplay fixtures represent players who explicitly accepted conduct. */
export async function acceptedPlayTestIdentity(
  instance: SharedTestInstance,
  identity: SharedTestIdentity
) {
  async function accept(token: string) {
    await acceptPlayConduct(await playTestActor(instance, token), {
      actionId: randomUUID(),
      version: PLAY_CONDUCT_VERSION,
    });
  }
  await accept(identity.ownerToken);
  return {
    ...identity,
    household: async (name: string) => {
      const member = await identity.household(name);
      await accept(member.token);
      return member;
    },
  };
}
