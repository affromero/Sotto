import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { it, expect } from 'vitest';
import type { MaterialAnalysis } from '@/generated/prisma/client';
import { POST as onboarding } from '@/app/api/v1/onboarding/save/route';
import {
  captureSottoCredentialOwner,
  sottoCredentialRows,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { processMaterialAnalysis } from '@/lib/course-materials/analysis/processing';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

interface Fixture {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  courseId: string;
  admitted: (value: unknown) => Promise<{ analysisId: string }>;
  input: () => Record<string, unknown>;
  delivered: (id: string) => Promise<Job<unknown>>;
  request: (path: string, body?: unknown) => NextRequest;
  saved: (id: string) => Promise<MaterialAnalysis>;
  projection: (id: string) => Promise<Response>;
}

export function registerOnboardingMaterialReplayCase(fixture: () => Fixture) {
  it('preserves a source-bound course note generation on onboarding replay and rejects an unanalyzed note change', async () => {
    const { instance, identity, courseId, admitted, input, delivered, request, saved, projection } =
      fixture();
    const note = await instance.database.courseNote.create({
      data: { courseId, body: 'Passiv Präsens: Das Essen wird gekocht.' },
    });
    const receipt = await admitted({ ...input(), includeCourseNote: true });
    await processMaterialAnalysis(await delivered(receipt.analysisId));
    const analysis = await saved(receipt.analysisId);
    const inference = z
      .object({ inference: z.object({ level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) }) })
      .parse(JSON.parse(Buffer.from(analysis.resultBytes!).toString('utf8'))).inference;
    const credentials = await sottoTransaction(instance.database, async (database) => {
      const rows = await sottoCredentialRows(database);
      return {
        context: {
          instanceId: rows.instance.instanceId,
          owner: await captureSottoCredentialOwner(database, identity.ownerId),
        },
        selections: [],
      };
    });
    const payload = {
      credentials,
      course: { native: 'en', target: 'de', level: inference.level },
      note: note.body,
      placementAnalysis: {
        schemaVersion: 1,
        requestId: randomUUID(),
        native: 'en',
        target: 'de',
        analysisId: analysis.id,
        analysisRevision: analysis.revision,
        resultDigest: analysis.resultDigest,
        acceptPartial: false,
      },
    };
    const send = (value: unknown) => onboarding(request('onboarding/save', value));
    const learner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
      select: { hasCompletedOnboarding: true, preferredLanguage: true },
    });
    expect(
      (
        await send({
          ...payload,
          note: 'An unanalyzed replacement note.',
          preferred: { language: 'fr' },
        })
      ).status
    ).toBe(409);
    expect(await instance.database.placementConfirmationReceipt.count()).toBe(0);
    expect(
      await instance.database.user.findUniqueOrThrow({
        where: { id: identity.ownerId },
        select: { hasCompletedOnboarding: true, preferredLanguage: true },
      })
    ).toEqual(learner);
    expect((await saved(analysis.id)).acceptedReceiptId).toBeNull();
    expect((await send(payload)).status).toBe(200);
    expect((await send(payload)).status).toBe(200);
    expect(
      (await instance.database.courseNote.findUniqueOrThrow({ where: { courseId } })).updatedAt
    ).toEqual(note.updatedAt);
    expect(
      z.object({ stale: z.boolean() }).parse(await (await projection(analysis.id)).json()).stale
    ).toBe(false);
    expect(
      (await send({ ...payload, note: 'A different note that was never analyzed.' })).status
    ).toBe(409);
    expect(
      (await instance.database.courseNote.findUniqueOrThrow({ where: { courseId } })).body
    ).toBe(note.body);
    expect(await instance.database.placementConfirmationReceipt.count()).toBe(1);
  });
}
