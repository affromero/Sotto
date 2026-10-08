import { NextRequest, NextResponse } from 'next/server';
import { readAccessJson } from 'thesidedoor-core/access/http';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { localSpeechSettingsSchema } from '@/lib/validations';
import { getSiteConfig, setSiteConfig } from '@/lib/site-config';
import { invalidateServerInfra } from '@/lib/server-config';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { resumeEndpoint } from '@/app/welcome/session/resume-security';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  captureSottoExecutionCredential,
  sottoExecutionCredentialFields,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import {
  createTtsProviderAsync,
  selectTtsProviderId,
  selectedTtsModel,
  isSpeechDisabled,
} from '@/lib/providers/tts';
import { getProviderMeta, isValidProviderId } from '@/lib/providers/tts-registry';
import { getDefaultModelForLanguage } from '@/lib/tts-language-support';
import { normalizeSottoLanguageCode } from '@/lib/speech-language-support';
import {
  ProviderCreditsExhaustedError,
  captureSpeechAvailability,
} from '@/lib/providers/shared/speech-availability';

async function selectedSpeechAccount(
  request: NextRequest,
  identity: NonNullable<Awaited<ReturnType<typeof authenticateRequest>>>
) {
  const execution = sottoRequestExecution(request, identity);
  return sottoTransaction(prismaUnfiltered, async (database) => {
    await execution.authorize(database);
    const user = await database.user.findUniqueOrThrow({
      where: { id: identity.userId },
      select: { preferredTtsProvider: true, preferredTtsModel: true, preferredLanguage: true },
    });
    const config = await getSiteConfig({ database });
    const configured =
      config.ttsProvider && isValidProviderId(config.ttsProvider) ? config.ttsProvider : null;
    const providerId = selectTtsProviderId(user.preferredTtsProvider, configured);
    if (!providerId)
      return {
        execution,
        providerId,
        disabled: isSpeechDisabled(user),
        captured: null,
        language: undefined,
        model: undefined,
      };
    const meta = getProviderMeta(providerId);
    if (meta.auth.fields.length === 0)
      return {
        execution,
        providerId,
        disabled: false,
        captured: null,
        language: undefined,
        model: undefined,
      };
    const course = await database.course.findFirst({
      where: { userId: identity.userId },
      orderBy: { updatedAt: 'desc' },
      select: { targetLang: true },
    });
    const language =
      normalizeSottoLanguageCode(course?.targetLang ?? user.preferredLanguage) ?? undefined;
    const preferredModel = selectedTtsModel(user, providerId);
    const model = language
      ? getDefaultModelForLanguage(providerId, language, preferredModel ?? meta.defaultModel)
      : (preferredModel ?? meta.defaultModel);
    if (!model)
      throw new Error(
        'The selected speech provider has no compatible model for your learning language.'
      );
    const captured = await captureSottoExecutionCredential(
      database,
      execution.authorize,
      'tts',
      providerId,
      true,
      request.signal
    );
    return { execution, providerId, disabled: false, captured, language, model };
  });
}

export async function GET(request: NextRequest) {
  return accessOperation(request, false, async () => {
    const identity = await authenticateRequest(request);
    if (!identity) return errorResponse('Unauthorized', 401);
    const { captured, execution, providerId, disabled } = await selectedSpeechAccount(
      request,
      identity
    );
    const availability = captured
      ? await captureSpeechAvailability({ ...execution, credential: captured })
      : null;
    const status = availability ? await availability.status() : null;
    return NextResponse.json({
      provider: providerId,
      providerLabel: providerId
        ? getProviderMeta(providerId).displayName
        : disabled
          ? 'Audio disabled'
          : 'No speech provider selected',
      creditsBlocked: status ? status.state === 'credits_exhausted' : null,
      status,
      canCheckCredits:
        availability !== null &&
        providerId !== null &&
        getProviderMeta(providerId).availabilityCheck === 'direct_audio',
    });
  });
}

export async function PATCH(request: NextRequest) {
  return accessOperation(request, true, async () => {
    const identity = await authenticateRequest(request);
    if (!identity) return errorResponse('Unauthorized', 401);

    const parsed = localSpeechSettingsSchema.safeParse(await readAccessJson(request));
    if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
    const selection = parsed.data;
    if ((selection.mode === 'local' || selection.mode === 'check-credits') && !identity.isOwner)
      return errorResponse('Forbidden', 403);
    if (selection.mode === 'check-credits') {
      const { captured, execution, providerId, language, model } = await selectedSpeechAccount(
        request,
        identity
      );
      if (providerId !== selection.expectedProvider)
        return errorResponse(
          'The selected speech provider changed. Refresh Settings before checking credits.',
          409
        );
      if (!captured || !providerId)
        return errorResponse('The selected speech provider has no paid account to check.', 400);
      if (getProviderMeta(providerId).availabilityCheck !== 'direct_audio')
        return errorResponse(
          'The selected speech provider does not support a direct audio credit check.',
          400
        );
      const availability = await captureSpeechAvailability({ ...execution, credential: captured });
      if (!availability) return errorResponse('The selected speech account is unavailable.', 400);
      const fields = sottoExecutionCredentialFields(captured);
      try {
        await availability.recheck(async () => {
          const provider = await createTtsProviderAsync(
            providerId,
            { ...execution, credential: captured },
            fields.apiKey,
            fields.extraData,
            model
          );
          return provider.generateSpeech({
            text: 'Sotto.',
            voiceId: provider.getVoiceId('HOST', undefined, undefined, language),
            language,
            signal: request.signal,
          });
        }, request.signal);
      } catch (failure) {
        if (failure instanceof ProviderCreditsExhaustedError)
          return errorResponse(failure.message, 402);
        throw failure;
      }
      return NextResponse.json({
        mode: selection.mode,
        provider: providerId,
        providerLabel: availability.providerLabel,
        creditsBlocked: false,
        status: await availability.status(),
      });
    }
    if (selection.mode === 'local' && !resumeEndpoint(selection.endpoint))
      return errorResponse(
        'Use an HTTP(S) endpoint without credentials, query parameters or fragments.',
        400
      );

    const saved = await sottoTransaction(prismaUnfiltered, async (database) => {
      request.signal.throwIfAborted();
      await requireOriginalSottoAdmission(database, request, identity);
      if (selection.mode === 'local') {
        await setSiteConfig(
          { ttsBaseUrl: selection.endpoint, ttsVoices: selection.voices.join(',') },
          identity.userId,
          database
        );
      }
      return database.user.update({
        where: { id: identity.userId },
        data: {
          preferredTtsProvider: selection.mode === 'configured' ? null : selection.mode,
          preferredTtsModel: selection.mode === 'local' ? selection.model : null,
        },
        select: { preferredTtsProvider: true, preferredTtsModel: true },
      });
    });
    invalidateServerInfra();
    return NextResponse.json({ mode: selection.mode, ...saved });
  });
}
