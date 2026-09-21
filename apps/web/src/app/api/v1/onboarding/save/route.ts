import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prismaUnfiltered } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { AccessError, isAccessError } from 'thesidedoor-core/access';
import { readAccessJson } from 'thesidedoor-core/access/http';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { validateSottoCredentialSelection } from '@/lib/sidedoor/credentials/config/credential-selection';
import { onboardingSaveSchema } from '@/lib/validations';
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';
import { setCourseNote } from '@/lib/course-notes';
import { setSiteConfig } from '@/lib/site-config';
import { invalidateServerInfra } from '@/lib/server-config';
import { isSelfHosted } from '@/lib/self-hosted';
import { errorResponse } from '@/lib/api-response';
import {
  getAutoModelConfig,
  setAutoModelConfig,
  assertModelProviderPairs,
  type ModelConfig,
} from '@/lib/auto-model-config';
import { isValidAiProviderId } from '@/lib/providers/ai-registry';
import { isValidProviderId, getProviderMeta } from '@/lib/providers/tts-registry';
import { isValidSttProviderId, getSttProviderMeta } from '@/lib/providers/stt-registry';
import { setSottoInstanceStorageCredential } from '@/lib/sidedoor/credentials/runtime/provider-credentials';

type PreferredInput = NonNullable<ReturnType<typeof onboardingSaveSchema.parse>['preferred']>;

/**
 * Build the AutoModelConfig default-model update from the wizard's preferred
 * selections. Validate registered pairs before generation; local AI and speech
 * providers with custom models keep their existing infrastructure configuration.
 */
function buildModelUpdate(preferred: PreferredInput): Partial<ModelConfig> {
  const update: Partial<ModelConfig> = {};
  const { aiProvider, aiModel, ttsProvider, ttsModel, sttProvider, sttModel } = preferred;
  if (aiProvider && !isValidAiProviderId(aiProvider))
    throw new Error('Choose a supported AI provider.');
  if (ttsProvider && !isValidProviderId(ttsProvider))
    throw new Error('Choose a supported speech provider.');
  if (sttProvider && !isValidSttProviderId(sttProvider))
    throw new Error('Choose a supported transcription provider.');

  if (aiProvider && aiModel && isValidAiProviderId(aiProvider) && aiProvider !== 'local') {
    update.aiProvider = aiProvider;
    update.aiModel = aiModel;
  }
  if (
    ttsProvider &&
    ttsModel &&
    isValidProviderId(ttsProvider) &&
    getProviderMeta(ttsProvider).models.length > 0
  ) {
    update.ttsProvider = ttsProvider;
    update.ttsModel = ttsModel;
  }
  if (
    sttProvider &&
    sttModel &&
    isValidSttProviderId(sttProvider) &&
    getSttProviderMeta(sttProvider).models.length > 0
  ) {
    update.sttProvider = sttProvider;
    update.sttModel = sttModel;
  }
  assertModelProviderPairs({ model: update });
  return update;
}

/**
 * POST /api/onboarding/save
 * Persist the welcome wizard's choices in one call: the learner's course
 * (language pair + placement level), context note, provider preferences, and —
 * for the owner only — server infrastructure. Marks onboarding complete.
 *
 * BYOK keys are intentionally NOT handled here; the wizard sends them through the
 * validated /api/settings/ai-keys and /api/settings/byok routes.
 *
 * On the managed showcase (`SELF_HOSTED=false`) this is a non-persisting demo: it
 * returns `{ demo: true }` and writes nothing.
 */
export async function POST(request: NextRequest) {
  if (!isSelfHosted()) return NextResponse.json({ demo: true });
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    try {
      return await save(request);
    } catch (error) {
      if (isAccessError(error) && error.code === 'conflict')
        return errorResponse(
          'Setup changed while this request was running. Reload setup and try again.',
          409
        );
      throw error;
    }
  });
}

async function save(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) throw new AccessError('unauthorized');
  const parsed = onboardingSaveSchema.safeParse(await readAccessJson(request));
  if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);
  const { course, note, preferred, infra, credentials, storageCredential } = parsed.data;
  if (course.native === course.target)
    return errorResponse('Native and target languages must differ.', 400);
  if ((infra || storageCredential) && !authed.isOwner) throw new AccessError('forbidden');
  if (
    storageCredential &&
    (infra?.storageProvider !== storageCredential.provider || !infra.objectStorageEndpoint?.trim())
  )
    return errorResponse(
      'Object storage credentials require the matching provider and endpoint.',
      400
    );
  let modelUpdate: Partial<ModelConfig>;
  try {
    modelUpdate = preferred ? buildModelUpdate(preferred) : {};
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Invalid provider selection.',
      400
    );
  }
  const writesModels = authed.isOwner && Object.keys(modelUpdate).length > 0;
  async function authorize(database: Prisma.TransactionClient) {
    const current = await resolveSottoRequest(database, request);
    if (!current || current.kind !== 'content') throw new AccessError('unauthorized');
    if (
      current.userId !== authed!.userId ||
      current.principalId !== authed!.principalId ||
      current.authentication !== authed!.authentication ||
      current.deviceId !== authed!.deviceId ||
      current.sessionId !== authed!.sessionId
    )
      throw new AccessError('conflict');
    if ((infra || storageCredential || writesModels) && !current.isOwner)
      throw new AccessError('forbidden');
    await validateSottoCredentialSelection(database, current.userId, credentials, preferred, infra);
    return current;
  }
  async function revisions(database: Prisma.TransactionClient) {
    const configurationRevision =
      infra || storageCredential || writesModels
        ? (await sidedoorStateStore(database).read()).revision
        : null;
    const learner = await database.user.findUniqueOrThrow({
      where: { id: authed!.userId },
      select: {
        hasCompletedOnboarding: true,
        ...(preferred?.language !== undefined && { preferredLanguage: true }),
        ...(preferred?.aiProvider !== undefined && { preferredAiProvider: true }),
        ...(preferred?.aiModel !== undefined && { preferredAiModel: true }),
        ...(preferred?.ttsProvider !== undefined && { preferredTtsProvider: true }),
        ...(preferred?.ttsModel !== undefined && { preferredTtsModel: true }),
      },
    });
    const existingCourse = note?.trim()
      ? await database.course.findUnique({
          where: {
            userId_nativeLang_targetLang: {
              userId: authed!.userId,
              nativeLang: course.native,
              targetLang: course.target,
            },
          },
          select: { note: { select: { body: true } } },
        })
      : null;
    return JSON.stringify({
      configurationRevision,
      learner,
      note: existingCourse?.note?.body ?? null,
    });
  }
  const expected = await sottoTransaction(prismaUnfiltered, async (database) => {
    await authorize(database);
    return revisions(database);
  });

  // Shared curriculum generation can call AI. It must never run inside a retried transaction.
  const curriculum = await getOrCreateCurriculum(
    authed.userId,
    { userId: authed.userId, authorize, signal: request.signal },
    course.native,
    course.target
  );
  const courseId = await sottoTransaction(prismaUnfiltered, async (database) => {
    const current = await authorize(database);
    if ((await revisions(database)) !== expected)
      throw new AccessError(
        'conflict',
        'Server configuration changed. Reload setup and try again.'
      );
    const created = await database.course.upsert({
      where: {
        userId_nativeLang_targetLang: {
          userId: current.userId,
          nativeLang: course.native,
          targetLang: course.target,
        },
      },
      create: {
        userId: current.userId,
        nativeLang: course.native,
        targetLang: course.target,
        curriculumId: curriculum.id,
        placementSource: 'MANUAL',
        ...(course.level && { currentLevel: course.level, startLevel: course.level }),
      },
      update: {},
      select: { id: true },
    });
    if (note?.trim()) await setCourseNote(created.id, note, database);
    await database.user.update({
      where: { id: current.userId },
      data: {
        hasCompletedOnboarding: true,
        ...(preferred?.language !== undefined && { preferredLanguage: preferred.language }),
        ...(preferred?.aiProvider !== undefined && { preferredAiProvider: preferred.aiProvider }),
        ...(preferred?.aiModel !== undefined && { preferredAiModel: preferred.aiModel }),
        ...(preferred?.ttsProvider !== undefined && {
          preferredTtsProvider: preferred.ttsProvider,
        }),
        ...(preferred?.ttsModel !== undefined && { preferredTtsModel: preferred.ttsModel }),
      },
    });
    if (infra) await setSiteConfig(infra, current.userId, database);
    if (storageCredential)
      await setSottoInstanceStorageCredential(
        database,
        storageCredential.provider,
        {
          accessKeyId: storageCredential.accessKeyId,
          secretAccessKey: storageCredential.secretAccessKey,
        },
        infra!.objectStorageEndpoint!
      );
    if (writesModels) {
      await getAutoModelConfig(database);
      await setAutoModelConfig({ model: modelUpdate }, current.userId, database);
    }
    return created.id;
  });
  if (infra) invalidateServerInfra();
  return NextResponse.json({ demo: false, courseId });
}
