/**
 * Maps script `direction` values to provider-specific expression parameters.
 *
 * Each TTS provider has a different API for controlling emotion and delivery:
 *   - ElevenLabs v3: inline audio tags + stability control
 *   - Cartesia Sonic 3: generation_config.emotion (60 values) + SSML
 *   - Hume Octave: description field (natural language, ≤100 chars)
 *   - OpenAI gpt-4o-mini-tts: instructions field (natural language)
 *
 * @tts-research-date 2026-02-27 — Full provider API audit
 */
import type { TtsProviderId } from './providers/tts-registry';

// ---------------------------------------------------------------------------
// Output types — per-provider expression params
// ---------------------------------------------------------------------------

export interface ElevenLabsExpression {
  /** Audio tag to prepend to text (e.g. "[excited] ") */
  audioTagPrefix?: string;
  /** Stability override: 0.0 Creative, 0.5 Natural, 1.0 Robust (v3 discrete) */
  stability?: number;
}

export interface CartesiaExpression {
  /** Emotion value for generation_config (one of 60 Sonic 3 values) */
  emotion?: string;
}

export interface HumeExpression {
  /** Acting instruction for the utterance description field (≤100 chars) */
  description: string;
}

export interface OpenAIExpression {
  /** Delivery instructions for gpt-4o-mini-tts */
  instructions: string;
}

export interface MinimaxExpression {
  /** MiniMax emotion value: happy | sad | angry | fearful | disgusted | surprised | neutral */
  emotion?: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
}

export interface TtsExpressionParams {
  elevenlabs?: ElevenLabsExpression;
  cartesia?: CartesiaExpression;
  hume?: HumeExpression;
  openai?: OpenAIExpression;
  minimax?: MinimaxExpression;
}

// ---------------------------------------------------------------------------
// Direction → provider mapping table
// ---------------------------------------------------------------------------

interface DirectionMapping {
  elevenlabs: ElevenLabsExpression;
  cartesia: CartesiaExpression;
  hume: { description: string };
  openai: { instructions: string };
  minimax: MinimaxExpression;
}

/**
 * Curated mappings for common direction values.
 * Each maps to the optimal expression for each provider.
 */
const DIRECTION_MAP: Record<string, DirectionMapping> = {
  energetic: {
    elevenlabs: { audioTagPrefix: '[excited] ', stability: 0.0 },
    cartesia: { emotion: 'excited' },
    hume: { description: 'energetic, enthusiastic, high-energy delivery' },
    openai: { instructions: 'Speak with high energy and enthusiasm, like an excited podcast host.' },
    minimax: { emotion: 'happy' },
  },
  excited: {
    elevenlabs: { audioTagPrefix: '[excited] ', stability: 0.0 },
    cartesia: { emotion: 'excited' },
    hume: { description: 'excited, enthusiastic' },
    openai: { instructions: 'Speak with genuine excitement and enthusiasm.' },
    minimax: { emotion: 'happy' },
  },
  thoughtful: {
    elevenlabs: { audioTagPrefix: '[calm] ', stability: 0.5 },
    cartesia: { emotion: 'contemplative' },
    hume: { description: 'thoughtful, measured, reflective' },
    openai: { instructions: 'Speak thoughtfully with a measured, reflective pace.' },
    minimax: { emotion: 'neutral' },
  },
  serious: {
    elevenlabs: { stability: 1.0 },
    cartesia: { emotion: 'determined' },
    hume: { description: 'serious, grave, measured' },
    openai: { instructions: 'Speak in a serious, measured tone with gravitas.' },
    minimax: { emotion: 'neutral' },
  },
  playful: {
    elevenlabs: { audioTagPrefix: '[playfully] ', stability: 0.0 },
    cartesia: { emotion: 'happy' },
    hume: { description: 'playful, light-hearted, fun' },
    openai: { instructions: 'Speak playfully and light-heartedly, with a smile in your voice.' },
    minimax: { emotion: 'happy' },
  },
  sarcastic: {
    elevenlabs: { audioTagPrefix: '[sarcastic] ', stability: 0.5 },
    cartesia: { emotion: 'sarcastic' },
    hume: { description: 'sarcastic, dry, deadpan' },
    openai: { instructions: 'Speak with dry sarcasm and a slightly flat affect.' },
    minimax: { emotion: 'neutral' },
  },
  warm: {
    elevenlabs: { stability: 0.5 },
    cartesia: { emotion: 'affectionate' },
    hume: { description: 'warm, inviting, friendly' },
    openai: { instructions: 'Speak warmly and invitingly, like welcoming a friend.' },
    minimax: { emotion: 'neutral' },
  },
  urgent: {
    elevenlabs: { audioTagPrefix: '[rushed] ', stability: 0.0 },
    cartesia: { emotion: 'agitated' },
    hume: { description: 'urgent, fast-paced, pressing' },
    openai: { instructions: 'Speak with urgency, slightly faster pace, conveying importance.' },
    minimax: { emotion: 'angry' },
  },
  hesitant: {
    elevenlabs: { audioTagPrefix: '[hesitantly] ', stability: 0.5 },
    cartesia: { emotion: 'hesitant' },
    hume: { description: 'hesitant, uncertain, searching for words' },
    openai: { instructions: 'Speak hesitantly, as if carefully choosing your words.' },
    minimax: { emotion: 'fearful' },
  },
  confident: {
    elevenlabs: { stability: 1.0 },
    cartesia: { emotion: 'confident' },
    hume: { description: 'confident, assured, authoritative' },
    openai: { instructions: 'Speak with confidence and authority.' },
    minimax: { emotion: 'neutral' },
  },
  nostalgic: {
    elevenlabs: { audioTagPrefix: '[calm] ', stability: 0.5 },
    cartesia: { emotion: 'nostalgic' },
    hume: { description: 'nostalgic, wistful, reminiscing' },
    openai: { instructions: 'Speak with nostalgia, as if fondly remembering the past.' },
    minimax: { emotion: 'sad' },
  },
  dramatic: {
    elevenlabs: { audioTagPrefix: '[dramatic] ', stability: 0.0 },
    cartesia: { emotion: 'amazed' },
    hume: { description: 'dramatic, building tension' },
    openai: { instructions: 'Speak dramatically, building tension and suspense.' },
    minimax: { emotion: 'surprised' },
  },
  calm: {
    elevenlabs: { audioTagPrefix: '[calm] ', stability: 1.0 },
    cartesia: { emotion: 'calm' },
    hume: { description: 'calm, serene, measured' },
    openai: { instructions: 'Speak calmly and serenely, with a measured pace.' },
    minimax: { emotion: 'neutral' },
  },
  curious: {
    elevenlabs: { audioTagPrefix: '[curious] ', stability: 0.5 },
    cartesia: { emotion: 'curious' },
    hume: { description: 'curious, inquisitive, wondering' },
    openai: { instructions: 'Speak with curiosity and genuine interest, slightly questioning.' },
    minimax: { emotion: 'neutral' },
  },
  laughing: {
    elevenlabs: { audioTagPrefix: '[laughs] ', stability: 0.0 },
    cartesia: { emotion: 'happy' },
    hume: { description: 'amused, laughing, light-hearted' },
    openai: { instructions: 'Speak while lightly laughing, amused and cheerful.' },
    minimax: { emotion: 'happy' },
  },
  whispering: {
    elevenlabs: { audioTagPrefix: '[whispers] ', stability: 0.5 },
    cartesia: {},
    hume: { description: 'whispering, hushed, secretive' },
    openai: { instructions: 'Whisper softly, as if sharing a secret.' },
    minimax: { emotion: 'neutral' },
  },
  frustrated: {
    elevenlabs: { audioTagPrefix: '[frustrated] ', stability: 0.0 },
    cartesia: { emotion: 'frustrated' },
    hume: { description: 'frustrated, exasperated' },
    openai: { instructions: 'Speak with frustration and exasperation.' },
    minimax: { emotion: 'angry' },
  },
  surprised: {
    elevenlabs: { audioTagPrefix: '[gasps] ', stability: 0.0 },
    cartesia: { emotion: 'surprised' },
    hume: { description: 'surprised, astonished' },
    openai: { instructions: 'Speak with genuine surprise and astonishment.' },
    minimax: { emotion: 'surprised' },
  },
  sad: {
    elevenlabs: { audioTagPrefix: '[sighs] ', stability: 0.5 },
    cartesia: { emotion: 'sad' },
    hume: { description: 'sad, somber, heavy-hearted' },
    openai: { instructions: 'Speak with sadness, a heavy tone, slightly slower.' },
    minimax: { emotion: 'sad' },
  },
  skeptical: {
    elevenlabs: { stability: 0.5 },
    cartesia: { emotion: 'skeptical' },
    hume: { description: 'skeptical, doubtful, questioning' },
    openai: { instructions: 'Speak with skepticism, as if not entirely convinced.' },
    minimax: { emotion: 'neutral' },
  },
};

// ---------------------------------------------------------------------------
// Speaker baseline descriptions — used when no direction is provided
// ---------------------------------------------------------------------------

const SPEAKER_BASELINES: Record<string, { hume: string; openai: string }> = {
  HOST: {
    hume: 'warm, engaging podcast host',
    openai: 'Speak naturally as a warm, engaging podcast host. Conversational and inviting.',
  },
  GUEST: {
    hume: 'warm, engaging podcast host',
    openai: 'Speak naturally as a warm, engaging podcast host. Conversational and inviting.',
  },
  EXPERT: {
    hume: 'knowledgeable, articulate expert',
    openai: 'Speak as a knowledgeable expert. Clear, articulate, and confident.',
  },
  SKEPTIC: {
    hume: 'thoughtful, questioning analyst',
    openai: 'Speak as a thoughtful analyst. Measured, questioning, with analytical precision.',
  },
};

const DEFAULT_BASELINE = {
  hume: 'natural, conversational podcast speaker',
  openai: 'Speak naturally and conversationally, like a podcast host.',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a script direction to provider-specific expression parameters.
 * Falls back to speaker baseline if no direction is provided.
 */
export function mapDirectionToExpression(
  direction: string | undefined,
  speaker: string | undefined,
  providerId: TtsProviderId
): TtsExpressionParams {
  const params: TtsExpressionParams = {};
  const normalizedDirection = direction?.toLowerCase().trim();
  const mapping = normalizedDirection ? DIRECTION_MAP[normalizedDirection] : undefined;
  const baseline = SPEAKER_BASELINES[speaker?.toUpperCase() ?? ''] ?? DEFAULT_BASELINE;

  switch (providerId) {
    case 'elevenlabs': {
      if (mapping) {
        params.elevenlabs = mapping.elevenlabs;
      } else if (normalizedDirection) {
        // Unknown direction → try it as a raw audio tag (ElevenLabs v3 is generative)
        params.elevenlabs = { audioTagPrefix: `[${normalizedDirection}] ` };
      }
      break;
    }
    case 'cartesia': {
      if (mapping?.cartesia.emotion) {
        params.cartesia = mapping.cartesia;
      } else if (normalizedDirection) {
        // Cartesia accepts 60 emotion strings — pass unknown ones as-is, it'll ignore invalid
        params.cartesia = { emotion: normalizedDirection };
      }
      break;
    }
    case 'hume': {
      // Hume always gets a description — direction overrides baseline
      params.hume = {
        description: mapping?.hume.description ?? normalizedDirection ?? baseline.hume,
      };
      break;
    }
    case 'openai': {
      // OpenAI always gets instructions — direction overrides baseline
      if (mapping) {
        params.openai = mapping.openai;
      } else if (normalizedDirection) {
        params.openai = { instructions: `Speak with a ${normalizedDirection} tone.` };
      } else {
        params.openai = { instructions: baseline.openai };
      }
      break;
    }
    case 'minimax': {
      if (mapping?.minimax.emotion) {
        params.minimax = mapping.minimax;
      }
      break;
    }
    // fal, replicate, kittentts — no expression support
  }

  return params;
}

/**
 * Get the list of well-supported direction values for script generation prompts.
 */
export function getSupportedDirections(): string[] {
  return Object.keys(DIRECTION_MAP);
}
