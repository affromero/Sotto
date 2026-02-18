# Discovery Chat Flow

> The complete discovery chat UX: from opening the Create page through conversational topic exploration, chip suggestions, metadata extraction, podcast recommendations, to generation kickoff.

**Date:** 2026-02-08

---

## Overview

Sotto uses a **chat-based discovery flow** instead of traditional forms or wizards. When a user opens the Create page (`/create`), they enter a conversation with Sotto's AI discovery agent. The agent asks questions one at a time with tappable chip suggestions, adapts its follow-ups based on user responses, extracts structured metadata, searches for existing similar podcasts, and ultimately kicks off podcast generation.

This approach was chosen because:

1. It feels natural and low-friction, especially on mobile
2. Users often do not know exactly what they want until they talk it through
3. The conversational format lets the AI adapt (skip questions for experts, probe deeper for vague topics)
4. Tappable chips make it fast for users on the go (car, commute, walking)

---

## State Machine

The discovery flow is modeled as a state machine with six states:

```
                    +-----------+
                    |   IDLE    |  User opens /create
                    +-----+-----+
                          |
                          | Agent sends greeting
                          v
                    +-----------+
              +---->| EXPLORING |  Agent asks questions, user responds
              |     +-----+-----+
              |           |
              |           | Agent has enough info (3-5 exchanges)
              |           v
              |     +-----------+
              +-----| SEARCHING |  Agent searches for similar podcasts
                    +-----+-----+
                          |
                          | Results found / no results
                          v
                    +----------------+
                    | RECOMMENDING   |  Agent shows recommendations (if any)
                    +-----+----------+
                          |
                          | User says "Create mine" or confirms
                          v
                    +-----------+
                    | CONFIRMING|  Agent summarizes + shows metadata
                    +-----+-----+
                          |
                          | User confirms
                          v
                    +------------+
                    | GENERATING |  Job queued, progress shown
                    +------------+
```

### State Descriptions

| State          | What Happens                                                                                                                                       | Transitions To                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `IDLE`         | User opens `/create`. Agent sends the opening greeting.                                                                                            | `EXPLORING`                                                                      |
| `EXPLORING`    | Agent asks questions one at a time (topic, depth, audience, focus, tone, duration). User responds via chips or free text. Agent adapts follow-ups. | `SEARCHING` (when enough info gathered) or stays in `EXPLORING`                  |
| `SEARCHING`    | Agent searches public podcasts for similar content using the topic extracted so far.                                                               | `RECOMMENDING` (if results found) or `CONFIRMING` (if no results)                |
| `RECOMMENDING` | Agent presents 1-5 similar podcasts with creator info, play counts, and duration. Offers chips to listen, explore creators, or create a new one.   | `EXPLORING` (if user wants changes) or `CONFIRMING` (if user says "Create mine") |
| `CONFIRMING`   | Agent summarizes what it will create and emits the `[METADATA]` block. User confirms or requests changes.                                          | `GENERATING` (on confirmation) or `EXPLORING` (if user wants changes)            |
| `GENERATING`   | Podcast creation jobs are queued. The UI switches to a progress view showing the pipeline stages.                                                  | Complete (user redirected to `/podcast/[id]` when ready)                         |

---

## Conversation Flow

### Opening Exchange

The agent always starts with the same pattern: a warm greeting followed by an open-ended topic question.

```
Agent: Hey! What are you curious about today? I'll create a podcast just for you.

[chips: AI & Machine Learning · History · Science · Business · Philosophy · Something else]
```

The opening chips cover the most popular broad categories. They serve as inspiration, not constraints. The user can type anything.

### Audience (Content Rating)

After the topic, the agent asks about the intended audience:

```
Agent: Who's this for?

[chips: Kids (6-10) · Teens (11-16) · Family-friendly · General · Nerds/enthusiasts · Mature]
```

This determines the content rating and language filter applied during script generation. The `audience` field maps to content safety levels in the generation pipeline.

### Topic Exploration (1-2 exchanges)

After the user states a topic, the agent may probe for specificity:

```
User: "I want to learn about black holes"

Agent: Black holes! Fascinating topic. Any particular angle you're interested in?
Like the physics of event horizons, or how they're detected, or the recent
images from the Event Horizon Telescope?

[chips: How they form · Event horizon physics · Detection methods · Recent discoveries]
```

If the user's initial topic is already specific ("I want to understand how attention mechanisms work in transformer neural networks"), the agent skips this probing step.

### Depth Question

```
Agent: How deep do you want to go?

[chips: Quick overview (5 min) · Standard (10 min) · Deep dive (20+ min)]
```

### Audience Level

```
Agent: What's your background with this topic?

[chips: Total beginner · Some knowledge · I'm an expert]
```

If the user selects "I'm an expert," the agent adapts: it skips overly basic options in subsequent questions and focuses on advanced angles.

### Focus Areas

```
Agent: Any specific angle you'd like me to focus on?

[chips: The math behind it · Intuitive explanations · Real-world applications · Historical development]
```

This question is sometimes combined with the topic exploration if the user already indicated a specific angle.

### Tone

```
Agent: Last thing — what vibe do you want?

[chips: Casual & fun · Professional · Socratic (lots of questions) · Storytelling]
```

### Duration (Optional)

Duration is often inferred from the depth selection:

- Quick overview = 5-8 minutes
- Standard = 10-15 minutes
- Deep dive = 20-30 minutes

The agent only explicitly asks about duration if the inferred value might not match expectations.

---

## Chip Generation Logic

Chips are embedded in the agent's response using the format `[chips: Option A · Option B · Option C]`. The client-side parser extracts them.

### Parsing

```typescript
export function parseChips(message: string): { text: string; chips: string[] } {
  const chipMatch = message.match(/\[chips:\s*(.+?)\]/);
  if (!chipMatch) {
    return { text: message, chips: [] };
  }
  const chips = chipMatch[1].split('·').map((c) => c.trim());
  const text = message.replace(/\[chips:\s*.+?\]/, '').trim();
  return { text, chips };
}
```

### Chip Design Rules

| Rule                       | Rationale                                                       |
| -------------------------- | --------------------------------------------------------------- |
| 2-4 chips per message      | More than 4 creates decision paralysis on mobile                |
| Short labels (1-4 words)   | Chips must fit in a horizontal scrollable row                   |
| Mutually exclusive options | Chips represent distinct choices, not overlapping concepts      |
| No "Other" chip            | Free text input is always available; an "Other" chip adds noise |
| Action-oriented language   | "Quick overview" not "Short version"                            |

### Client-Side Chip Rendering

When a chip is tapped, its label is sent as a user message:

```typescript
// When user taps a chip
function handleChipTap(chipLabel: string) {
  sendMessage(chipLabel); // Sends the chip text as if the user typed it
}
```

The agent receives the chip label as a regular user message and responds accordingly. There is no special handling on the backend; chips are a UI convenience, not a protocol.

---

## Metadata Extraction

When the agent has gathered enough information (typically 3-5 exchanges), it produces a structured metadata block in its final confirmation message.

### Metadata Format

```json
{
  "topic": "Quantum Computing",
  "depth": "standard",
  "audience": "general",
  "audience_level": "intermediate",
  "focus_areas": ["qubit intuition", "superposition", "practical applications"],
  "tone": "casual",
  "duration_target": 10,
  "source_url": "https://example.com/article",
  "ready": true
}
```

### Field Descriptions

| Field             | Type     | Values                                                            | Description                                              |
| ----------------- | -------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `topic`           | string   | Free text                                                         | The primary topic for the podcast                        |
| `depth`           | string   | `eli5`, `quick_overview`, `standard`, `deep_dive`                 | How detailed the coverage should be                      |
| `audience`        | string   | `kids`, `teens`, `family`, `general`, `nerds`, `mature`           | Content rating / target audience                         |
| `audience_level`  | string   | `beginner`, `intermediate`, `expert`                              | The listener's background knowledge                      |
| `focus_areas`     | string[] | Free text array                                                   | Specific angles or subtopics to emphasize                |
| `tone`            | string   | `casual`, `professional`, `socratic`, `storytelling`              | The conversational style                                 |
| `duration_target` | number   | 5-30                                                              | Target duration in minutes                               |
| `source_url`      | string   | URL (optional)                                                    | Included if the user shared a URL; omitted otherwise     |
| `ready`           | boolean  | `true`                                                            | Signals that metadata is complete                        |

### Extraction Function

```typescript
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

### Storage

Extracted metadata is stored in the `Discovery` model:

```prisma
model Discovery {
  id             String   @id @default(cuid())
  podcastId      String   @unique
  userId         String
  topic          String?  @db.Text
  depth          String?
  audienceLevel  String?
  focusAreas     String[]
  tone           String?
  durationTarget Int?
  priorKnowledge String?  @db.Text
  sourceUrl      String?
  sourceContent  String?  @db.Text
}
```

Individual chat messages are stored in the `DiscoveryMessage` model:

```prisma
model DiscoveryMessage {
  id          String   @id @default(cuid())
  discoveryId String
  role        String   // user, assistant, system
  content     String   @db.Text
  chips       Json?    // [{label: string, value: string}]
  createdAt   DateTime @default(now())
}
```

---

## Recommendation System

Before committing to podcast generation, the system searches for existing public podcasts on similar topics. This serves two purposes: (1) users might find an existing podcast that meets their needs, saving compute; (2) it drives social discovery and follow behavior.

### Search Logic

```typescript
// apps/web/src/lib/recommendations.ts
export async function findSimilarPodcasts(params: {
  topic: string;
  excludeUserId?: string;
  limit?: number;
}): Promise<SimilarPodcast[]> {
  const searchTerms = params.topic
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 10)
    .join(' | ');

  if (!searchTerms) return [];

  const podcasts = await prisma.podcast.findMany({
    where: {
      status: 'READY',
      visibility: 'PUBLIC',
      ...(params.excludeUserId && { userId: { not: params.excludeUserId } }),
      OR: [
        { title: { contains: params.topic, mode: 'insensitive' } },
        { topic: { contains: params.topic, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      title: true,
      topic: true,
      playCount: true,
      likeCount: true,
      duration: true,
      user: { select: { id: true, name: true, image: true } },
    },
    orderBy: [{ playCount: 'desc' }, { likeCount: 'desc' }],
    take: params.limit || 5,
  });

  return podcasts;
}
```

### Search Approach

The MVP uses PostgreSQL case-insensitive `contains` matching on the `title` and `topic` fields. The search terms are extracted by splitting the topic on whitespace and filtering out short words (2 characters or fewer). Results are ranked by play count and like count.

Future improvements planned:

- PostgreSQL full-text search with `tsvector`/`tsquery` for better relevance ranking
- Embedding-based semantic similarity using vector storage
- Tag-based matching (podcasts sharing the same tags)
- Collaborative filtering (users who liked X also liked Y)

### Recommendation Presentation

When similar podcasts are found, the agent presents them inline in the chat:

```
Agent: Before I create yours, I found some podcasts on similar topics that others have made:

  "Quantum Computing Explained" by @sarah — 12 min, beginner-friendly, 847 plays
  "Qubits and Beyond" by @physics_daily — 18 min, deep dive, 2.3k plays

Want to check one of these out first, or should I create a fresh one for you?

[chips: Listen to Sarah's · Listen to @physics_daily's · Create mine · Explore more]
```

### User Actions From Recommendations

| User Action         | System Behavior                                                          |
| ------------------- | ------------------------------------------------------------------------ |
| "Listen to Sarah's" | Navigate to `/podcast/[id]` for that podcast                             |
| "Create mine"       | Proceed to `CONFIRMING` state                                            |
| "Explore more"      | Show more results or navigate to feed with search                        |
| Follow a creator    | Create `Follow` record, return to chat                                   |
| Fork a podcast      | Create fork, open new discovery chat pre-filled with original's metadata |

---

## Message Format

### Database Schema

Each message in the discovery chat is stored as a `DiscoveryMessage`:

```typescript
interface DiscoveryMessage {
  id: string;
  discoveryId: string;
  role: 'user' | 'assistant' | 'system';
  content: string; // Full message text (including chip markers for assistant messages)
  chips: Chip[] | null; // Parsed chip options (stored as JSON)
  createdAt: Date;
}

interface Chip {
  label: string; // Display text on the chip
  value: string; // Value sent when tapped (usually same as label)
}
```

### API Request/Response

**Request:** `POST /api/discovery`

```json
{
  "content": "I want to learn about quantum computing",
  "podcastId": "clx123..."
}
```

Validated by:

```typescript
const discoveryMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  podcastId: z.string().optional(),
});
```

**Response:** Server-Sent Events (streaming)

```
data: {"type": "text", "content": "Great choice! "}
data: {"type": "text", "content": "How deep do you "}
data: {"type": "text", "content": "want to go?"}
data: {"type": "chips", "chips": ["Quick overview", "Standard", "Deep dive"]}
data: {"type": "done"}
```

The API streams the response token-by-token using Claude's streaming API. When the full message has been streamed, the server parses it for chips and metadata, then sends structured events for those.

### Streaming Architecture

```
Client (React)                   API Route                     Claude
     |                              |                             |
     |-- POST /api/discovery ------>|                             |
     |                              |-- streamResponse() -------->|
     |                              |                             |
     |<---- SSE: text chunks -------|<---- streaming tokens ------|
     |<---- SSE: text chunks -------|<---- streaming tokens ------|
     |                              |                             |
     |                              |  (stream complete)          |
     |                              |  parse chips + metadata     |
     |<---- SSE: chips -------------|                             |
     |<---- SSE: metadata ----------|  (if present)               |
     |<---- SSE: done --------------|                             |
     |                              |                             |
     |  Store message in DB         |                             |
```

---

## Full Example Session

Here is a complete discovery chat session from start to generation:

```
[State: IDLE -> EXPLORING]

Agent: Hey! What are you curious about today? I'll create a podcast just for you.
[chips: AI & Machine Learning · History · Science · Business · Philosophy · Something else]

User: "How do large language models actually work?"

[State: EXPLORING]

Agent: Great topic! LLMs are one of the most fascinating developments in tech right
now. How deep do you want to go?
[chips: Quick overview (5 min) · Standard (10 min) · Deep dive (20+ min)]

User: taps "Standard (10 min)"

[State: EXPLORING]

Agent: And what's your background? This helps me calibrate the explanations.
[chips: Total beginner · Some ML knowledge · I'm an engineer]

User: taps "Some ML knowledge"

[State: EXPLORING]

Agent: Nice — so you know the basics. Any particular angle? Like the training
process, how attention works, or why they hallucinate?
[chips: Training process · Attention mechanism · Why they hallucinate · All of the above]

User: "Focus on attention and hallucinations"

[State: EXPLORING]

Agent: Perfect. And what vibe — casual chat or more structured?
[chips: Casual & fun · Professional · Socratic]

User: taps "Casual & fun"

[State: EXPLORING -> SEARCHING]

Agent: Awesome. Let me see if anyone's already made something similar...

[State: SEARCHING -> RECOMMENDING]

Agent: I found a couple of related podcasts:

  "How GPT Actually Works" by @ml_sarah — 8 min, beginner, 1.2k plays
  "Attention Is All You Need Breakdown" by @deeplearner — 22 min, deep dive, 3.4k plays

Want to check one of these, or should I create a fresh one tailored to you?
[chips: Listen to @ml_sarah's · Listen to @deeplearner's · Create mine]

User: taps "Create mine"

[State: CONFIRMING]

Agent: Here's what I'll create:

A 10-minute, casual podcast about how large language models work, focusing on
the attention mechanism and why they hallucinate. Designed for someone who
already knows the ML basics.

Ready to go?
[chips: Create it! · Change something]

[METADATA]
{
  "topic": "How Large Language Models Work",
  "depth": "standard",
  "audience_level": "intermediate",
  "focus_areas": ["attention mechanism", "hallucinations"],
  "tone": "casual",
  "duration_target": 10,
  "ready": true
}
[/METADATA]

User: taps "Create it!"

[State: GENERATING]

Agent: On it! I'll have your podcast ready in about 2-3 minutes.
I'll send you a notification when it's done.

[UI switches to GenerationProgress component showing pipeline stages]
```

---

## Discovery to Generation Handoff

When the user confirms and the metadata is extracted, the following sequence occurs:

1. **Create Podcast record** with status `PENDING` and the topic from metadata
2. **Create Discovery record** linked to the podcast, populated with extracted metadata
3. **Save all DiscoveryMessage records** for the full chat transcript
4. **Update Podcast status** to `DISCOVERING` (then immediately to `EXTRACTING` or `SCRIPTING` depending on whether there is source content)
5. **Queue content-extraction job** (if a URL/PDF was provided in the chat)
6. **Queue script-generation job** with the discovery metadata
7. **Check generation gate via `checkGenerationGate()`** — verifies BYOK TTS key or free tier availability
8. **Return the podcast ID** to the client so it can show progress and navigate to the playback page when ready

### Pipeline Trigger

```typescript
// Simplified handoff logic
const podcast = await prisma.podcast.create({
  data: {
    userId: session.user.id,
    title: metadata.topic,
    topic: metadata.topic,
    status: 'SCRIPTING',
  },
});

const discovery = await prisma.discovery.create({
  data: {
    podcastId: podcast.id,
    userId: session.user.id,
    topic: metadata.topic,
    depth: metadata.depth,
    audienceLevel: metadata.audience_level,
    focusAreas: metadata.focus_areas,
    tone: metadata.tone,
    durationTarget: metadata.duration_target,
  },
});

// Save chat messages
await prisma.discoveryMessage.createMany({
  data: messages.map((msg) => ({
    discoveryId: discovery.id,
    role: msg.role,
    content: msg.content,
    chips: msg.chips,
  })),
});

// Queue generation
await addJob(scriptGenerationQueue, JobType.GENERATE_SCRIPT, {
  podcastId: podcast.id,
  userId: session.user.id,
  discoveryId: discovery.id,
});

// Check generation gate (BYOK key or free tier)
const gate = await checkGenerationGate(session.user.id);
if (!gate.allowed) throw new Error(gate.reason);
```

---

## Edge Cases

### User Provides Source Material (URL Handling)

If the user pastes a URL or mentions a PDF during the discovery chat, the API route pre-fetches and extracts the content before passing it to the agent. The extracted content is injected as a `[URL_CONTEXT]` block in the system prompt, so the agent can reference it naturally:

```
User: "I want a podcast about this paper: https://arxiv.org/abs/1706.03762"

Agent: I see you've shared the "Attention Is All You Need" paper — a classic!
What angle interests you most? The mathematical foundations, the architectural innovations,
or how it changed the field?
```

The URL is stored in `Discovery.sourceUrl` and the extracted text in `Discovery.sourceContent`. The content-extraction worker runs first to parse the URL/PDF content, which is then passed to the script generation worker as source material.

### Web Search Integration

The discovery agent has access to web search for current events and time-sensitive topics. When the user asks about recent news or trending subjects, the agent can search the web to ground its suggestions:

```
User: "What's the latest on the Mars mission?"

Agent: [searches web for recent Mars mission updates]
There's been some exciting news! NASA's Perseverance rover just...
Want me to focus on the recent discoveries, or the engineering behind the mission?
```

Web search is passed as a tool (`WEB_SEARCH_TOOL`) to the Claude API call. The agent decides when to use it based on the user's query.

### User Changes Mind Mid-Chat

If the user says something like "Actually, never mind, let's talk about something else," the agent resets its mental model and starts fresh. The chat messages are preserved (the full transcript is saved), but the metadata extraction restarts.

### Minimal Input

Some users provide very specific initial input that covers all dimensions:

```
User: "Make me a casual 5-minute beginner explainer about how WiFi works"
```

In this case, the agent can extract all metadata from a single message, skip to the search/confirmation step, and move quickly:

```
Agent: Got it — a quick, casual, beginner-friendly podcast about how WiFi works.
Let me check for existing ones first...
```

### User Wants to Fork an Existing Podcast

If the user chooses to fork a recommended podcast, the system:

1. Creates a new Podcast record with `forkedFromId` set to the original
2. Pre-populates a new Discovery with the original's metadata
3. Opens a new discovery chat where the agent asks "What would you like to change about this podcast?"
4. The user adjusts focus, depth, tone, or audience level
5. A new script is generated using the modified metadata
