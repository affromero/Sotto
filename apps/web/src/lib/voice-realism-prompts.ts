/**
 * Voice realism instructions appended to TTS-bound system prompts.
 *
 * These fragments teach the LLM to produce text that sounds like natural speech
 * rather than "written language read aloud." Based on research from LiveKit and
 * real podcast production techniques.
 *
 * Two variants:
 *   - VOICE_REALISM_INSTRUCTIONS: Full guidance for script generation (long-form dialogue)
 *   - VOICE_REALISM_SHORT: Lighter guidance for Q&A and incorporation segments
 */

/**
 * Full voice realism instructions for podcast script generation.
 * Appended to all three generateScript* functions in script-generator.ts.
 *
 * Covers: disfluencies, observable speech behaviors, concrete before/after
 * examples, emotion constraints, and sentence-starter patterns.
 */
export const VOICE_REALISM_INSTRUCTIONS = `

## Voice Realism — Sound Human, Not Written

Your text goes directly through TTS. Written-sounding text produces robotic, stilted audio.
You must write the way people SPEAK, not the way people write.

### Rule 1: Include Natural Disfluencies

Real speakers hesitate, self-correct, and use filler words. Sprinkle these naturally — not in every turn, but in roughly 1 out of every 3-4 turns:

- Fillers: "um", "uh", "like", "you know", "I mean", "right"
- False starts: "It's— well, it's actually more like..."
- Self-corrections: "There were fifty— sorry, closer to sixty studies on this"
- Hedging: "sort of", "kind of", "basically", "essentially"
- Recovery words after fillers: pair "um" with "so" or "anyway" — e.g. "Um, so here's the thing..."

**DO NOT overdo it.** 1-2 disfluencies per turn maximum. Many turns should have zero. The goal is occasional realism, not a parody of stammering.

### Rule 2: Write Speech Patterns, Not Prose

| Written (BAD — sounds robotic in TTS) | Spoken (GOOD — sounds natural in TTS) |
|----------------------------------------|---------------------------------------|
| "I can certainly help you with that." | "Yeah, I can totally do that." |
| "That is a fascinating observation." | "Oh wow, that's— yeah, that's wild." |
| "Research indicates that this approach is effective." | "So the research basically says, like, this actually works." |
| "There are several important factors to consider." | "OK so there's a few things going on here." |
| "It is worth noting that..." | "And here's the thing—" |
| "This represents a significant finding." | "That's huge, honestly." |

### Rule 3: Sentence Starters That Sound Spoken

Start sentences the way real people start them — not with formal topic sentences:

- Connectors: "So", "And", "But", "OK so", "Right, so"
- Reactions: "Oh!", "Wait", "Huh", "See", "Look"
- Affirmations: "Yeah", "Exactly", "Right", "Totally"
- Thinking aloud: "I mean", "Here's the thing", "The way I think about it"

**NEVER** start more than 2 consecutive turns with the same word. Vary your openers.

### Rule 4: Contractions Are Mandatory

Always use contractions in dialogue. "It is" → "it's", "they are" → "they're", "would not" → "wouldn't", "that is" → "that's", "I have" → "I've". Uncontracted forms sound stiff and robotic in TTS.

### Rule 5: Short Sentences for Emphasis, Long for Flow

Vary sentence length deliberately. Use short punchy fragments for impact:
- "And it worked." (not "And the results demonstrated efficacy.")
- "That's the key." (not "That represents the fundamental insight.")
- "Wild, right?" (not "Is that not a remarkable finding?")

Then use longer, flowing sentences for explanation — mimicking how real speakers alternate between emphasis and elaboration.

### Rule 6: Interruption and Overlap Energy

In multi-speaker scripts, speakers should occasionally:
- React mid-thought: "So what happened was—" / "Wait, seriously?"
- Build on each other: "It's like—" / "Like a chain reaction, exactly."
- Express genuine surprise: "No way." / "I know, I know."
- Agree enthusiastically before adding: "Yes! And the crazy part is..."

### Rule 7: Emotion Through Word Choice, Not Stage Directions

Show emotion through HOW the text reads, not just through [laughs] or (excited):
- Surprise: short exclamations, repetition ("Wait wait wait"), trailing off ("That's... wow.")
- Enthusiasm: stacking adjectives, "honestly", "literally", emphatic "so" ("That is SO cool")
- Thoughtfulness: slower phrasing, "Hmm", "you know what", qualifiers before a big point
- Skepticism: "I don't know about that", "hold on", "OK but", rising-question phrasing`;

/**
 * Lighter voice realism guidance for short TTS segments:
 * Q&A incorporation (2-4 sentences) and interrupt responses.
 */
export const VOICE_REALISM_SHORT = `

## Voice Realism
Write the way people talk, not the way people write. Use contractions always ("it's", "they're", "wouldn't"). Start sentences with spoken connectors ("So", "Yeah", "OK so", "Here's the thing"). Keep it punchy — short sentences for emphasis, longer ones for explanation. An occasional "like" or "I mean" is fine. Never sound like a textbook.`;
