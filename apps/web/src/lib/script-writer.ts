/**
 * Script Writer — writes episode dialogue grounded in a research dossier and creative outline.
 *
 * The writer receives pre-verified evidence and a beat sheet. It cites using
 * [[ev_ID]] placeholders which the compile step resolves to [N] footnotes.
 * No web search, no source discovery — pure dialogue writing.
 */

import { createAIProvider } from './providers/ai';
import { loadPrompt, loadAndRender } from './prompt-loader';
import { CONTENT_SAFETY_INSTRUCTIONS } from './safety-prompts';
import { VOICE_REALISM_INSTRUCTIONS } from './voice-realism-prompts';
import { wordCountBounds } from './duration';
import { parseScriptResponse, type ScriptTurn, type SoundCue, type ScriptPlace, type GeneratedReference } from './script-generator';
import { logger } from './logger';
import type { SourceRecord, EvidenceCard } from './research-agent';
import type { Beat } from './creative-director';

// ---- Types ----

export interface WriteScriptParams {
  topic: string;
  depth: string;
  tone: string;
  audience: string;
  audienceLevel: string;
  durationTarget: number;
  speakers: Array<{ name: string; description: string }>;
  dossier: {
    sources: SourceRecord[];
    evidence: EvidenceCard[];
  };
  outline: {
    drivingQuestion: string;
    listenerPromise: string;
    thesis: string;
    beats: Beat[];
  };
  apiKeyOverride?: string;
  model?: string;
  provider: string;
}

export interface WriteScriptResult {
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  places: ScriptPlace[];
  markdown: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// ---- Helpers ----

function getAudienceGuidance(audience: string): string {
  const key = audience || 'general';
  try {
    return loadPrompt(`shared/audience/${key}.md`);
  } catch {
    return '';
  }
}

// ---- Main Entry Point ----

export async function writeScript(params: WriteScriptParams): Promise<WriteScriptResult> {
  const { min: wordCountMin, max: wordCountMax } = wordCountBounds(params.durationTarget);

  logger.info('Script writer: writing dialogue from outline', {
    topic: params.topic,
    beats: params.outline.beats.length,
    evidenceCards: params.dossier.evidence.length,
  });

  const systemPrompt = loadAndRender('generation/script-from-outline.md', {
    TOPIC: params.topic,
    TONE: params.tone,
    DURATION_MINUTES: String(params.durationTarget),
    WORD_COUNT_MIN: String(wordCountMin),
    WORD_COUNT_MAX: String(wordCountMax),
    SPEAKERS_JSON: JSON.stringify(params.speakers, null, 2),
    DRIVING_QUESTION: params.outline.drivingQuestion,
    LISTENER_PROMISE: params.outline.listenerPromise,
    THESIS: params.outline.thesis,
    BEATS_JSON: JSON.stringify(params.outline.beats.map(b => ({
      beatId: b.beatId,
      purpose: b.purpose,
      summary: b.summary,
      evidenceIds: b.evidenceIds,
      speaker: b.speaker,
      targetDurationSeconds: b.targetDurationSeconds,
      tone: b.tone,
      narrativeNote: b.narrativeNote,
    })), null, 2),
    EVIDENCE_JSON: JSON.stringify(params.dossier.evidence.map(e => ({
      evidenceId: e.evidenceId,
      claim: e.claim,
      claimType: e.claimType,
      sourceIds: e.sourceIds,
      confidence: e.confidence,
    })), null, 2),
    SOURCES_JSON: JSON.stringify(params.dossier.sources.map(s => ({
      sourceId: s.sourceId,
      title: s.title,
      authors: s.authors,
      year: s.year,
      type: s.type,
    })), null, 2),
    VOICE_REALISM: VOICE_REALISM_INSTRUCTIONS,
    AUDIENCE_GUIDANCE: getAudienceGuidance(params.audience),
    CONTENT_SAFETY: CONTENT_SAFETY_INSTRUCTIONS,
  });

  const ai = createAIProvider(params.provider);
  const response = await ai.generateResponse(systemPrompt, [
    { role: 'user', content: `Write the lesson script following the outline. ${params.durationTarget} minutes, ${params.tone} tone.` },
  ], {
    maxTokens: 12288,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    // No web search — all facts come from the dossier
  });

  const result = parseScriptResponse(response);

  return {
    turns: result.turns,
    soundCues: result.soundCues,
    references: result.references,
    places: result.places,
    markdown: result.markdown,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    model: result.model,
  };
}
