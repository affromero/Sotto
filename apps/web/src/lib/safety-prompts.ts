/**
 * Reusable safety instruction fragments appended to LLM system prompts.
 *
 * These are additive — they supplement existing prompts rather than replacing them.
 * Each fragment targets a specific concern:
 *   - CONTENT_SAFETY_INSTRUCTIONS: prevents harmful content generation
 *   - INPUT_SANITIZATION_INSTRUCTIONS: defends against prompt injection
 */

import { loadPrompt } from './prompt-loader';

/**
 * Appended to all user-facing LLM prompts (discovery, script generation, Q&A).
 * Instructs the model to refuse genuinely harmful content while allowing
 * frank educational discussion of sensitive topics.
 */
export const CONTENT_SAFETY_INSTRUCTIONS = loadPrompt('shared/content-safety.md');

/**
 * Appended to prompts that process external user input such as discovery chat
 * and imported source text. Defends against prompt injection and jailbreak attempts.
 */
export const INPUT_SANITIZATION_INSTRUCTIONS = loadPrompt('shared/input-sanitization.md');
