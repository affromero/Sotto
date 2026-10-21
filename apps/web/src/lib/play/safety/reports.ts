import {
  playPageQuerySchema,
  playReportEvidenceSchema,
  playReportListSchema,
  playReportViewSchema,
  reportPlayContentSchema,
  type PlayReportSelector,
} from '@sotto/shared';
import type { PlaySafetyReport, Prisma } from '@/generated/prisma/client';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { projectPlayRound } from '../projection';
import { requirePlaySeat, type StoredPlayRoom } from '../storage/room-view';
import type { PlayActor, PlayClock } from '../storage/rooms';
import { lockPlaySafetyParticipants } from './fences';
import { PlaySafetyError, redactPlayPublishedName } from './policy';
import { mutatePlaySafety } from './receipts';
import { loadPlaySafetyParticipantRoom } from './participant-room';

export function playSafetyReportView(row: PlaySafetyReport) {
  return playReportViewSchema.parse({
    id: row.id,
    roomId: row.roomId,
    category: row.category,
    detail: row.detail,
    evidence: row.evidence,
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    response: row.response,
    respondedAt: row.respondedAt?.toISOString() ?? null,
  });
}

/** Only one selected, other-authored field from the reporter's actual view is evidence. */
export function selectPlayReportEvidence(
  room: StoredPlayRoom,
  userId: string,
  selector: PlayReportSelector
) {
  const seat = requirePlaySeat(room, userId);
  const other = seat === 'HOST' ? room.guest : room.host;
  if (!other) throw new PlaySafetyError('PLAY_UNAVAILABLE', 'Partner unavailable.');
  if (selector.kind === 'PARTNER_NAME')
    return {
      subjectUserId: other.id,
      evidence: playReportEvidenceSchema.parse({
        selector,
        text: redactPlayPublishedName(other.name),
      }),
    };
  const stored = room.rounds.find((round) => round.id === selector.roundId);
  if (!stored || (room.status !== 'COMPLETED' && stored.order > room.currentRound))
    throw new PlaySafetyError('CONTENT_CHANGED', 'Select content visible in your game.');
  const round = projectPlayRound(stored.privateState, seat);
  let text: string | null = null;
  if (selector.field === 'HINT') {
    const message = round.hints[selector.index!];
    if (message?.seat !== seat) text = message?.text ?? null;
  } else if (selector.field === 'CORRECTION') {
    if (seat === round.learner) text = round.result?.correction ?? null;
  } else if (round.mode === 'DESCRIBE') {
    if (selector.field === 'TARGET' && seat !== round.learner) text = round.target;
    if (selector.field === 'CLUE' && seat !== round.learner) text = round.clue;
    if (selector.field === 'GUESS' && seat === round.learner) text = round.guess;
  } else if (round.mode === 'KNOW_ME') {
    if (selector.field === 'OTHER_ANSWER' && round.questionStyle === 'OPEN')
      text = round.otherAnswer;
  } else if (selector.field === 'MESSAGE') {
    const message = round.messages[selector.index!];
    if (message?.seat !== seat) text = message?.text ?? null;
  }
  if (!text)
    throw new PlaySafetyError('CONTENT_CHANGED', 'Select visible content shared by your partner.');
  return { subjectUserId: other.id, evidence: playReportEvidenceSchema.parse({ selector, text }) };
}

export function reportPlayContent(
  actor: PlayActor,
  roomId: string,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const command = reportPlayContentSchema.parse(input);
  return mutatePlaySafety(
    actor,
    command.actionId,
    'REPORT',
    { roomId, command },
    async (database) => {
      const { room } = await loadPlaySafetyParticipantRoom(database, roomId, actor.identity.userId);
      await lockPlaySafetyParticipants(database, [room.hostUserId, room.guestUserId]);
      const selected = selectPlayReportEvidence(room, actor.identity.userId, command.selector);
      if (selected.evidence.text !== command.expectedVisibleText)
        throw new PlaySafetyError(
          'CONTENT_CHANGED',
          'The selected content changed. Check it before reporting.'
        );
      await database.playSafetyReport.create({
        data: {
          id: command.actionId,
          reporterUserId: actor.identity.userId,
          subjectUserId: selected.subjectUserId,
          roomId,
          roundId: command.selector.kind === 'ROUND_TEXT' ? command.selector.roundId : null,
          category: command.category,
          detail: command.detail,
          evidence: selected.evidence,
          createdAt: clock(),
        },
      });
    }
  );
}

export async function pagePlaySafetyReports(
  database: Prisma.TransactionClient,
  where: Prisma.PlaySafetyReportWhereInput,
  query: ReturnType<typeof playPageQuerySchema.parse>
) {
  if (
    query.beforeId &&
    !(await database.playSafetyReport.findFirst({ where: { ...where, id: query.beforeId } }))
  )
    throw new PlaySafetyError('PLAY_UNAVAILABLE', 'Report page unavailable.');
  const rows = await database.playSafetyReport.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.beforeId ? { cursor: { id: query.beforeId }, skip: 1 } : {}),
  });
  return { page: rows.slice(0, query.limit), more: rows.length > query.limit };
}

export function listOwnPlayReports(actor: PlayActor, input: unknown = {}) {
  const query = playPageQuerySchema.parse(input);
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    const { page, more } = await pagePlaySafetyReports(
      database,
      { reporterUserId: actor.identity.userId },
      query
    );
    return playReportListSchema.parse({
      reports: page.map(playSafetyReportView),
      nextCursor: more ? page.at(-1)!.id : null,
    });
  });
}
