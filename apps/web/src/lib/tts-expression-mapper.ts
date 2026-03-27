/**
 * Maps script `direction` values to provider-specific expression parameters.
 *
 * Each TTS provider has a different API for controlling emotion and delivery:
 *   - ElevenLabs v3: inline audio tags + stability control + speed (0.7–1.2)
 *   - Cartesia Sonic 3: generation_config.emotion (60 values) + speed (0.6–1.5) + SSML
 *   - Hume Octave: description field (natural language, ≤100 chars) + speed (0.5–2.0)
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
  /** Speech rate multiplier (0.7–1.2). Goes into voice_settings.speed. */
  speed?: number;
}

export interface CartesiaExpression {
  /** Emotion value for generation_config (one of 60 Sonic 3 values) */
  emotion?: string;
  /** Speech rate multiplier (0.6–1.5). Goes into generation_config.speed. */
  speed?: number;
  /** Volume multiplier (0.5–2.0). Goes into generation_config.volume. */
  volume?: number;
}

export interface HumeExpression {
  /** Acting instruction for the utterance description field (≤100 chars) */
  description: string;
  /** Speech rate multiplier (0.5–2.0, stable 0.75–1.5). */
  speed?: number;
  /** Seconds of silence after utterance (0–5). Default 0.3. */
  trailingSilence?: number;
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
  hume: HumeExpression;
  openai: OpenAIExpression;
  minimax: MinimaxExpression;
  replicate: InworldExpression;
}

/**
 * Curated mappings for common direction values.
 * Each maps to the optimal expression for each provider.
 *
 * Speed values are tuned per provider's supported range:
 *   ElevenLabs: 0.7–1.2 (tightest range, values compressed)
 *   Cartesia:   0.6–1.5 (wide range)
 *   Hume:       0.5–2.0 (widest, stable 0.75–1.5)
 */
const DIRECTION_MAP: Record<string, DirectionMapping> = {
  energetic: {
    elevenlabs: { audioTagPrefix: '[excited] ', stability: 0.0, sustainedDelivery: true, speed: 1.15 },
    cartesia: { emotion: 'excited', speed: 1.1, volume: 1.3 },
    hume: { description: 'energetic, enthusiastic, high-energy delivery', speed: 1.3, trailingSilence: 0.15 },
    openai: { instructions: 'Speak with high energy and enthusiasm, like an excited podcast host.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[happy]' },
  },
  excited: {
    elevenlabs: { audioTagPrefix: '[excited] ', stability: 0.0, sustainedDelivery: true, speed: 1.15 },
    cartesia: { emotion: 'excited', speed: 1.1, volume: 1.25 },
    hume: { description: 'excited, enthusiastic', speed: 1.3, trailingSilence: 0.15 },
    openai: { instructions: 'Speak with genuine excitement and enthusiasm.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[happy]' },
  },
  thoughtful: {
    elevenlabs: { audioTagPrefix: '[calm] ', stability: 0.5, sustainedDelivery: true, speed: 0.85 },
    cartesia: { emotion: 'contemplative', speed: 0.8, volume: 0.85 },
    hume: { description: 'thoughtful, measured, reflective', speed: 0.8, trailingSilence: 0.6 },
    openai: { instructions: 'Speak thoughtfully with a measured, reflective pace.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  serious: {
    elevenlabs: { stability: 0.5, speed: 0.9 },
    cartesia: { emotion: 'determined', speed: 0.85 },
    hume: { description: 'serious, grave, measured', speed: 0.85 },
    openai: { instructions: 'Speak in a serious, measured tone with gravitas.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  playful: {
    elevenlabs: { audioTagPrefix: '[playfully] ', stability: 0.0, sustainedDelivery: true, speed: 1.1 },
    cartesia: { emotion: 'happy', speed: 1.1 },
    hume: { description: 'playful, light-hearted, fun', speed: 1.2, trailingSilence: 0.2 },
    openai: { instructions: 'Speak playfully and light-heartedly, with a smile in your voice.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[happy]' },
  },
  sarcastic: {
    elevenlabs: { audioTagPrefix: '[sarcastic] ', stability: 0.5, sustainedDelivery: true, speed: 0.95 },
    cartesia: { emotion: 'sarcastic', speed: 0.9 },
    hume: { description: 'sarcastic, dry, deadpan', speed: 0.9 },
    openai: { instructions: 'Speak with dry sarcasm and a slightly flat affect.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  warm: {
    elevenlabs: { audioTagPrefix: '[warmly] ', stability: 0.5, sustainedDelivery: true, speed: 0.95 },
    cartesia: { emotion: 'affectionate', speed: 0.95 },
    hume: { description: 'warm, inviting, friendly', speed: 0.95 },
    openai: { instructions: 'Speak warmly and invitingly, like welcoming a friend.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  urgent: {
    elevenlabs: { audioTagPrefix: '[rushed] ', stability: 0.0, sustainedDelivery: true, speed: 1.2 },
    cartesia: { emotion: 'agitated', speed: 1.2, volume: 1.2 },
    hume: { description: 'urgent, fast-paced, pressing', speed: 1.5, trailingSilence: 0.1 },
    openai: { instructions: 'Speak with urgency, slightly faster pace, conveying importance.' },
    minimax: { emotion: 'angry' },
    replicate: { emotionTag: '[angry]' },
  },
  hesitant: {
    elevenlabs: { audioTagPrefix: '[hesitantly] ', stability: 0.5, sustainedDelivery: true, speed: 0.8 },
    cartesia: { emotion: 'hesitant', speed: 0.75, volume: 0.8 },
    hume: { description: 'hesitant, uncertain, searching for words', speed: 0.75, trailingSilence: 0.5 },
    openai: { instructions: 'Speak hesitantly, as if carefully choosing your words.' },
    minimax: { emotion: 'fearful' },
    replicate: { emotionTag: '[fearful]' },
  },
  confident: {
    elevenlabs: { stability: 0.5 },
    cartesia: { emotion: 'confident', volume: 1.1 },
    hume: { description: 'confident, assured, authoritative' },
    openai: { instructions: 'Speak with confidence and authority.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  nostalgic: {
    elevenlabs: { audioTagPrefix: '[calm] ', stability: 0.5, sustainedDelivery: true, speed: 0.85 },
    cartesia: { emotion: 'nostalgic', speed: 0.8, volume: 0.85 },
    hume: { description: 'nostalgic, wistful, reminiscing', speed: 0.8, trailingSilence: 0.6 },
    openai: { instructions: 'Speak with nostalgia, as if fondly remembering the past.' },
    minimax: { emotion: 'sad' },
    replicate: { emotionTag: '[sad]' },
  },
  dramatic: {
    elevenlabs: { audioTagPrefix: '[dramatic] ', stability: 0.0, sustainedDelivery: true, speed: 0.9 },
    cartesia: { emotion: 'amazed', speed: 0.85, volume: 1.1 },
    hume: { description: 'dramatic, building tension', speed: 0.85, trailingSilence: 0.8 },
    openai: { instructions: 'Speak dramatically, building tension and suspense.' },
    minimax: { emotion: 'surprised' },
    replicate: { emotionTag: '[surprised]' },
  },
  calm: {
    elevenlabs: { audioTagPrefix: '[calm] ', stability: 0.5, sustainedDelivery: true, speed: 0.85 },
    cartesia: { emotion: 'calm', speed: 0.8, volume: 0.8 },
    hume: { description: 'calm, serene, measured', speed: 0.8, trailingSilence: 0.5 },
    openai: { instructions: 'Speak calmly and serenely, with a measured pace.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  curious: {
    elevenlabs: { audioTagPrefix: '[curious] ', stability: 0.5, sustainedDelivery: true },
    cartesia: { emotion: 'curious', speed: 1.05 },
    hume: { description: 'curious, inquisitive, wondering', speed: 1.05 },
    openai: { instructions: 'Speak with curiosity and genuine interest, slightly questioning.' },
    minimax: { emotion: 'neutral' },
    replicate: {},
  },
  laughing: {
    // One-shot sound event — [laughs] only fires once at the start, not re-injected
    elevenlabs: { audioTagPrefix: '[laughs] ', stability: 0.0, speed: 1.05 },
    cartesia: { emotion: 'happy', speed: 1.1 },
    hume: { description: 'amused, laughing, light-hearted', speed: 1.1, trailingSilence: 0.2 },
    openai: { instructions: 'Speak while lightly laughing, amused and cheerful.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[laughing]' },
  },
  chuckling: {
    // One-shot sound event — light chuckling at the start of the turn
    elevenlabs: { audioTagPrefix: '[chuckles] ', stability: 0.0 },
    cartesia: { emotion: 'happy', speed: 1.05 },
    hume: { description: 'lightly chuckling, gently amused', speed: 1.05, trailingSilence: 0.2 },
    openai: { instructions: 'Speak while lightly chuckling, softly amused.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[laughing]' },
  },
  giggling: {
    // One-shot sound event — giggly, playful laughter at the start of the turn
    elevenlabs: { audioTagPrefix: '[giggles] ', stability: 0.0, speed: 1.05 },
    cartesia: { emotion: 'happy', speed: 1.1 },
    hume: { description: 'giggling, light and playful', speed: 1.1, trailingSilence: 0.2 },
    openai: { instructions: 'Speak while giggling, light and playful.' },
    minimax: { emotion: 'happy' },
    replicate: { emotionTag: '[laughing]' },
  },
  whispering: {
    elevenlabs: { audioTagPrefix: '[whispers] ', stability: 0.5, sustainedDelivery: true, speed: 0.8 },
    cartesia: { speed: 0.7, volume: 0.6 },
    hume: { description: 'whispering, hushed, secretive', speed: 0.75, trailingSilence: 0.5 },
    openai: { instructions: 'Whisper softly, as if sharing a secret.' },
    minimax: { emotion: 'neutral' },
    replicate: { emotionTag: '[whispering]' },
  },
  frustrated: {
    elevenlabs: { audioTagPrefix: '[frustrated] ', stability: 0.0, sustainedDelivery: true, speed: 1.1 },
    cartesia: { emotion: 'frustrated', speed: 1.05, volume: 1.15 },
    hume: { description: 'frustrated, exasperated', speed: 1.2, trailingSilence: 0.2 },
    openai: { instructions: 'Speak with frustration and exasperation.' },
    minimax: { emotion: 'angry' },
    replicate: { emotionTag: '[angry]' },
  },
  surprised: {
    // One-shot sound event — [gasps] only fires once at the start, not re-injected
    elevenlabs: { audioTagPrefix: '[gasps] ', stability: 0.0, speed: 1.1 },
    cartesia: { emotion: 'surprised', speed: 1.05, volume: 1.2 },
    hume: { description: 'surprised, astonished', speed: 1.15, trailingSilence: 0.4 },
    openai: { instructions: 'Speak with genuine surprise and astonishment.' },
    minimax: { emotion: 'surprised' },
    replicate: { emotionTag: '[surprised]' },
  },
  sad: {
    // One-shot sound event — [sighs] only fires once at the start, not re-injected
    elevenlabs: { audioTagPrefix: '[sighs] ', stability: 0.5, speed: 0.8 },
    cartesia: { emotion: 'sad', speed: 0.75, volume: 0.75 },
    hume: { description: 'sad, somber, heavy-hearted', speed: 0.75, trailingSilence: 0.7 },
    openai: { instructions: 'Speak with sadness, a heavy tone, slightly slower.' },
    minimax: { emotion: 'sad' },
    replicate: { emotionTag: '[sad]' },
  },
  skeptical: {
    elevenlabs: { stability: 0.5, speed: 0.9 },
    cartesia: { emotion: 'skeptical', speed: 0.9 },
    hume: { description: 'skeptical, doubtful, questioning', speed: 0.9 },
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
        // Unknown direction -> try it as a raw audio tag (ElevenLabs v3 is generative)
        params.elevenlabs = { audioTagPrefix: `[${normalizedDirection}] ` };
      }
      break;
    }
    case 'cartesia': {
      if (mapping?.cartesia && (mapping.cartesia.emotion || mapping.cartesia.speed)) {
        params.cartesia = mapping.cartesia;
      } else if (normalizedDirection) {
        // Cartesia accepts 60 emotion strings — pass unknown ones as-is, it'll ignore invalid
        params.cartesia = { emotion: normalizedDirection };
      }
      break;
    }
    case 'hume': {
      // Hume always gets a description — direction overrides baseline
      if (mapping?.hume) {
        params.hume = { ...mapping.hume };
      } else {
        params.hume = {
          description: normalizedDirection ?? baseline.hume,
        };
      }
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
 *   Cartesia Sonic — [laughter] native; [pause] -> SSML break; strip rest
 *   OpenAI / rest  — no tag support; pauses -> punctuation; strip all tags
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
      // [pause] / [short pause] -> SSML break 0.5s; [long pause] -> 1.5s
      const laughRe =
        /\[(?:laughs?|chuckles?|giggles?|starts laughing|laughing|laughs harder|wheezing|cracking up|stifling laughter|laughing hysterically|with genuine belly laugh)\]/gi;
      return text
        .replace(laughRe, '[laughter]')
        .replace(/\[long pause\]/gi, '<break time="1.5s"/>')
        .replace(/\[(?:pause|short pause)\]/gi, '<break time="0.5s"/>')
        // Convert inline SSML markers before the catch-all strip
        .replace(/\[emotion:(\w+)\]/gi, '<emotion value="$1">')
        .replace(/\[\/emotion\]/gi, '</emotion>')
        .replace(/\[speed:([\d.]+)\]/gi, '<speed ratio="$1">')
        .replace(/\[\/speed\]/gi, '</speed>')
        .replace(/\[(?!laughter\])([^\]]+)\]/g, '');
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
