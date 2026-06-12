// Generates the SPEAKING section of a class:
// 1. Resolves the AI provider (canonical BYOK flow).
// 2. Generates 4 target phrases via LLM (speaking/generate-speaking-prompts.md).
// 3. For each phrase, attempts to render reference TTS audio and upload to R2.
//    TTS failures are non-fatal — the prompt is still created with a null URL.
// 4. Creates a SPEAKING ClassSection (status READY) and SpeakingPrompt rows.
// Returns { sectionId }.
import { prisma } from './prisma';
import { resolveLearningAi } from './learning-ai';
import { formatNotesForPrompt } from './course-notes';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { canResolveTts, resolveTtsProvider, getConfiguredTtsProviderId } from './providers/tts';
import { getAutoModelConfig } from './auto-model-config';
import { uploadFile } from './r2';
import { logUsage } from './usage-logger';
import { logger } from './logger';

const SPEAKING_PROMPT_COUNT = 4;

export interface ClassSpeakingParams {
  userId: string;
  classId: string;
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
  referenceTtsUrl: string | null;
}

interface RawSpeakingPrompt {
  targetPhrase: string;
  translation: string;
  ipa?: string;
}

function isValidRawPrompt(item: unknown): item is RawSpeakingPrompt {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return typeof obj.targetPhrase === 'string' && obj.targetPhrase.trim() !== '' &&
    typeof obj.translation === 'string' && obj.translation.trim() !== '';
}

export async function composeSpeakingPrompts(
  p: SpeakingPromptsParams,
): Promise<ComposedSpeakingPrompt[]> {
  // Step 1: resolve the learning AI provider (BYOK or local agent)
  const ai = await resolveLearningAi(p.userId);

  // Step 2: generate target phrases via LLM
  const vocabList = p.targetVocab.map((v) => `${v.lemma} — ${v.gloss}`).join('\n');
  const systemPrompt = loadAndRender('speaking/generate-speaking-prompts.md', {
    COUNT: String(SPEAKING_PROMPT_COUNT),
    LEVEL: p.level,
    NATIVE: p.nativeLang,
    TARGET: p.targetLang,
    OBJECTIVE: p.objective,
    VOCAB: vocabList,
    NOTES: formatNotesForPrompt(p.note ?? ''),
  });

  const client = createAIProvider(ai.provider);
  const res = await client.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate ${SPEAKING_PROMPT_COUNT} speaking prompts.` }],
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 2048, temperature: 0.7 },
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
  const cleaned = res.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
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
  // Prefer the server-configured provider (TTS_PROVIDER) so a self-hoster on
  // TTS_PROVIDER=kokoro renders reference audio with the local sidecar; otherwise
  // fall back to the admin auto-model default.
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

  const referenceTtsUrls: (string | null)[] = [];
  for (let i = 0; i < phrases.length; i++) {
    if (!ttsAvailable || !requestedTtsProvider) {
      referenceTtsUrls.push(null);
      continue;
    }
    try {
      const { provider } = await resolveTtsProvider({
        userId: p.userId,
        episodeId: p.refId,
        requestedProvider: requestedTtsProvider as Parameters<typeof resolveTtsProvider>[0]['requestedProvider'],
        language: p.targetLang,
      });
      const voiceId = provider.getVoiceId('HOST', p.refId, undefined, p.targetLang);
      const audioBuffer = await provider.generateSpeech({
        text: phrases[i].targetPhrase,
        voiceId,
        language: p.targetLang,
      });
      const key = `speaking-ref/${p.refId}/${i}.mp3`;
      const url = await uploadFile(key, audioBuffer, 'audio/mpeg');
      referenceTtsUrls.push(url);
    } catch (err) {
      logger.warn('Reference TTS generation failed for speaking prompt', {
        refId: p.refId,
        index: String(i),
        error: err instanceof Error ? err.message : String(err),
      });
      referenceTtsUrls.push(null);
    }
  }

  // Return the composed prompts; the caller persists them (class section or practice session).
  return phrases.map((phrase, i) => ({
    targetPhrase: phrase.targetPhrase,
    translation: phrase.translation,
    ipa: phrase.ipa ?? null,
    referenceTtsUrl: referenceTtsUrls[i] ?? null,
  }));
}

// Generate the SPEAKING section of a class: compose prompts, then persist the
// gated ClassSection + SpeakingPrompt rows.
export async function generateClassSpeaking(
  p: ClassSpeakingParams,
): Promise<ClassSpeakingResult> {
  const prompts = await composeSpeakingPrompts({
    userId: p.userId,
    level: p.level,
    nativeLang: p.nativeLang,
    targetLang: p.targetLang,
    objective: p.objective,
    targetVocab: p.targetVocab,
    refId: p.classId,
    note: p.note,
  });

  const section = await prisma.classSection.create({
    data: {
      classId: p.classId,
      skill: 'SPEAKING',
      attempt: 1,
      seed: `${p.classId}-SPEAKING-1`,
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
      referenceTtsUrl: prompt.referenceTtsUrl,
    })),
  });

  logger.info('Speaking section generated', {
    classId: p.classId,
    sectionId: section.id,
    promptCount: String(prompts.length),
  });

  return { sectionId: section.id };
}
