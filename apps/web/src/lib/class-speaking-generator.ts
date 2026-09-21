// Generates the SPEAKING section of a class:
// 1. Resolves the AI provider (canonical BYOK flow).
// 2. Generates 4 target phrases via LLM (speaking/generate-speaking-prompts.md).
// 3. For each phrase, attempts to render reference TTS audio and upload to R2.
//    TTS failures are non-fatal — the prompt is still created with a null URL.
// 4. Creates a SPEAKING ClassSection (status READY) and SpeakingPrompt rows.
// Returns { sectionId }.
import { isDeepStrictEqual } from 'node:util';
import { prisma, prismaUnfiltered } from './prisma';
import { resolveCapturedLearningAi } from './learning-ai';
import { formatNotesForPrompt } from './course-notes';
import { aiProviderRules, createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { canResolveTts, resolveTtsProvider, getConfiguredTtsProviderId } from './providers/tts';
import { getAutoModelConfig } from './auto-model-config';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { classLanguagePolicy } from './classes/class-language-policy';
import {
  createSottoProviderTransport,
  type SottoProviderExecution,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { captureSpeakingPromptStorage } from '@/lib/sidedoor/storage/core/speaking-storage';

const SPEAKING_PROMPT_COUNT = 4;

export interface ClassSpeakingParams {
  execution: SottoProviderExecution;
  userId: string;
  classId: string;
  attempt?: number;
  level: string;
  nativeLang: string;
  targetLang: string;
  objective: string;
  targetVocab: Array<{ lemma: string; gloss: string }>;
  note?: string;
}

export interface ClassSpeakingResult {
  sectionId: string;
}

// Content-only speaking generation: LLM phrases + reference TTS, with no parent
// rows. `refId` namespaces the TTS audio (a class id or a practice session id).
export interface SpeakingPromptsParams {
  execution: SottoProviderExecution;
  userId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  objective: string;
  targetVocab: Array<{ lemma: string; gloss: string }>;
  refId: string;
  note?: string;
}

export interface ComposedSpeakingPrompt {
  targetPhrase: string;
  translation: string;
  ipa: string | null;
  referenceTtsAudio: Uint8Array | null;
}

interface RawSpeakingPrompt {
  targetPhrase: string;
  translation: string;
  ipa?: string;
}

function isValidRawPrompt(item: unknown): item is RawSpeakingPrompt {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.targetPhrase === 'string' &&
    obj.targetPhrase.trim() !== '' &&
    typeof obj.translation === 'string' &&
    obj.translation.trim() !== ''
  );
}

export async function composeSpeakingPrompts(
  p: SpeakingPromptsParams
): Promise<ComposedSpeakingPrompt[]> {
  // Step 1: resolve the learning AI provider (BYOK or local agent)
  const ai = await resolveCapturedLearningAi(p.userId, p.execution);

  // Step 2: generate target phrases via LLM
  const vocabList = p.targetVocab.map((v) => `${v.lemma} — ${v.gloss}`).join('\n');
  const systemPrompt = loadAndRender('speaking/generate-speaking-prompts.md', {
    COUNT: String(SPEAKING_PROMPT_COUNT),
    LEVEL: p.level,
    NATIVE: p.nativeLang,
    TARGET: p.targetLang,
    LANGUAGE_POLICY: classLanguagePolicy({
      level: p.level,
      nativeLang: p.nativeLang,
      targetLang: p.targetLang,
    }),
    OBJECTIVE: p.objective,
    VOCAB: vocabList,
    NOTES: formatNotesForPrompt(p.note ?? ''),
  });

  const client = createAIProvider(ai.provider);
  const rules = aiProviderRules(ai.provider);
  const transport = rules.length
    ? await createSottoProviderTransport(ai.execution, rules)
    : undefined;
  const res = await client.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate ${SPEAKING_PROMPT_COUNT} speaking prompts.` }],
    {
      model: ai.model,
      apiKeyOverride: ai.apiKey,
      maxTokens: 2048,
      temperature: 0.7,
      fetch: transport ? (request, init) => transport.authenticatedFetch(request, init) : undefined,
      signal: p.execution.signal,
    }
  );

  logUsage({
    service: ai.provider,
    model: res.model,
    category: 'class-speaking-prompts',
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    userId: p.userId,
  });

  // Parse JSON defensively (strip fences, filter invalid items)
  const cleaned = res.content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  let rawPrompts: unknown[];
  try {
    rawPrompts = JSON.parse(cleaned);
    if (!Array.isArray(rawPrompts)) rawPrompts = [];
  } catch (err) {
    logger.error('Failed to parse speaking-prompts LLM response', {
      error: err instanceof Error ? err.message : String(err),
    });
    rawPrompts = [];
  }

  const phrases = (rawPrompts as unknown[])
    .filter(isValidRawPrompt)
    .slice(0, SPEAKING_PROMPT_COUNT);

  if (phrases.length === 0) {
    throw new Error('Speaking prompt generation produced no usable phrases.');
  }

  // Step 3: resolve TTS for reference audio (graceful degrade on failure).
  // Prefer the saved provider so a self-hoster using Kokoro renders reference
  // audio with the local sidecar. Otherwise use the configured model default.
  const ttsAvailable = await canResolveTts(p.userId);
  let requestedTtsProvider: string | null = null;
  if (ttsAvailable) {
    const configured = getConfiguredTtsProviderId();
    if (configured) {
      requestedTtsProvider = configured;
    } else {
      try {
        const config = await getAutoModelConfig();
        requestedTtsProvider = config.model.ttsProvider;
      } catch {
        requestedTtsProvider = null;
      }
    }
  }
  const userSpeechPrefs = await prisma.user.findUnique({
    where: { id: p.userId },
    select: { preferredTtsModel: true },
  });
  const referenceTtsAudio: (Uint8Array | null)[] = [];
  for (let i = 0; i < phrases.length; i++) {
    if (!ttsAvailable || !requestedTtsProvider) {
      referenceTtsAudio.push(null);
      continue;
    }
    try {
      const { provider } = await resolveTtsProvider({
        userId: p.userId,
        execution: p.execution,
        episodeId: p.refId,
        requestedProvider: requestedTtsProvider as Parameters<
          typeof resolveTtsProvider
        >[0]['requestedProvider'],
        requestedModel: userSpeechPrefs?.preferredTtsModel ?? undefined,
        language: p.targetLang,
      });
      const voiceId = provider.getVoiceId('HOST', p.refId, undefined, p.targetLang);
      const audioBuffer = await provider.generateSpeech({
        text: phrases[i].targetPhrase,
        voiceId,
        language: p.targetLang,
      });
      referenceTtsAudio.push(audioBuffer);
    } catch (err) {
      logger.warn('Reference TTS generation failed for speaking prompt', {
        refId: p.refId,
        index: String(i),
        error: err instanceof Error ? err.message : String(err),
      });
      referenceTtsAudio.push(null);
    }
  }

  // Return the composed prompts; the caller persists them (class section or practice session).
  return phrases.map((phrase, i) => ({
    targetPhrase: phrase.targetPhrase,
    translation: phrase.translation,
    ipa: phrase.ipa ?? null,
    referenceTtsAudio: referenceTtsAudio[i] ?? null,
  }));
}

export async function publishSpeakingPromptReferences(options: {
  prompts: ReadonlyArray<{ id: string; composed: ComposedSpeakingPrompt }>;
  userId: string;
  execution: SottoProviderExecution;
}): Promise<ReadonlyMap<string, string>> {
  const references = new Map<string, string>();
  for (const { id, composed } of options.prompts) {
    if (!composed.referenceTtsAudio) continue;
    try {
      const reference = await writeStorageReference({
        database: prismaUnfiltered,
        signal: options.execution.signal ?? new AbortController().signal,
        prefix: `speaking-ref/${id}`,
        extension: 'mp3',
        body: composed.referenceTtsAudio,
        contentType: 'audio/mpeg',
        captureAdmission: async (database) => {
          const recipient = await options.execution.authorize(database);
          if (recipient.userId !== options.userId)
            throw new Error('Speaking reference recipient changed');
          const snapshot = await captureSpeakingPromptStorage(database, id);
          return {
            instanceId: snapshot.instanceId,
            scopes: snapshot.scopes,
            consumer: `speaking-prompt:${id}:reference`,
            snapshot,
          };
        },
        validateAdmission: async (database, captured, committedReference) => {
          const recipient = await options.execution.authorize(database);
          if (recipient.userId !== options.userId)
            throw new Error('Speaking reference recipient changed');
          const current = await captureSpeakingPromptStorage(database, id);
          if (committedReference) {
            if (current.reference !== committedReference)
              throw new Error('Speaking reference publication changed');
            return;
          }
          if (!isDeepStrictEqual(current, captured.snapshot))
            throw new Error('Speaking reference ownership changed');
        },
        previousReference: (snapshot) => snapshot.reference,
        commit: async (database, reference) => {
          await database.speakingPrompt.update({
            where: { id },
            data: { referenceTtsUrl: reference },
          });
        },
      });
      references.set(id, reference);
    } catch (error) {
      logger.warn('Reference TTS publication failed for speaking prompt', {
        promptId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return references;
}

// Generate the SPEAKING section of a class: compose prompts, then persist the
// gated ClassSection + SpeakingPrompt rows.
export async function generateClassSpeaking(p: ClassSpeakingParams): Promise<ClassSpeakingResult> {
  const attempt = p.attempt ?? 1;
  const prompts = await composeSpeakingPrompts({
    execution: p.execution,
    userId: p.userId,
    level: p.level,
    nativeLang: p.nativeLang,
    targetLang: p.targetLang,
    objective: p.objective,
    targetVocab: p.targetVocab,
    refId: `${p.classId}-${attempt}`,
    note: p.note,
  });

  const section = await prisma.classSection.create({
    data: {
      classId: p.classId,
      skill: 'SPEAKING',
      attempt,
      seed: `${p.classId}-SPEAKING-${attempt}`,
      spec: { objective: p.objective },
      status: 'READY',
      generatedAt: new Date(),
    },
  });

  await prisma.speakingPrompt.createMany({
    data: prompts.map((prompt, i) => ({
      sectionId: section.id,
      order: i + 1,
      targetPhrase: prompt.targetPhrase,
      translation: prompt.translation,
      ipa: prompt.ipa,
      referenceTtsUrl: null,
    })),
  });
  const savedPrompts = await prisma.speakingPrompt.findMany({
    where: { sectionId: section.id },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
  await publishSpeakingPromptReferences({
    prompts: savedPrompts.map((saved, index) => ({ id: saved.id, composed: prompts[index]! })),
    userId: p.userId,
    execution: p.execution,
  });

  logger.info('Speaking section generated', {
    classId: p.classId,
    sectionId: section.id,
    promptCount: String(prompts.length),
  });

  return { sectionId: section.id };
}
