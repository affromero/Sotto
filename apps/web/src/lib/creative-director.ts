/**
 * Creative Director — designs the narrative structure for a episode episode.
 *
 * Given a research dossier, selects a narrative framework, produces a
 * beat sheet with evidence assignments, tension curve, and speaker roles.
 */

import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { minutesToWords } from './duration';
import { logger } from './logger';
import type { SourceRecord, EvidenceCard } from './research-agent';

// ---- Types ----

export interface Beat {
  beatId: string;
  purpose: 'hook' | 'setup' | 'turn' | 'deepen' | 'counterpoint' | 'payoff';
  summary: string;
  evidenceIds: string[];
  requiredSourceIds: string[];
  speaker: string;
  targetDurationSeconds: number;
  tone: string;
  narrativeNote?: string;
}

export interface OutlineResult {
  drivingQuestion: string;
  listenerPromise: string;
  thesis: string;
  narrativeFramework: string;
  speakerRoles: Array<{ speaker: string; role: string }>;
  beats: Beat[];
  tensionCurve: Array<{ beatOrder: number; tension: number }>;
  bannedAngles: string[];
  unresolvedQuestions: string[];
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface CreateOutlineParams {
  topic: string;
  depth: string;
  tone: string;
  audience: string;
  audienceLevel: string;
  durationTarget: number;
  speakers: Array<{ name: string; description: string }>;
  sources: SourceRecord[];
  evidence: EvidenceCard[];
  recommendedAngle: string | null;
  apiKeyOverride?: string;
  model?: string;
  provider: string;
}

// ---- Framework Selection ----

const FRAMEWORKS: Record<string, { name: string; instructions: string }> = {
  anecdote_reflection: {
    name: 'Anecdote + Reflection (Ira Glass)',
    instructions: `Alternate between ANECDOTE beats (sequences of causally-linked actions that create forward motion — "this happened, then that led to this") and REFLECTION beats (someone explains why it matters, the bigger idea). The anecdote is a train with a destination; the reflection delivers the payoff. Every reflection should raise a new question that propels the next anecdote.`,
  },
  question_cascade: {
    name: 'Question Cascade (Socratic)',
    instructions: `Structure as a cascade of increasingly specific questions. Start with a big, open question (the hook). Each beat answers the previous question but reveals a deeper one. The expert guides, but the host asks the questions the audience is thinking. End by circling back to the opening question with a richer answer than anyone expected.`,
  },
  problem_solution: {
    name: 'Problem-Solution (Professional)',
    instructions: `Open with a problem that the audience recognizes. Build credibility with evidence. Introduce the solution framework. Deepen with specific evidence and case studies. Address counterarguments head-on. Close with actionable takeaways. Maintain a steady, authoritative pace — the tension comes from the complexity of the problem, not from surprise.`,
  },
  editorial_comedy: {
    name: 'Editorial Comedy (John Oliver)',
    instructions: `Open with a ridiculous or absurd hook that signals this will be fun. Establish the real problem underneath the absurdity. Use evidence for comedic effect — the funnier the statistic, the harder it hits. Include callbacks to earlier jokes. Build to a rant-style payoff that combines genuine outrage with humor. The expert plays straight, the host plays for laughs.`,
  },
  storytelling: {
    name: 'Narrative Storytelling',
    instructions: `Structure as a story with a clear beginning, middle, and end. Identify a protagonist (person, idea, or movement). Build rising action through complications and obstacles. Use evidence as scenes, not as citations. The turn should be a genuine surprise — something the listener didn't see coming. End with resolution that transforms how the listener sees the topic.`,
  },
};

function selectFramework(tone: string): string {
  switch (tone) {
    case 'socratic': return 'question_cascade';
    case 'professional': return 'problem_solution';
    case 'comedic':
    case 'satirical': return 'editorial_comedy';
    case 'storytelling': return 'storytelling';
    case 'casual':
    default: return 'anecdote_reflection';
  }
}

function extractFirstJson(text: string): string {
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch { /* continue */ }
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('Unbalanced JSON in response');
}

// ---- Main Entry Point ----

export async function createCreativeOutline(params: CreateOutlineParams): Promise<OutlineResult> {
  const frameworkKey = selectFramework(params.tone);
  const framework = FRAMEWORKS[frameworkKey];
  const wordCount = minutesToWords(params.durationTarget);

  logger.info('Creative director: building outline', {
    topic: params.topic,
    framework: frameworkKey,
    durationMinutes: params.durationTarget,
  });

  const systemPrompt = loadAndRender('planning/creative-outline.md', {
    TOPIC: params.topic,
    TONE: params.tone,
    DURATION_MINUTES: String(params.durationTarget),
    WORD_COUNT: String(wordCount),
    SPEAKERS_JSON: JSON.stringify(params.speakers, null, 2),
    AUDIENCE_LEVEL: params.audienceLevel,
    SOURCE_COUNT: String(params.sources.length),
    EVIDENCE_COUNT: String(params.evidence.length),
    RECOMMENDED_ANGLE: params.recommendedAngle || 'No specific angle recommended — choose the most compelling one',
    EVIDENCE_JSON: JSON.stringify(params.evidence.map(e => ({
      evidenceId: e.evidenceId,
      claim: e.claim,
      claimType: e.claimType,
      sourceIds: e.sourceIds,
      confidence: e.confidence,
      freshness: e.freshness,
    })), null, 2),
    FRAMEWORK: framework.name,
    FRAMEWORK_INSTRUCTIONS: framework.instructions,
  });

  const ai = createAIProvider(params.provider);
  const response = await ai.generateResponse(systemPrompt, [
    { role: 'user', content: `Design the episode structure for a ${params.durationTarget}-minute ${params.tone} lesson about: ${params.topic}` },
  ], {
    maxTokens: 6144,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
  });

  const data = JSON.parse(extractFirstJson(response.content));

  const beats: Beat[] = (data.beats || []).map((b: Record<string, unknown>, i: number) => ({
    beatId: (b.beatId as string) || `beat_${i + 1}`,
    purpose: (b.purpose as string) || 'setup',
    summary: (b.summary as string) || '',
    evidenceIds: (b.evidenceIds as string[]) || [],
    requiredSourceIds: (b.requiredSourceIds as string[]) || [],
    speaker: (b.speaker as string) || 'Host',
    targetDurationSeconds: (b.targetDurationSeconds as number) || 60,
    tone: (b.tone as string) || params.tone,
    narrativeNote: (b.narrativeNote as string) || undefined,
  }));

  return {
    drivingQuestion: data.drivingQuestion || '',
    listenerPromise: data.listenerPromise || '',
    thesis: data.thesis || '',
    narrativeFramework: frameworkKey,
    speakerRoles: data.speakerRoles || params.speakers.map(s => ({ speaker: s.name, role: s.description })),
    beats,
    tensionCurve: data.tensionCurve || [],
    bannedAngles: data.bannedAngles || [],
    unresolvedQuestions: data.unresolvedQuestions || [],
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    model: response.model,
  };
}
