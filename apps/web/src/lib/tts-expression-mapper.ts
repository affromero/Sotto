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
  /** Stability override: 0.0 Creative (most expressive), 0.5 Natural, 1.0 Robust (reduces tag responsiveness) */
  stability?: number;
  /**
   * If true, the audioTagPrefix is re-injected before every sentence so the
   * delivery style persists across the whole segment (not just the opening words).
   * Set false for one-shot sound events like [laughs], [gasps], [sighs].
   */
  sustainedDelivery?: boolean;
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

export interface InworldExpression {
  /** Inworld emotion tag to prepend to text (e.g. "[happy]") */
  emotionTag?: string;
}

export interface TtsExpressionParams {
  elevenlabs?: ElevenLabsExpression;
  cartesia?: CartesiaExpression;
  hume?: HumeExpression;
  openai?: OpenAIExpression;
  minimax?: MinimaxExpression;
  replicate?: InworldExpression;
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
  replicate: InworldExpression;
}

/**
 * Curated mappings for common direction values.
 * Each maps to the optimal expression for each provider.
 */
const DIRECTION_MAP: Record<string, DirectionMapping> = {
  energetic: {
    elevenlabs: { audioTagPrefix: '[excited] ', stability: 0.0, sustainedDelivery: true },
    cartesia: { emotion: 'excited' },
    hume: { description: 'energetic, enthusiastic, high-energy delivery' },
    openai: { instructions: 'Speak with high energy and enthusiasm, like an excited podcast host.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[happy]' },
  },
  excited: {
    elevenlabs: { audioTagPrefix: '[excited] ', stability: 0.0, sustainedDelivery: true },
    cartesia: { emotion: 'excited' },
    hume: { description: 'excited, enthusiastic' },
    openai: { instructions: 'Speak with genuine excitement and enthusiasm.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[happy]' },
  },
  thoughtful: {
    elevenlabs: { audioTagPrefix: '[calm] ', stability: 0.5, sustainedDelivery: true },
    cartesia: { emotion: 'contemplative' },
    hume: { description: 'thoughtful, measured, reflective' },
    openai: { instructions: 'Speak thoughtfully with a measured, reflective pace.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  serious: {
    elevenlabs: { stability: 0.5 },
    cartesia: { emotion: 'determined' },
    hume: { description: 'serious, grave, measured' },
    openai: { instructions: 'Speak in a serious, measured tone with gravitas.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  playful: {
    elevenlabs: { audioTagPrefix: '[playfully] ', stability: 0.0, sustainedDelivery: true },
    cartesia: { emotion: 'happy' },
    hume: { description: 'playful, light-hearted, fun' },
    openai: { instructions: 'Speak playfully and light-heartedly, with a smile in your voice.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[happy]' },
  },
  sarcastic: {
    elevenlabs: { audioTagPrefix: '[sarcastic] ', stability: 0.5, sustainedDelivery: true },
    cartesia: { emotion: 'sarcastic' },
    hume: { description: 'sarcastic, dry, deadpan' },
    openai: { instructions: 'Speak with dry sarcasm and a slightly flat affect.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  warm: {
    elevenlabs: { audioTagPrefix: '[warmly] ', stability: 0.5, sustainedDelivery: true },
    cartesia: { emotion: 'affectionate' },
    hume: { description: 'warm, inviting, friendly' },
    openai: { instructions: 'Speak warmly and invitingly, like welcoming a friend.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  urgent: {
    elevenlabs: { audioTagPrefix: '[rushed] ', stability: 0.0, sustainedDelivery: true },
    cartesia: { emotion: 'agitated' },
    hume: { description: 'urgent, fast-paced, pressing' },
    openai: { instructions: 'Speak with urgency, slightly faster pace, conveying importance.' },
    minimax: { emotion: 'angry' },
    replicate: { emotionTag: '[angry]' },
  },
  hesitant: {
    elevenlabs: { audioTagPrefix: '[hesitantly] ', stability: 0.5, sustainedDelivery: true },
    cartesia: { emotion: 'hesitant' },
    hume: { description: 'hesitant, uncertain, searching for words' },
    openai: { instructions: 'Speak hesitantly, as if carefully choosing your words.' },
    minimax: { emotion: 'fearful' },
    replicate: { emotionTag: '[fearful]' },
  },
  confident: {
    elevenlabs: { stability: 0.5 },
    cartesia: { emotion: 'confident' },
    hume: { description: 'confident, assured, authoritative' },
    openai: { instructions: 'Speak with confidence and authority.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  nostalgic: {
    elevenlabs: { audioTagPrefix: '[calm] ', stability: 0.5, sustainedDelivery: true },
    cartesia: { emotion: 'nostalgic' },
    hume: { description: 'nostalgic, wistful, reminiscing' },
    openai: { instructions: 'Speak with nostalgia, as if fondly remembering the past.' },
    minimax: { emotion: 'sad' },
    replicate: { emotionTag: '[sad]' },
  },
  dramatic: {
    elevenlabs: { audioTagPrefix: '[dramatic] ', stability: 0.0, sustainedDelivery: true },
    cartesia: { emotion: 'amazed' },
    hume: { description: 'dramatic, building tension' },
    openai: { instructions: 'Speak dramatically, building tension and suspense.' },
    minimax: { emotion: 'surprised' },
    replicate: { emotionTag: '[surprised]' },
  },
  calm: {
    elevenlabs: { audioTagPrefix: '[calm] ', stability: 0.5, sustainedDelivery: true },
    cartesia: { emotion: 'calm' },
    hume: { description: 'calm, serene, measured' },
    openai: { instructions: 'Speak calmly and serenely, with a measured pace.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  curious: {
    elevenlabs: { audioTagPrefix: '[curious] ', stability: 0.5, sustainedDelivery: true },
    cartesia: { emotion: 'curious' },
    hume: { description: 'curious, inquisitive, wondering' },
    openai: { instructions: 'Speak with curiosity and genuine interest, slightly questioning.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  laughing: {
    // One-shot sound event — [laughs] only fires once at the start, not re-injected
    elevenlabs: { audioTagPrefix: '[laughs] ', stability: 0.0 },
    cartesia: { emotion: 'happy' },
    hume: { description: 'amused, laughing, light-hearted' },
    openai: { instructions: 'Speak while lightly laughing, amused and cheerful.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[laughing]' },
  },
  chuckling: {
    // One-shot sound event — light chuckling at the start of the turn
    elevenlabs: { audioTagPrefix: '[chuckles] ', stability: 0.0 },
    cartesia: { emotion: 'happy' },
    hume: { description: 'lightly chuckling, gently amused' },
    openai: { instructions: 'Speak while lightly chuckling, softly amused.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[laughing]' },
  },
  giggling: {
    // One-shot sound event — giggly, playful laughter at the start of the turn
    elevenlabs: { audioTagPrefix: '[giggles] ', stability: 0.0 },
    cartesia: { emotion: 'happy' },
    hume: { description: 'giggling, light and playful' },
    openai: { instructions: 'Speak while giggling, light and playful.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[laughing]' },
  },
  whispering: {
    elevenlabs: { audioTagPrefix: '[whispers] ', stability: 0.5, sustainedDelivery: true },
    cartesia: {},
    hume: { description: 'whispering, hushed, secretive' },
    openai: { instructions: 'Whisper softly, as if sharing a secret.' },
    minimax: { emotion: 'neutral' },
    replicate: { emotionTag: '[whispering]' },
  },
  frustrated: {
    elevenlabs: { audioTagPrefix: '[frustrated] ', stability: 0.0, sustainedDelivery: true },
    cartesia: { emotion: 'frustrated' },
    hume: { description: 'frustrated, exasperated' },
    openai: { instructions: 'Speak with frustration and exasperation.' },
    minimax: { emotion: 'angry' },
    replicate: { emotionTag: '[angry]' },
  },
  surprised: {
    // One-shot sound event — [gasps] only fires once at the start, not re-injected
    elevenlabs: { audioTagPrefix: '[gasps] ', stability: 0.0 },
    cartesia: { emotion: 'surprised' },
    hume: { description: 'surprised, astonished' },
    openai: { instructions: 'Speak with genuine surprise and astonishment.' },
    minimax: { emotion: 'surprised' },
    replicate: { emotionTag: '[surprised]' },
  },
  sad: {
    // One-shot sound event — [sighs] only fires once at the start, not re-injected
    elevenlabs: { audioTagPrefix: '[sighs] ', stability: 0.5 },
    cartesia: { emotion: 'sad' },
    hume: { description: 'sad, somber, heavy-hearted' },
    openai: { instructions: 'Speak with sadness, a heavy tone, slightly slower.' },
    minimax: { emotion: 'sad' },
    replicate: { emotionTag: '[sad]' },
  },
  skeptical: {
    elevenlabs: { stability: 0.5 },
    cartesia: { emotion: 'skeptical' },
    hume: { description: 'skeptical, doubtful, questioning' },
    openai: { instructions: 'Speak with skepticism, as if not entirely convinced.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
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
    case 'replicate': {
      if (mapping?.replicate.emotionTag) {
        params.replicate = mapping.replicate;
      }
      break;
    }
    // fal, kittentts — no expression support
  }

  return params;
}

/**
 * Get the list of well-supported direction values for script generation prompts.
 */
export function getSupportedDirections(): string[] {
  return Object.keys(DIRECTION_MAP);
}

// ---------------------------------------------------------------------------
// Inline audio tag conversion — provider-specific handling
// ---------------------------------------------------------------------------

/**
 * Convert provider-agnostic inline audio tags embedded in script text
 * (e.g. [laughs], [pause], [excited]) to the native format for each provider.
 * Must be called before sending text to any TTS API.
 *
 * Provider support matrix:
 *   ElevenLabs v3  — all audio tags native; pass through unchanged
 *   Hume Octave    — [pause] and [long pause] native; strip everything else
 *   Cartesia Sonic — [laughter] native; [pause] → SSML break; strip rest
 *   OpenAI / rest  — no tag support; pauses → punctuation; strip all tags
 */
export function convertInlineAudioTags(text: string, providerId: TtsProviderId): string {
  switch (providerId) {
    case 'elevenlabs':
      return text;

    case 'hume':
      // Only [pause] and [long pause] are native Hume markers; strip everything else
      return text.replace(/\[(?!(?:long )?pause\])([^\]]+)\]/gi, '');

    case 'cartesia': {
      // [laughter] is the native Cartesia transcript marker
      // [pause] / [short pause] → SSML break 0.5s; [long pause] → 1.5s
      const laughRe =
        /\[(?:laughs?|chuckles?|giggles?|starts laughing|laughing|laughs harder|wheezing|cracking up|stifling laughter|laughing hysterically|with genuine belly laugh)\]/gi;
      return text
        .replace(laughRe, '[laughter]')
        .replace(/\[long pause\]/gi, '<break time="1.5s"/>')
        .replace(/\[(?:pause|short pause)\]/gi, '<break time="0.5s"/>')
        .replace(/\[([^\]]+)\]/g, '');
    }

    default:
      // openai, minimax, fal, replicate, kittentts — no audio tag support
      // Approximate pauses with punctuation; strip all remaining expression tags
      return text
        .replace(/\[long pause\]/gi, '... ')
        .replace(/\[(?:pause|short pause)\]/gi, ', ')
        .replace(/\[([^\]]+)\]/g, '');
  }
}
