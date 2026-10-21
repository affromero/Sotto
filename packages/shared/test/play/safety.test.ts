import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PLAY_CONDUCT_VERSION,
  PLAY_CONDUCT_TITLE,
  PLAY_CONDUCT_PARAGRAPHS,
  PLAY_SAFETY_HTTP_STATUS,
  acceptPendingPlayConductSchema,
  acceptPlayConductSchema,
  playBlockListSchema,
  playConsentedJoinRequestSchema,
  playPendingConductAcceptedSchema,
  playReportListSchema,
  playReportReviewListSchema,
  playReportSelectorSchema,
  playSafetyCompletedSchema,
  playSafetyErrorSchema,
  playSafetyMutationSchema,
  playSafetyPolicySchema,
  playSafetyStatusSchema,
  reportPlayContentSchema,
  requestPlayJoinSchema,
  reviewPlayReportSchema,
} from '../../src';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/play/safety.json', import.meta.url), 'utf8')
);
const actionId = fixture.completed.actionId as string;

describe('private partner safety contracts', () => {
  it('publishes the same versioned conduct and selected operator contact for every client', () => {
    const policy = playSafetyPolicySchema.parse(fixture.policy);
    expect(policy).toMatchObject({ version: PLAY_CONDUCT_VERSION, title: PLAY_CONDUCT_TITLE });
    expect(policy.paragraphs).toEqual(PLAY_CONDUCT_PARAGRAPHS);
    expect(
      playSafetyPolicySchema.parse({ ...policy, operatorContactUrl: null }).operatorContactUrl
    ).toBeNull();
    for (const operatorContactUrl of ['https://unrelated.example', 'javascript:alert(1)'])
      expect(playSafetyPolicySchema.safeParse({ ...policy, operatorContactUrl }).success).toBe(
        false
      );
  });

  it('keeps safety access and canonical profile binding independent of a Play sharing restriction', () => {
    for (const state of [fixture.unaccepted, fixture.accepted, fixture.restricted])
      expect(playSafetyStatusSchema.parse(state)).toEqual(state);
    expect(
      playSafetyStatusSchema.safeParse({ ...fixture.accepted, acceptedAt: null }).success
    ).toBe(false);
    expect(
      playSafetyStatusSchema.safeParse({
        ...fixture.unaccepted,
        acceptedAt: fixture.accepted.acceptedAt,
      }).success
    ).toBe(false);
    expect(
      playSafetyStatusSchema.safeParse({ ...fixture.accepted, blockedBy: ['private-player'] })
        .success
    ).toBe(false);
  });

  it('requires explicit current conduct for new intake while preserving legacy stored-command decoding', () => {
    const legacy = {
      requestId: actionId,
      code: 'ABCDEFGH2345',
      client: 'NATIVE',
      deviceName: 'Phone',
      candidate: {
        kind: 'NEW',
        name: 'Learner',
        settings: { nativeLang: 'en', targetLang: 'de', level: 'A1' },
        consentToProfile: true,
      },
    };
    expect(requestPlayJoinSchema.parse(legacy)).toEqual(legacy);
    expect(playConsentedJoinRequestSchema.safeParse(legacy).success).toBe(false);
    expect(
      playConsentedJoinRequestSchema.parse({
        ...legacy,
        acceptedConductVersion: PLAY_CONDUCT_VERSION,
      })
    ).toMatchObject({ acceptedConductVersion: PLAY_CONDUCT_VERSION });
    expect(
      playConsentedJoinRequestSchema.safeParse({ ...legacy, acceptedConductVersion: 0 }).success
    ).toBe(false);
    expect(acceptPlayConductSchema.parse({ actionId, version: PLAY_CONDUCT_VERSION })).toEqual({
      actionId,
      version: PLAY_CONDUCT_VERSION,
    });
    expect(
      acceptPlayConductSchema.safeParse({
        actionId,
        version: PLAY_CONDUCT_VERSION,
        userId: 'someone-else',
      }).success
    ).toBe(false);
  });

  it('retains the browser anonymous observation separately from native pending acceptance', () => {
    expect(acceptPendingPlayConductSchema.parse(fixture.browserPendingAcceptance)).toEqual({
      version: PLAY_CONDUCT_VERSION,
      expectedProfileId: null,
    });
    expect(
      acceptPendingPlayConductSchema.parse(fixture.nativePendingAcceptance)
    ).not.toHaveProperty('expectedProfileId');
    expect(
      acceptPendingPlayConductSchema.safeParse({
        version: PLAY_CONDUCT_VERSION,
        expectedProfileId: '',
      }).success
    ).toBe(false);
    expect(playPendingConductAcceptedSchema.parse(fixture.pendingAccepted).requestId).toBe(
      'fixture-request'
    );
  });

  it('accepts only bounded selectors without hidden objectives, arbitrary offenders or snapshots', () => {
    expect(reportPlayContentSchema.parse(fixture.reportRequest)).toEqual(fixture.reportRequest);
    for (const field of ['TARGET', 'CLUE', 'GUESS', 'OTHER_ANSWER', 'CORRECTION'])
      expect(
        playReportSelectorSchema.parse({ kind: 'ROUND_TEXT', roundId: 'round', field })
      ).toEqual({ kind: 'ROUND_TEXT', roundId: 'round', field });
    for (const selector of [
      { kind: 'ROUND_TEXT', roundId: 'round', field: 'OBJECTIVE' },
      { kind: 'ROUND_TEXT', roundId: 'round', field: 'MESSAGE' },
      { kind: 'ROUND_TEXT', roundId: 'round', field: 'MESSAGE', index: 6 },
      { kind: 'ROUND_TEXT', roundId: 'round', field: 'HINT', index: 3 },
      { kind: 'ROUND_TEXT', roundId: 'round', field: 'CLUE', index: 0 },
    ])
      expect(playReportSelectorSchema.safeParse(selector).success).toBe(false);
    for (const additions of [
      { offenderId: 'other' },
      { privateState: {} },
      { expectedVisibleText: 'x'.repeat(501) },
      { detail: 'x'.repeat(1001) },
    ])
      expect(
        reportPlayContentSchema.safeParse({ ...fixture.reportRequest, ...additions }).success
      ).toBe(false);
    expect(
      reportPlayContentSchema.safeParse({
        ...fixture.reportRequest,
        selector: { kind: 'PARTNER_NAME' },
        expectedVisibleText: 'x'.repeat(101),
      }).success
    ).toBe(false);
  });

  it('exposes own blocks and reports separately from bounded real-owner review metadata', () => {
    expect(playBlockListSchema.parse(fixture.blocks)).toEqual(fixture.blocks);
    const own = { reports: [fixture.report], nextCursor: null };
    expect(playReportListSchema.parse(own)).toEqual(own);
    const reviewed = { ...fixture.report, ...fixture.review };
    expect(
      playReportReviewListSchema.parse({ reports: [reviewed], nextCursor: null }).reports[0]
    ).toEqual(reviewed);
    expect(playReportListSchema.safeParse({ ...own, reports: [reviewed] }).success).toBe(false);
    for (const privateField of ['proof', 'token', 'privateState', 'notebook', 'deliveryState'])
      expect(
        playReportReviewListSchema.safeParse({
          reports: [{ ...reviewed, [privateField]: 'private' }],
          nextCursor: null,
        }).success
      ).toBe(false);
    expect(playBlockListSchema.safeParse({ ...fixture.blocks, blockedBy: [] }).success).toBe(false);
    expect(
      playBlockListSchema.safeParse({
        blocks: Array.from({ length: 51 }, () => fixture.blocks.blocks[0]),
        nextCursor: null,
      }).success
    ).toBe(false);
  });

  it('requires revision, an explicit owner response and exact idempotency for safety actions', () => {
    const review = {
      actionId,
      expectedRevision: 1,
      action: 'RESTRICT_PLAY',
      response: 'This profile cannot share in games while this is reviewed.',
    };
    expect(reviewPlayReportSchema.parse(review)).toEqual(review);
    for (const change of [
      { expectedRevision: undefined },
      { response: '' },
      { userId: 'other' },
      { actionId: 'new-action' },
    ])
      expect(reviewPlayReportSchema.safeParse({ ...review, ...change }).success).toBe(false);
    expect(playSafetyMutationSchema.parse({ actionId })).toEqual({ actionId });
    expect(playSafetyCompletedSchema.parse(fixture.completed)).toEqual(fixture.completed);
    expect(playSafetyCompletedSchema.safeParse({ ...fixture.completed, room: {} }).success).toBe(
      false
    );
  });

  it('distinguishes sharing preconditions from canonical credential revocation', () => {
    for (const entry of fixture.errors) {
      const body = playSafetyErrorSchema.parse(entry.body);
      expect(PLAY_SAFETY_HTTP_STATUS[body.reason]).toBe(entry.status);
      expect([401, 403]).not.toContain(entry.status);
    }
    expect(
      playSafetyErrorSchema.safeParse({ error: 'Unavailable', reason: 'BLOCKED_BY_SOMEONE' })
        .success
    ).toBe(false);
  });
});
