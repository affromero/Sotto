// Generates the SPEAKING section of a class:
// 1. Resolves the AI provider (canonical BYOK flow).
// 2. Generates 4 target phrases via LLM (speaking/generate-speaking-prompts.md).
// 3. For each phrase, attempts to render reference TTS audio and upload to R2.
//    TTS failures are non-fatal — the prompt is still created with a null URL.
// 4. Creates a SPEAKING ClassSection (status READY) and SpeakingPrompt rows.
// Returns { sectionId }.
import { prisma } from './prisma';
import { getAiKey } from './byok';
import { getAiProviderMeta } from './providers/ai-registry';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { canResolveTts, resolveTtsProvider } from './providers/tts';
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
}

export interface ClassSpeakingResult {
  sectionId: string;
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

export async function generateClassSpeaking(
  p: ClassSpeakingParams,
): Promise<ClassSpeakingResult> {
  // Step 1: resolve AI key (canonical flow)
  const aiKey = await getAiKey(p.userId);
  if (!aiKey) {
    throw new Error(
      'An AI provider key (or a configured local Claude/Codex) is required to generate the speaking section.',
    );
  }
  const model = getAiProviderMeta(aiKey.provider).defaultModel;
  if (!model) {
    throw new Error(`No default AI model configured for provider "${aiKey.provider}".`);
  }

  // Step 2: generate target phrases via LLM
  const vocabList = p.targetVocab.map((v) => `${v.lemma} — ${v.gloss}`).join('\n');
  const systemPrompt = loadAndRender('speaking/generate-speaking-prompts.md', {
    COUNT: String(SPEAKING_PROMPT_COUNT),
    LEVEL: p.level,
    NATIVE: p.nativeLang,
    TARGET: p.targetLang,
    OBJECTIVE: p.objective,
    VOCAB: vocabList,
  });

  const ai = createAIProvider(aiKey.provider);
  const res = await ai.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate ${SPEAKING_PROMPT_COUNT} speaking prompts.` }],
    { model, apiKeyOverride: aiKey.apiKey, maxTokens: 2048, temperature: 0.7 },
  );

  logUsage({
    service: aiKey.provider,
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

  // Step 3: resolve TTS for reference audio (graceful degrade on failure)
  const ttsAvailable = await canResolveTts(p.userId);
  let requestedTtsProvider: string | null = null;
  if (ttsAvailable) {
    try {
      const config = await getAutoModelConfig();
      requestedTtsProvider = config.free.ttsProvider;
    } catch {
      requestedTtsProvider = null;
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
        podcastId: p.classId,
        requestedProvider: requestedTtsProvider as Parameters<typeof resolveTtsProvider>[0]['requestedProvider'],
        language: p.targetLang,
      });
      const voiceId = provider.getVoiceId('HOST', p.classId, undefined, p.targetLang);
      const audioBuffer = await provider.generateSpeech({
        text: phrases[i].targetPhrase,
        voiceId,
        language: p.targetLang,
      });
      const key = `speaking-ref/${p.classId}/${i}.mp3`;
      const url = await uploadFile(key, audioBuffer, 'audio/mpeg');
      referenceTtsUrls.push(url);
    } catch (err) {
      logger.warn('Reference TTS generation failed for speaking prompt', {
        classId: p.classId,
        index: String(i),
        error: err instanceof Error ? err.message : String(err),
      });
      referenceTtsUrls.push(null);
    }
  }

  // Step 4: create ClassSection and SpeakingPrompt rows
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
    data: phrases.map((phrase, i) => ({
      sectionId: section.id,
      order: i + 1,
      targetPhrase: phrase.targetPhrase,
      translation: phrase.translation,
      ipa: phrase.ipa ?? null,
      referenceTtsUrl: referenceTtsUrls[i] ?? null,
    })),
  });

  logger.info('Speaking section generated', {
    classId: p.classId,
    sectionId: section.id,
    promptCount: String(phrases.length),
  });

  return { sectionId: section.id };
}
