import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  playStoredRoundViewSchema,
  playRoomViewSchema,
  playVisibleTexts,
  type PlayGameConfig,
  type PlaySeat,
} from '@sotto/shared';
import { createPlayRounds, advancePlayRound } from '../../apps/web/src/lib/play/engine';
import { projectPlayRound } from '../../apps/web/src/lib/play/projection';
import type { PrivatePlayRound } from '../../apps/web/src/lib/play/private-state';

/** Actual personalized engine output shared by Swift, Kotlin and TS tests. */
export function nativePlayFixtures() {
  const players: PlayGameConfig['players'] = {
    HOST: { nativeLang: 'en', targetLang: 'de', level: 'A1' },
    GUEST: { nativeLang: 'en', targetLang: 'es', level: 'B1' },
  };
  const config: PlayGameConfig = { kind: 'MIXED', theme: 'EVERYDAY', players };
  const rounds: {
    name: string;
    seat: PlaySeat;
    round: ReturnType<typeof playStoredRoundViewSchema.parse>;
    visibleTexts: string[];
  }[] = [];
  function capture(name: string, value: PrivatePlayRound) {
    for (const seat of ['HOST', 'GUEST'] as const) {
      const round = playStoredRoundViewSchema.parse({
        id: `fixture-${value.mode}-${value.order}`,
        ...projectPlayRound(value, seat),
      });
      rounds.push({ name: `${name}-${seat}`, seat, round, visibleTexts: playVisibleTexts(round) });
    }
  }
  for (let round of createPlayRounds(config)) {
    capture(`initial-${round.order}`, round);
    if (round.mode === 'KNOW_ME') {
      round = advancePlayRound(round, 'HOST', { type: 'CHOOSE', optionId: 'A' });
      capture(`one-pick-${round.order}`, round);
      round = advancePlayRound(round, 'GUEST', { type: 'CHOOSE', optionId: 'A' });
    } else if (round.mode === 'DESCRIBE') {
      const partner = round.learner === 'HOST' ? 'GUEST' : 'HOST';
      round = advancePlayRound(round, round.learner, { type: 'SET_TARGET', text: 'Geheimwort' });
      round = advancePlayRound(round, round.learner, {
        type: 'GIVE_CLUE',
        text: 'Ein Tier mit langem Hals.',
      });
      capture(`clue-${round.order}`, round);
      round = advancePlayRound(round, partner, { type: 'GUESS', text: 'Giraffe' });
      capture(`guessed-${round.order}`, round);
      round = advancePlayRound(round, partner, {
        type: 'FEEDBACK',
        understood: true,
        correction: null,
      });
    } else {
      for (let index = 0; index < 4; index++) {
        round = advancePlayRound(round, index % 2 === 0 ? 'HOST' : 'GUEST', {
          type: 'MESSAGE',
          text: `Gemeinsame Zeile ${index + 1}`,
        });
        capture(`message-${index + 1}-${round.order}`, round);
      }
      const extended = advancePlayRound(round, 'HOST', {
        type: 'MESSAGE',
        text: 'Eine weitere Zeile',
      });
      capture(`message-5-${round.order}`, extended);
      round = advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: true });
      capture(`one-outcome-${round.order}`, round);
      round = advancePlayRound(round, 'GUEST', { type: 'MISSION_DONE', achieved: true });
      capture(`both-outcomes-${round.order}`, round);
      const partner = round.learner === 'HOST' ? 'GUEST' : 'HOST';
      round = advancePlayRound(round, partner, {
        type: 'FEEDBACK',
        understood: true,
        correction: null,
      });
    }
    capture(`finished-${round.order}`, round);
  }
  const rooms = (['HOST', 'GUEST'] as const).map((ownSeat) => ({
    name: `playing-${ownSeat}`,
    room: playRoomViewSchema.parse({
      id: 'fixture-room',
      status: 'PLAYING',
      revision: 4,
      rematchRoomId: null,
      kind: 'MIXED',
      theme: 'EVERYDAY',
      questionStyle: 'CHOICES',
      ownSeat,
      host: { id: 'host-profile', name: 'Alex', settings: players.HOST },
      guest: { id: 'guest-profile', name: 'Sam', settings: players.GUEST },
      hostWaiting: false,
      allowedActions: ['LEAVE', 'CANCEL'],
      round: rounds.find((entry) => entry.name === `initial-0-${ownSeat}`)!.round,
      completedRounds: [],
      points: 0,
      serverTime: '2026-10-20T12:00:00.000Z',
    }),
  }));
  return { version: 1, rounds, rooms };
}

async function main() {
  const file = resolve('packages/shared/fixtures/play/contract.json');
  const body = `${JSON.stringify(nativePlayFixtures(), null, 2)}\n`;
  if (process.argv.includes('--write')) {
    await mkdir(resolve('packages/shared/fixtures/play'), { recursive: true });
    await writeFile(file, body);
  } else if (
    JSON.stringify(JSON.parse(await readFile(file, 'utf8'))) !== JSON.stringify(JSON.parse(body))
  ) {
    throw new Error('Play native fixtures are stale. Run the exporter with --write.');
  }
}

if (process.argv[1]?.endsWith('/export-fixtures.ts')) void main();
