/**
 * Voice realism instructions appended to TTS-bound system prompts.
 *
 * These fragments teach the LLM to produce text that sounds like natural speech
 * rather than "written language read aloud." Based on research from LiveKit and
 * real episode production techniques.
 *
 * Two variants:
 *   - VOICE_REALISM_INSTRUCTIONS: Full guidance for script generation (long-form dialogue)
 *   - VOICE_REALISM_SHORT: Lighter guidance for Q&A and incorporation segments
 */

import { loadPrompt } from './prompt-loader';

/**
 * Full voice realism instructions for episode script generation.
 * Appended to all three generateScript* functions in script-generator.ts.
 *
 * Covers: disfluencies, observable speech behaviors, concrete before/after
 * examples, emotion constraints, and sentence-starter patterns.
 */
export const VOICE_REALISM_INSTRUCTIONS = loadPrompt('shared/voice-realism-full.md');

/**
 * Lighter voice realism guidance for short TTS segments:
 * Q&A incorporation (2-4 sentences) and interrupt responses.
 */
export const VOICE_REALISM_SHORT = loadPrompt('shared/voice-realism-short.md');
