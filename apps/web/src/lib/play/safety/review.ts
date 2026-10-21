import {
  playReportReviewListSchema,
  playReportReviewQuerySchema,
  reviewPlayReportSchema,
} from '@sotto/shared';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { playSponsoringOwner } from '../admission/authority';
import type { PlayActor, PlayClock } from '../storage/rooms';
import { cancelPlayRoomForSafety, cancelRestrictedPlay } from './cancellation';
import { lockPlaySafetyParticipants } from './fences';
import { assertPlaySharedTextAllowed, PlaySafetyError, redactPlayPublishedName } from './policy';
import { mutatePlaySafety } from './receipts';
import { pagePlaySafetyReports, playSafetyReportView } from './reports';

export function listReviewPlayReports(actor: PlayActor, input: unknown = {}) {
  const query = playReportReviewQuerySchema.parse(input);
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    await playSponsoringOwner(database, actor);
    const { page, more } = await pagePlaySafetyReports(
      database,
      query.status ? { status: query.status } : {},
      query
    );
    const ids = page.flatMap((row) => [row.reporterUserId, row.subjectUserId]);
    const states = await lockPlaySafetyParticipants(database, ids);
    const users = await database.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return playReportReviewListSchema.parse({
      reports: page.map((row) => ({
        ...playSafetyReportView(row),
        reporter: {
          id: row.reporterUserId,
          name: redactPlayPublishedName(users.find((user) => user.id === row.reporterUserId)?.name),
        },
        subject: {
          id: row.subjectUserId,
          name: redactPlayPublishedName(users.find((user) => user.id === row.subjectUserId)?.name),
        },
        subjectRestricted: !!states.find((state) => state.userId === row.subjectUserId)
          ?.sharingRestrictedAt,
        allowedActions: [
          'RESPOND',
          'DISMISS',
          ...(row.roomId ? ['CLOSE_ROOM'] : []),
          states.find((state) => state.userId === row.subjectUserId)?.sharingRestrictedAt
            ? 'RESTORE_PLAY'
            : 'RESTRICT_PLAY',
        ],
      })),
      nextCursor: more ? page.at(-1)!.id : null,
    });
  });
}

export function reviewPlayReport(
  actor: PlayActor,
  reportId: string,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const command = reviewPlayReportSchema.parse(input);
  return mutatePlaySafety(
    actor,
    command.actionId,
    'REVIEW',
    { reportId, command },
    async (database) => {
      const ownerId = await playSponsoringOwner(database, actor);
      const report = await database.playSafetyReport.findUnique({ where: { id: reportId } });
      if (!report) throw new PlaySafetyError('PLAY_UNAVAILABLE', 'Report unavailable.');
      assertPlaySharedTextAllowed(command.response);
      // CLOSE_ROOM also fences both actual players before acquiring its room write lock.
      const room = report.roomId
        ? await database.playRoom.findUnique({ where: { id: report.roomId } })
        : null;
      await lockPlaySafetyParticipants(database, [
        report.subjectUserId,
        report.reporterUserId,
        room?.hostUserId,
        room?.guestUserId,
      ]);
      if (command.action === 'CLOSE_ROOM' && !room)
        throw new PlaySafetyError('PLAY_UNAVAILABLE', 'Game unavailable.');
      const changed = await database.playSafetyReport.updateMany({
        where: { id: reportId, revision: command.expectedRevision },
        data: {
          revision: { increment: 1 },
          status: 'RESOLVED',
          reviewAction: command.action,
          response: command.response,
          respondedAt: clock(),
          responderUserId: ownerId,
        },
      });
      if (changed.count !== 1)
        throw new PlaySafetyError(
          'SAFETY_CONFLICT',
          'The report changed. Refresh before reviewing.'
        );
      if (command.action === 'CLOSE_ROOM') await cancelPlayRoomForSafety(database, room!.id);
      if (command.action === 'RESTRICT_PLAY' || command.action === 'RESTORE_PLAY') {
        await database.playSafetyState.update({
          where: { userId: report.subjectUserId },
          data: {
            sharingRestrictedAt: command.action === 'RESTRICT_PLAY' ? clock() : null,
            revision: { increment: 1 },
          },
        });
        if (command.action === 'RESTRICT_PLAY')
          await cancelRestrictedPlay(database, report.subjectUserId);
      }
    },
    (database) => playSponsoringOwner(database, actor)
  );
}
