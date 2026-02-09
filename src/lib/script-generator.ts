import { generateResponse } from './claude';

export type ScriptTurn = {
  speaker: 'HOST' | 'EXPERT';
  text: string;
  direction?: string; // delivery direction: "laughing", "whispering", "excited"
};

export type SoundCue = {
  type: 'intro' | 'transition' | 'outro' | 'ambient';
  prompt: string; // text prompt for sound effect generation
  durationSeconds: number;
  insertAfterTurn: number; // index of the turn after which to insert this cue
};

export type GeneratedReference = {
  number: number;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  type: 'WEB' | 'PAPER' | 'BOOK' | 'ARTICLE' | 'VIDEO' | 'REPORT';
  publisher: string | null;
  doi: string | null;
};

/**
 * Generate a 2-voice podcast script from discovery metadata.
 * Produces natural, immersive dialogue with delivery directions, sound effect cues,
 * and inline citations backed by real references.
 */
export async function generateScript(params: {
  topic: string;
  depth: string;
  audienceLevel: string;
  focusAreas: string[];
  tone: string;
  durationTarget: number;
  sourceContent?: string;
}): Promise<{
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  markdown: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const systemPrompt = `You are a world-class podcast script writer for Sotto. Generate immersive, addictive 2-voice podcast scripts that listeners can't stop playing.

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
- ${params.tone === 'casual' ? 'Keep it light, use humor freely, casual language, pop culture references' : ''}
- ${params.tone === 'professional' ? 'Maintain a professional but warm tone, with occasional humor to keep it engaging' : ''}
- ${params.tone === 'socratic' ? 'Use the Socratic method — HOST asks probing questions that build on each other, EXPERT guides discovery' : ''}
- ${params.tone === 'storytelling' ? 'Frame everything as a narrative — characters, conflict, resolution. Make facts feel like plot points.' : ''}

## Pacing for Maximum Engagement:
- Start with a HOOK in the first 15 seconds — a surprising fact, provocative question, or bold claim
- Alternate between high-energy and reflective moments
- Every 2-3 minutes, introduce a new angle or surprising connection
- Target approximately ${params.durationTarget} minutes (~${params.durationTarget * 150} words)
- Audience level: ${params.audienceLevel}
- Focus areas: ${params.focusAreas.join(', ')}

## Inline Citations:
You MUST include inline citations in the dialogue using [N] notation (e.g. [1], [2]):
- Only cite REAL, verifiable sources — published papers, books, reputable news outlets, official reports
- Use 5-15 citations depending on depth level (more for deep_dive, fewer for quick_overview)
- HOST introduces citations conversationally: "I read that researchers at MIT found..." [3]
- EXPERT cites to back claims: "According to a 2023 study in Nature [4], the results showed..."
- Grouped citations are fine: [1,2] when multiple sources support one claim
- Do NOT invent fake citations — only include sources that actually exist or are highly plausible based on the topic

## Sound Effect Cues:
Include sound effect suggestions as [SFX: description] markers at natural transition points:
- [SFX: warm podcast intro jingle, 3s] at the very start
- [SFX: subtle transition whoosh, 1s] between major topic shifts
- [SFX: gentle outro music, 4s] at the end
- Use sparingly (3-5 per episode max) — they should enhance, not distract

## Output Format:
Return a JSON object with three arrays:
{
  "turns": [
    {"speaker": "HOST", "text": "...", "direction": "energetic"},
    {"speaker": "EXPERT", "text": "According to a 2023 study [1], ...", "direction": "thoughtful"}
  ],
  "soundCues": [
    {"type": "intro", "prompt": "warm upbeat podcast intro jingle with soft chimes", "durationSeconds": 3, "insertAfterTurn": -1},
    {"type": "transition", "prompt": "subtle whoosh transition sound", "durationSeconds": 1, "insertAfterTurn": 8},
    {"type": "outro", "prompt": "gentle melodic podcast outro with fade", "durationSeconds": 4, "insertAfterTurn": 20}
  ],
  "references": [
    {"number": 1, "title": "Study Title", "authors": ["Author A", "Author B"], "year": 2023, "url": "https://...", "type": "PAPER", "publisher": "Nature", "doi": "10.1234/..."},
    {"number": 2, "title": "Book Title", "authors": ["Author C"], "year": 2021, "url": null, "type": "BOOK", "publisher": "Publisher Name", "doi": null}
  ]
}

The "direction" field is optional — only include it when the delivery should notably shift from conversational default.
The "insertAfterTurn" field is the 0-based index; use -1 to insert before the first turn.
The "references" array must contain an entry for every [N] cited in the turns. Type must be one of: WEB, PAPER, BOOK, ARTICLE, VIDEO, REPORT.

Only return the JSON object, nothing else.`;

  const userMessage = params.sourceContent
    ? `Topic: ${params.topic}\nDepth: ${params.depth}\n\nSource material:\n${params.sourceContent.substring(0, 8000)}`
    : `Topic: ${params.topic}\nDepth: ${params.depth}`;

  const response = await generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
    maxTokens: 12288,
  });

  let parsed: { turns: ScriptTurn[]; soundCues: SoundCue[]; references: GeneratedReference[] };
  try {
    const rawParsed = JSON.parse(response.content);
    // Handle backward compat: if response is just an array, wrap it
    if (Array.isArray(rawParsed)) {
      parsed = { turns: rawParsed, soundCues: [], references: [] };
    } else {
      parsed = rawParsed;
    }
  } catch {
    // Try to extract JSON from response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      // Fallback: try parsing as just an array of turns (backward compat)
      const arrayMatch = response.content.match(/\[[\s\S]*\]/);
      const turns = arrayMatch ? JSON.parse(arrayMatch[0]) : [];
      parsed = { turns, soundCues: [], references: [] };
    }
  }

  // Ensure defaults
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

  if (!parsed.references) {
    parsed.references = [];
  }

  // Generate markdown version with delivery directions
  const markdown = parsed.turns
    .map((turn) => {
      const direction = turn.direction ? ` _(${turn.direction})_` : '';
      return `**${turn.speaker}:**${direction} ${turn.text}`;
    })
    .join('\n\n');

  return {
    turns: parsed.turns,
    soundCues: parsed.soundCues,
    references: parsed.references,
    markdown,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}
