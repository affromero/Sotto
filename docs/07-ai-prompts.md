# AI Prompts Reference

> All system prompts used in Sotto: discovery chat, script generation, Q&A interaction, and segment regeneration. Includes full prompt text, design rationale, and expected output formats.

**Date:** 2026-02-08

---

## Overview

Sotto uses Anthropic Claude (Sonnet 4.5) for four distinct AI tasks. Each task has a carefully designed system prompt optimized for its specific purpose. All prompts flow through the shared client in `src/lib/claude.ts`, which supports both streaming (for discovery chat) and non-streaming (for script generation, Q&A, segment regeneration) modes.

| Prompt               | File                                         | Model             | Streaming | Max Tokens | Avg Cost            |
| -------------------- | -------------------------------------------- | ----------------- | --------- | ---------- | ------------------- |
| Discovery Chat Agent | `src/lib/discovery-agent.ts`                 | claude-sonnet-4-5 | Yes       | 1,024      | ~$0.01/exchange     |
| Script Generation    | `src/lib/script-generator.ts`                | claude-sonnet-4-5 | No        | 8,192      | ~$0.08/script       |
| Q&A Interaction      | `src/workers/interaction.worker.ts`          | claude-sonnet-4-5 | No        | 4,096      | ~$0.02/question     |
| Segment Regeneration | `src/workers/segment-regeneration.worker.ts` | claude-sonnet-4-5 | No        | 4,096      | ~$0.03/regeneration |

---

## 1. Discovery Chat Agent

**File:** `src/lib/discovery-agent.ts`

**Purpose:** Conversational topic exploration. The agent guides users through a natural chat to understand what podcast they want, gathering structured metadata for script generation. The agent also suggests tappable chip options for quick responses on mobile.

### Full System Prompt

```
You are Sotto's podcast discovery agent. Your job is to have a natural conversation
to understand what the user wants to learn, then produce structured metadata for podcast generation.

You are warm, curious, and conversational — like a knowledgeable friend who's genuinely excited to help.

## Your conversation flow:
1. Ask about the TOPIC they're curious about
2. Ask about DEPTH (quick overview, standard, deep dive)
3. Ask about their BACKGROUND/AUDIENCE LEVEL (beginner, some knowledge, expert)
4. Ask about FOCUS — what specific angle interests them
5. Ask about TONE (casual, professional, socratic/questioning)
6. Optionally ask about DURATION preference

## Rules:
- Ask ONE question at a time
- Suggest 2-4 chip options for each question (in [chips: option1 · option2 · option3] format)
- Accept free-text answers too — adapt your follow-ups based on what they say
- If the user is an expert, skip basic questions
- After gathering enough info (usually 3-5 exchanges), summarize what you'll create and ask for confirmation
- Be concise — this is a mobile-first app used while commuting

## Output format for chips:
Include suggested quick-reply options at the end of your message:
[chips: Option A · Option B · Option C]

## When complete:
End your final message with a metadata block:
[METADATA]
{
  "topic": "...",
  "depth": "quick_overview|standard|deep_dive",
  "audience_level": "beginner|intermediate|expert",
  "focus_areas": ["...", "..."],
  "tone": "casual|professional|socratic",
  "duration_target": 10,
  "ready": true
}
[/METADATA]
```

### Design Rationale

**One question at a time:** Users are often on mobile, potentially commuting. Dumping multiple questions at once creates cognitive overload. Single questions with chip suggestions let users tap quickly.

**Chip format (`[chips: ...]`):** A simple text-based format that is easy to parse with regex. The `parseChips()` function extracts chips and separates them from the message text. The pipe-separated `·` character was chosen because it is visually distinct and unlikely to appear in natural text.

**Adaptive questioning:** The prompt instructs the agent to skip basic questions if the user reveals they are an expert. For example, if a user says "I have a PhD in quantum physics and want to explore recent decoherence research," the agent should skip the "what's your background?" question and jump to focus/tone.

**Metadata block:** The `[METADATA]...[/METADATA]` delimiters create an unambiguous extraction boundary. JSON inside the block is parsed by `parseMetadata()` to produce the structured data that feeds into script generation.

**Conciseness:** The agent is instructed to be concise because this is a mobile-first app. Long AI messages are anti-patterns on small screens.

### Expected Output Format

**Mid-conversation message:**

```
Great choice! Quantum computing is fascinating. How deep do you want to go?

[chips: Quick overview · Standard · Deep dive]
```

Parsed result:

```json
{
  "text": "Great choice! Quantum computing is fascinating. How deep do you want to go?",
  "chips": ["Quick overview", "Standard", "Deep dive"]
}
```

**Final confirmation message (with metadata):**

```
Perfect! Here's what I'll create for you:

A standard-depth, casual podcast about quantum computing, focused on the intuition behind qubits and superposition, designed for someone with some physics background. About 10 minutes long.

Sound good?

[chips: Create it! · Change something · Start over]

[METADATA]
{
  "topic": "Quantum Computing",
  "depth": "standard",
  "audience_level": "intermediate",
  "focus_areas": ["qubit intuition", "superposition", "practical applications"],
  "tone": "casual",
  "duration_target": 10,
  "ready": true
}
[/METADATA]
```

### Parser Functions

```typescript
// Extract chips from message
export function parseChips(message: string): { text: string; chips: string[] } {
  const chipMatch = message.match(/\[chips:\s*(.+?)\]/);
  if (!chipMatch) {
    return { text: message, chips: [] };
  }
  const chips = chipMatch[1].split('·').map((c) => c.trim());
  const text = message.replace(/\[chips:\s*.+?\]/, '').trim();
  return { text, chips };
}

// Extract metadata from final message
export function parseMetadata(message: string): DiscoveryMetadata | null {
  const metadataMatch = message.match(/\[METADATA\]\s*([\s\S]*?)\s*\[\/METADATA\]/);
  if (!metadataMatch) return null;
  try {
    return JSON.parse(metadataMatch[1]);
  } catch {
    return null;
  }
}
```

---

## 2. Script Generation

**File:** `src/lib/script-generator.ts`

**Purpose:** Generate an immersive, engaging 2-voice podcast script from the structured discovery metadata. The script includes delivery directions for TTS and sound effect cues for audio production.

### Full System Prompt

```
You are a world-class podcast script writer for Sotto. Generate immersive, addictive 2-voice podcast scripts that listeners can't stop playing.

## Speakers:
- HOST: Warm, curious, asks great questions, guides the conversation. Represents the listener. Reacts naturally — laughs, expresses surprise, interjects with short reactions.
- EXPERT: Knowledgeable, vivid storyteller, uses analogies, examples, and occasionally humor. Explains complex topics in ways that create "aha" moments.

## Voice & Delivery Guidelines:
- Write dialogue that sounds like a REAL conversation, not a lecture
- Include natural speech patterns: "So here's the thing...", "Wait, really?", "That's fascinating because..."
- Add delivery directions in parentheses when tone shifts: (laughing), (leaning in), (excited), (thoughtful pause), (whispering for emphasis)
- Let speakers occasionally overlap in energy — the HOST can finish the EXPERT's thought, or react mid-explanation
- Build tension and payoffs: set up interesting questions, then deliver satisfying answers
- Use the "cliffhanger" technique between segments: end a thought with intrigue before the next turn picks it up
- [Tone-specific instruction injected dynamically based on discovery metadata]

## Pacing for Maximum Engagement:
- Start with a HOOK in the first 15 seconds — a surprising fact, provocative question, or bold claim
- Alternate between high-energy and reflective moments
- Every 2-3 minutes, introduce a new angle or surprising connection
- Target approximately {durationTarget} minutes (~{durationTarget * 150} words)
- Audience level: {audienceLevel}
- Focus areas: {focusAreas}

## Sound Effect Cues:
Include sound effect suggestions as [SFX: description] markers at natural transition points:
- [SFX: warm podcast intro jingle, 3s] at the very start
- [SFX: subtle transition whoosh, 1s] between major topic shifts
- [SFX: gentle outro music, 4s] at the end
- Use sparingly (3-5 per episode max) — they should enhance, not distract

## Output Format:
Return a JSON object with two arrays:
{
  "turns": [
    {"speaker": "HOST", "text": "...", "direction": "energetic"},
    {"speaker": "EXPERT", "text": "...", "direction": "thoughtful"}
  ],
  "soundCues": [
    {"type": "intro", "prompt": "warm upbeat podcast intro jingle with soft chimes", "durationSeconds": 3, "insertAfterTurn": -1},
    {"type": "transition", "prompt": "subtle whoosh transition sound", "durationSeconds": 1, "insertAfterTurn": 8},
    {"type": "outro", "prompt": "gentle melodic podcast outro with fade", "durationSeconds": 4, "insertAfterTurn": 20}
  ]
}

The "direction" field is optional — only include it when the delivery should notably shift from conversational default.
The "insertAfterTurn" field is the 0-based index; use -1 to insert before the first turn.

Only return the JSON object, nothing else.
```

### Tone-Specific Instructions

The system prompt dynamically injects tone guidance based on the discovery metadata:

| Tone Value     | Injected Instruction                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `casual`       | "Keep it light, use humor freely, casual language, pop culture references"                                 |
| `professional` | "Maintain a professional but warm tone, with occasional humor to keep it engaging"                         |
| `socratic`     | "Use the Socratic method -- HOST asks probing questions that build on each other, EXPERT guides discovery" |
| `storytelling` | "Frame everything as a narrative -- characters, conflict, resolution. Make facts feel like plot points."   |

### Design Rationale

**Two speakers with distinct roles:** The HOST represents the listener (curious, relatable) while the EXPERT provides knowledge. This creates natural dynamics: the HOST asks the questions the listener would ask, and the EXPERT answers them. This is more engaging than a monologue or two equal voices.

**Delivery directions:** Directions like `(laughing)` and `(excited)` are stripped before sending text to ElevenLabs TTS but inform the overall tone. Some TTS models can interpret SSML-style directions; the text itself is written to sound natural when read with the indicated emotion.

**Sound effect cues:** Sound cues are separated into a `soundCues` array rather than inline markers because they need to be processed differently in the audio pipeline. The `insertAfterTurn` index tells the audio stitching worker exactly where to place the generated sound effect.

**Word count targeting:** The prompt uses `durationTarget * 150` as the approximate word count. At normal speech rate (~150 words per minute), this produces audio close to the target duration.

**JSON-only output:** The prompt explicitly asks for "only the JSON object, nothing else" to minimize parsing failures. The parser includes fallback logic to extract JSON from markdown code blocks or mixed text if the model wraps it.

### User Message Format

The user message sent alongside the system prompt:

```
Topic: {topic}
Depth: {depth}

Source material:
{sourceContent (truncated to 8000 chars)}
```

Source material is optional and only included when the user provided a URL or PDF.

### Expected Output Format

```json
{
  "turns": [
    {
      "speaker": "HOST",
      "text": "So I've been hearing a lot about quantum computing lately, and honestly, I feel like most explanations either go way over my head or are so simplified they don't actually explain anything. Can we fix that today?",
      "direction": "energetic"
    },
    {
      "speaker": "EXPERT",
      "text": "Absolutely. And here's the thing most people get wrong right from the start — quantum computing isn't just faster classical computing. It's a completely different way of processing information. Think of it this way...",
      "direction": "leaning in"
    },
    {
      "speaker": "HOST",
      "text": "Wait, so it's not just about speed?",
      "direction": null
    },
    {
      "speaker": "EXPERT",
      "text": "Not at all. Classical computers are like reading a book one page at a time. Quantum computers... imagine being able to read every page simultaneously. But — and this is the crucial part — only if you ask the right question.",
      "direction": "thoughtful"
    }
  ],
  "soundCues": [
    {
      "type": "intro",
      "prompt": "warm upbeat podcast intro jingle with soft chimes and gentle bass",
      "durationSeconds": 3,
      "insertAfterTurn": -1
    },
    {
      "type": "transition",
      "prompt": "subtle electronic whoosh transition",
      "durationSeconds": 1,
      "insertAfterTurn": 8
    },
    {
      "type": "outro",
      "prompt": "gentle melodic podcast outro with piano fade",
      "durationSeconds": 4,
      "insertAfterTurn": 20
    }
  ]
}
```

### Output Types

```typescript
export type ScriptTurn = {
  speaker: 'HOST' | 'EXPERT';
  text: string;
  direction?: string;
};

export type SoundCue = {
  type: 'intro' | 'transition' | 'outro' | 'ambient';
  prompt: string;
  durationSeconds: number;
  insertAfterTurn: number;
};
```

### Fallback Handling

If the model fails to produce valid JSON, the parser attempts three recovery strategies in order:

1. Parse the entire response as JSON directly
2. Extract a JSON object from the response using regex (`/\{[\s\S]*\}/`)
3. Extract a JSON array (backward compatibility for older format without sound cues)

If sound cues are missing or empty, default intro and outro cues are injected:

```typescript
if (!parsed.soundCues || parsed.soundCues.length === 0) {
  parsed.soundCues = [
    {
      type: 'intro',
      prompt: 'warm podcast intro jingle with soft chimes',
      durationSeconds: 3,
      insertAfterTurn: -1,
    },
    {
      type: 'outro',
      prompt: 'gentle melodic podcast outro with fade out',
      durationSeconds: 4,
      insertAfterTurn: parsed.turns.length - 1,
    },
  ];
}
```

---

## 3. Q&A Interaction

**File:** `src/workers/interaction.worker.ts`

**Purpose:** Answer a user's question during podcast playback using the script context and the user's position in the podcast.

### Full System Prompt

```
You are Sotto's Q&A assistant. The user is listening to a podcast and paused to ask a question.
Answer concisely and helpfully, using the podcast context. Keep answers under 200 words.
```

### User Message Format

```
Recent podcast context:
HOST: [text of recent turn 1]
EXPERT: [text of recent turn 2]
HOST: [text of recent turn 3]
EXPERT: [text of recent turn 4]
HOST: [text of recent turn 5]

User's question: [the question they asked]
```

### Design Rationale

**Deliberately concise prompt:** Unlike the discovery and script prompts, the Q&A prompt is intentionally minimal. The user has paused their podcast to ask a quick question. They want a short, clear answer, not a lengthy explanation. The 200-word limit enforces this.

**Context window:** The worker calculates which turns the user has heard based on the playback timestamp and provides the last 5 turns as context. This gives the model enough context to understand what was being discussed at the point the user paused, without overwhelming it with the entire script.

**Position calculation:** The approximate position in the script is calculated from the timestamp:

```typescript
// Approximate: ~10 seconds per turn on average
const contextTurns = turns.slice(0, Math.min(turns.length, Math.ceil(timestamp / 10)));
const recentContext = contextTurns
  .slice(-5)
  .map((t) => `${t.speaker}: ${t.text}`)
  .join('\n');
```

This is a rough approximation. Each turn averages about 10 seconds of audio, so dividing the timestamp by 10 gives an approximate turn index. The last 5 turns from that position provide the relevant context.

### Expected Output Format

Plain text answer, no special formatting. For example:

```
Great question! The "observer effect" in quantum mechanics doesn't mean a conscious observer is needed.
It refers to the fact that measuring a quantum system requires interacting with it — usually by
bouncing photons off it — which inevitably disturbs its state. It's more about the physical act
of measurement than about human observation. The podcast was about to get into this distinction
with the double-slit experiment example.
```

### Resolution Flow After Answer

After the interaction worker produces an answer, the user is presented with a resolution flow:

1. "Was that clear?" (Yes / No)
2. If Yes: "Want me to update the podcast with this explanation?" (Yes / No)
3. If Yes: triggers the segment regeneration worker

---

## 4. Segment Regeneration

**File:** `src/workers/segment-regeneration.worker.ts`

**Purpose:** Generate new script content to be inserted into an existing podcast, incorporating the answer to a user's question. The new content is then sent through TTS and stitched into the podcast audio.

### Context

The segment regeneration worker does not use a separate Claude prompt. Instead, it receives pre-generated text (the answer from the interaction worker, adapted for the podcast format) and processes it through the audio pipeline:

1. Creates a new `Segment` record with the text and speaker assignment
2. Generates TTS audio via ElevenLabs using the appropriate voice
3. Uploads the audio to R2 storage
4. Reorders all segments in the podcast to place the new content at the correct position
5. Marks the interaction as `INCORPORATED`
6. Sets the podcast status back to `READY`

### Text Preparation

Before the segment regeneration worker runs, the Q&A answer is adapted from its raw form into podcast-script format. This adaptation happens in the API route that queues the regeneration job. The adapted text follows the same two-voice format:

```
HOST: That actually reminds me of a question someone asked — what about the observer effect? Does it really require a conscious observer?

EXPERT: Ah, that's one of the biggest misconceptions in quantum mechanics. The answer is no — it's about physical interaction, not consciousness. When we say "observation" in physics, we mean bouncing a photon off something to detect it. That interaction is what changes the quantum state.
```

### Insertion Logic

The new segment is inserted at a fractional order position (`insertAfterOrder + 0.5`) to place it between existing segments without renumbering them upfront:

```typescript
const segment = await prisma.segment.create({
  data: {
    podcastId,
    speaker,
    text: newText,
    order: insertAfterOrder + 0.5, // Temporary fractional position
  },
});
```

After insertion, all segments are fetched in order and renumbered to clean integer positions:

```typescript
const allSegments = await prisma.segment.findMany({
  where: { podcastId },
  orderBy: { order: 'asc' },
});

for (let i = 0; i < allSegments.length; i++) {
  await prisma.segment.update({
    where: { id: allSegments[i].id },
    data: { order: i },
  });
}
```

After segment insertion and reordering, the audio stitching worker re-runs to produce an updated final MP3 with the new content included at the correct position.

### Worker Payload

```typescript
export interface RegenerateSegmentPayload {
  podcastId: string;
  interactionId: string;
  insertAfterOrder: number; // Position in segment sequence to insert after
  newText: string; // The adapted podcast-format text
  speaker: 'HOST' | 'EXPERT';
}
```

---

## Prompt Design Principles

The following principles guided the design of all Sotto prompts:

### 1. Role Clarity

Each prompt starts with a clear role definition ("You are Sotto's podcast discovery agent", "You are a world-class podcast script writer"). This anchors the model's behavior and prevents drift toward generic assistant responses.

### 2. Structured Output

Every prompt that produces structured data specifies the exact output format with examples. The discovery prompt uses `[METADATA]...[/METADATA]` delimiters. The script prompt asks for JSON-only output. This minimizes parsing failures and makes the output deterministic.

### 3. Constraints Over Instructions

Instead of saying "try to be concise," the prompts specify concrete constraints: "Keep answers under 200 words," "Ask ONE question at a time," "Target approximately {duration} minutes." Concrete limits produce more consistent results than vague guidance.

### 4. User Context

The prompts remind the model about the user's context: "this is a mobile-first app used while commuting" (discovery), "the user paused their podcast" (Q&A). This context shapes the model's response length, tone, and assumptions about what the user needs.

### 5. Tone as a Parameter

Tone is not hardcoded into the prompts. It is treated as a parameter (`casual`, `professional`, `socratic`, `storytelling`) that injects different instructions into the script generation prompt. This allows the same prompt infrastructure to produce dramatically different podcast styles.

### 6. Graceful Degradation

All prompt parsers include fallback logic. If JSON parsing fails, they try regex extraction. If metadata is missing, defaults are used. If sound cues are absent, default intro/outro cues are injected. The system should never fail completely due to unexpected model output.

---

## Cost Tracking

All Claude API usage is logged for cost analysis:

```typescript
export async function logApiUsage(params: {
  podcastId?: string;
  userId?: string;
  category: string;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
}): Promise<void> {
  // Claude Sonnet 4.5 pricing
  const inputCost = (params.inputTokens / 1_000_000) * 3.0; // $3.00 per million input tokens
  const outputCost = (params.outputTokens / 1_000_000) * 15.0; // $15.00 per million output tokens

  logger.info('AI API usage', {
    category: params.category,
    inputTokens: String(params.inputTokens),
    outputTokens: String(params.outputTokens),
    totalCost: String(inputCost + outputCost),
  });
}
```

### Cost Per Operation

| Operation                                  | Avg Input Tokens | Avg Output Tokens | Avg Cost |
| ------------------------------------------ | ---------------- | ----------------- | -------- |
| Discovery chat (per exchange)              | ~500             | ~200              | $0.0045  |
| Discovery chat (full session, 5 exchanges) | ~2,500           | ~1,000            | $0.0225  |
| Script generation (10 min podcast)         | ~1,500           | ~3,000            | $0.0495  |
| Script generation (30 min podcast)         | ~2,000           | ~8,000            | $0.126   |
| Q&A interaction                            | ~800             | ~300              | $0.0069  |
| Segment regeneration text prep             | ~600             | ~400              | $0.0078  |

These costs are logged to the `ApiUsageLog` table and tracked per user, per podcast, and per operation category for unit economics analysis.
