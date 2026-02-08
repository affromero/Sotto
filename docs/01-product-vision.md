# Product Vision — Sotto

> **Date**: 2026-02-08
>
> **Summary**: Sotto is an interactive AI podcast platform that transforms any topic into a two-voice conversational podcast. Unlike static AI audio generators, Sotto lets listeners interrupt mid-playback to ask questions, get contextual answers, and optionally bake those clarifications back into the episode. A social feed enables discovery, forking, and following creators. This document defines the problem, solution, target users, personas, value proposition, and the rationale for the podcast format.

---

## 1. Problem Statement

Learning is broken across three dimensions:

### 1.1 Information Overload Without Digestion

The internet produces more content than any person can consume. A Google search for "how transformers work in AI" returns 450 million results. A YouTube search yields thousands of videos ranging from 3 minutes to 3 hours. Wikipedia articles link to dozens of prerequisite concepts. The paradox of choice means most people bookmark content they never return to, or skim articles without retaining anything meaningful.

**The gap**: There is no tool that takes a topic you are curious about, asks you smart questions about your background and goals, and produces a focused, personalized audio explanation you can absorb passively.

### 1.2 Passive Consumption Without Recourse

Traditional podcasts, audiobooks, and lectures are one-directional. When a listener encounters a concept they do not understand, they have three options: rewind and re-listen (hoping repetition helps), pause and search elsewhere (breaking flow), or keep listening and hope context fills the gap (it usually does not). None of these options are satisfactory.

**The gap**: No audio platform lets you pause, ask a question about what was just said, receive a contextual answer, and resume listening. The "interrupt and ask" interaction pattern exists in classroom learning but has never been brought to audio content.

### 1.3 Knowledge Silos

When a person learns something through a podcast, that knowledge stays with them. If they asked a great question during a lecture, that question and answer benefit only the people in the room. There is no mechanism for one listener's curiosity to improve the experience for all future listeners.

**The gap**: No platform creates a knowledge graph from listener questions, where each interaction makes the content better for everyone who comes after.

---

## 2. Solution

Sotto addresses all three problems through a single product with three core capabilities:

### 2.1 AI-Powered Podcast Generation

Users describe what they want to learn through a natural chat conversation with Sotto's AI agent. The agent asks targeted questions with tappable chip suggestions (depth, audience level, focus area, tone, duration) and extracts structured metadata. This metadata feeds into a Claude-powered script generator that produces a two-voice conversational podcast script. ElevenLabs TTS converts each segment to audio with distinct, expressive voices (one Host, one Expert), and FFmpeg stitches them into a normalized final episode.

The result: a personalized 5-30 minute podcast on any topic, tailored to the listener's exact background and interests, ready in 2-3 minutes.

### 2.2 Interactive Playback with Interrupt-and-Ask

During playback, an "Ask a Question" button sits alongside standard player controls. When tapped, the podcast pauses, a chat interface appears, and the user types or voice-inputs their question. Sotto's AI answers using the full script context, the user's discovery metadata, and the exact timestamp position in the episode.

After answering, Sotto asks: "Was that clear?" If yes, it offers: "Want me to update the podcast with this explanation?" If the user accepts, Sotto regenerates the affected segments with the clarification woven into the conversation, re-synthesizes audio, re-stitches, and updates the stored episode. The next time anyone listens, the improved version plays.

### 2.3 Social Feed and Knowledge Sharing

All public podcasts appear on a social feed with search, tag filtering, and trending sections. Users can browse by topic, listen to podcasts created by others, follow creators whose content they find valuable, like and save episodes, and fork any public podcast to create their own version with different depth, focus, or audience level.

Every question asked during interactive playback is a signal. When a concept generates many questions, it indicates a gap in the original explanation. Sotto uses this signal to suggest improvements, creating a feedback loop where community curiosity drives content quality upward over time.

---

## 3. Target Users

Sotto serves three primary user segments, each with distinct motivations but overlapping needs:

### 3.1 Curious Learners

**Who they are**: Autodidacts, students, hobbyists, and lifelong learners who regularly explore new topics outside their primary domain. They range from high school students researching college topics to retirees exploring new interests.

**What they want**: To understand complex topics without committing to a full course, textbook, or multi-hour video. They want explanations tailored to their existing knowledge level, in a format they can consume while doing other things.

**Why podcasts**: They already listen to educational podcasts (Lex Fridman, Huberman Lab, Radiolab) and wish they could ask follow-up questions. They value the intimacy and clarity of conversational explanation over reading.

**Conversion path**: Free tier (3 podcasts/month to explore) -> Pro ($19/month for unlimited interactions and longer episodes).

### 3.2 Busy Professionals

**Who they are**: Knowledge workers, engineers, managers, consultants, and executives who need to rapidly understand topics adjacent to their expertise. A product manager needs to understand a new AI technique their engineering team is adopting. A lawyer needs a primer on blockchain for a client case. A doctor needs to understand a new drug mechanism for a patient conversation.

**What they want**: Efficient, high-density learning that fits into their existing routines (commutes, workouts, cooking, walking). They want to go from "zero to conversant" on a topic in under 30 minutes, with the ability to drill deeper on specific points.

**Why podcasts**: Their screen time is maxed out. Audio is the only content format that fits into the gaps of a busy day without competing for visual attention. The conversational format makes complex topics feel approachable rather than intimidating.

**Conversion path**: Free tier (try it once during a commute) -> Pro (private podcasts for sensitive work topics, unlimited Q&A, longer episodes, downloadable MP3s for offline listening).

### 3.3 Content Creators and Educators

**Who they are**: Teachers, professors, corporate trainers, course creators, newsletter writers, YouTubers, and subject matter experts who want to repurpose their knowledge into audio content without the production overhead of traditional podcasting.

**What they want**: A way to turn their expertise into listenable content. They may provide a URL to their blog post, a PDF of their course material, or just a topic they know well, and get a polished two-voice podcast that sounds professionally produced.

**Why podcasts**: Audio content has higher engagement and completion rates than text. A blog post gets skimmed; a podcast gets listened to from start to finish. Creators want to reach the growing audience that prefers audio. The social feed gives them distribution they do not have to build themselves.

**Conversion path**: Free tier (test with one piece of content) -> Pro (20 episodes/month, voice selection, transcript export) -> Team (unlimited, API access for programmatic generation, team knowledge base).

---

## 4. User Personas

### 4.1 Priya Nair — The Curious Commuter

| Attribute | Detail |
|-----------|--------|
| **Age** | 28 |
| **Role** | UX Designer at a mid-size SaaS company |
| **Location** | Austin, TX |
| **Education** | B.A. in Psychology, self-taught design |
| **Commute** | 35 minutes each way by car |
| **Podcast habits** | Listens to 5-6 podcasts/week (design, psychology, tech culture) |
| **Tech comfort** | High — early adopter, uses Notion, Figma, ChatGPT daily |

**Background**: Priya transitioned from psychology research to UX design three years ago. She is naturally curious and regularly dives into topics tangential to her work: behavioral economics, cognitive science, AI ethics, systems thinking. She keeps a running list of "things to learn about" in a Notion doc that grows faster than she can address it.

**Goals**:
- Understand complex topics without dedicating hours to courses or textbooks
- Fill her commute with personalized learning content, not generic podcast episodes
- Be able to pause and ask "wait, what does that mean?" when she hits a concept she does not understand
- Share interesting episodes with colleagues who might benefit

**Pain points**:
- Existing educational podcasts rarely match her exact knowledge level. They are either too basic (she already knows the fundamentals) or too advanced (they assume expertise she does not have)
- When she does not understand something in a podcast, her only option is to rewind or Google it later, breaking her flow
- She has tried NotebookLM but found the output too generic and not tailored to her specific angle of interest
- YouTube tutorials require visual attention she cannot give while driving

**Sotto scenario**: Monday morning, Priya gets in her car and opens Sotto. She types "I want to understand how design systems scale at large companies." Sotto asks about her background (she selects "working designer"), her focus ("organizational challenges, not just component libraries"), and tone ("casual, with real examples"). Two minutes later, she is listening to a tailored 15-minute episode. At minute 8, the Expert mentions "design tokens" in a way she finds confusing. She taps "Ask a Question," types "Can you explain what design tokens are with a concrete example?", gets a clear answer, taps "Update podcast," and resumes. The next time she shares this episode with her team, the improved version plays.

**Tier**: Pro ($19/month) — she generates 4-6 podcasts per week and uses the Q&A feature constantly.

---

### 4.2 Marcus Chen — The Time-Pressed Executive

| Attribute | Detail |
|-----------|--------|
| **Age** | 42 |
| **Role** | VP of Engineering at a Series B fintech startup |
| **Location** | San Francisco, CA |
| **Education** | M.S. Computer Science, Stanford |
| **Schedule** | 60+ hour weeks, back-to-back meetings |
| **Podcast habits** | Listens to 2-3 podcasts/week during morning runs and airport commutes |
| **Tech comfort** | Very high — former engineer, now in leadership |

**Background**: Marcus manages a team of 45 engineers building a payments platform. His technical depth is strong but narrowing as his role becomes more strategic. His board is asking about AI integration. His team wants to adopt new infrastructure patterns he has not kept up with. His competitors are shipping features faster. He needs to stay technically credible while running a department.

**Goals**:
- Rapidly get up to speed on topics his team is discussing (vector databases, WebAssembly, post-quantum cryptography) without reading 20-page technical papers
- Prepare for board meetings by understanding business implications of technical decisions
- Have private podcasts for sensitive strategic topics he cannot discuss openly
- Download episodes for offline listening during flights

**Pain points**:
- He does not have time to watch conference talks, take courses, or read documentation
- Generic podcasts waste time on introductions and context he already has. He wants to skip straight to "what an experienced engineer needs to know"
- Existing AI tools (ChatGPT, NotebookLM) produce text he does not have bandwidth to read during his packed days
- His questions during learning are highly specific ("what are the latency implications for our use case?") and no existing tool answers them in context

**Sotto scenario**: Marcus has a board meeting Thursday about AI strategy. On his Tuesday morning run, he opens Sotto and says "Explain the current state of AI in fintech payments, including fraud detection, compliance automation, and personalization. I'm a technical executive — skip the basics." Sotto generates a 25-minute deep dive. During his run, he pauses twice to ask questions: "What's the ROI timeline for implementing this?" and "Which vendors are leading in this space?" He marks the podcast as Private, downloads the MP3, and listens again on his Wednesday flight to prepare.

**Tier**: Pro ($19/month) — private podcasts and offline downloads are essential for his use case.

---

### 4.3 Dr. Amara Osei — The Educator Amplifier

| Attribute | Detail |
|-----------|--------|
| **Age** | 36 |
| **Role** | Associate Professor of Molecular Biology, University of Michigan |
| **Location** | Ann Arbor, MI |
| **Education** | Ph.D. in Molecular Biology, postdoc at MIT |
| **Teaching load** | 2 courses/semester, 120 students total |
| **Tech comfort** | Moderate — uses Canvas LMS, comfortable with AI tools for research |

**Background**: Amara teaches undergraduate biology and a graduate seminar on CRISPR applications. She records her lectures, but students rarely re-watch 75-minute videos. She has written extensive course notes that students skim but do not deeply engage with. She wants her students to arrive at class with foundational knowledge already absorbed so that class time can focus on discussion, not exposition.

**Goals**:
- Convert her course notes and lecture slides into engaging audio content students will actually consume
- Give students a way to ask questions about the material before class (and see what questions others asked)
- Build a library of topic-specific episodes that accumulate value semester over semester
- Reach learners beyond her classroom — she has a public-facing interest in science communication

**Pain points**:
- Recording and editing a traditional podcast is too time-intensive alongside her research and teaching
- Students do not engage with static content (readings, recorded lectures) at the depth she needs
- She has no way to know which concepts students struggle with before they arrive in class
- Existing AI tools produce generic science explanations without the nuance and specificity she requires

**Sotto scenario**: Before her Monday lecture on CRISPR delivery mechanisms, Amara creates a Sotto podcast by pasting the URL to her course notes. She specifies: "My students are junior-level biology majors. Focus on the lipid nanoparticle delivery pathway. Keep it at 15 minutes. Professional tone." She shares the podcast link in Canvas. Over the weekend, 40 students listen. Twelve use the Q&A feature: "Why can't we use viral vectors for this?", "What's the size limit for the cargo?", "How does this compare to electroporation?" Amara reviews the questions before class and uses them to shape her lecture. Three of the best Q&A pairs get baked into the episode for next semester's students.

**Tier**: Team ($49/month) — she uses it across two courses with multiple TAs who also create content, and wants the analytics dashboard to track which topics generate the most questions.

---

## 5. Value Proposition

### 5.1 Core Value Statement

**Sotto turns curiosity into understanding through personalized, interactive audio.**

Unlike reading (which requires dedicated visual attention), watching (which requires a screen), or chatting with AI (which produces forgettable text), Sotto creates audio experiences that fit into the gaps of daily life and let you participate in your own learning.

### 5.2 Value by Dimension

| Dimension | What Sotto Delivers | Alternative | Why Sotto Wins |
|-----------|-------------------|-------------|---------------|
| **Personalization** | Podcast tailored to your exact background, interests, and depth preference through conversational discovery | Generic content written for an imagined average reader | No two Sotto episodes are the same, even on the same topic |
| **Format** | Two-voice conversational audio with production value (distinct voices, sound effects, natural pacing) | Monotone AI narration, text articles, video lectures | Conversational format is more engaging and retainable than monologue |
| **Interactivity** | Pause, ask, get contextual answers, update the content | Static playback with no recourse | No other audio platform offers mid-playback Q&A |
| **Convenience** | Listen anywhere — commute, workout, walk, cook, clean | Requires a screen, a desk, or dedicated study time | Audio is the only format that fits into existing routines without trade-offs |
| **Social learning** | Discover what others are learning, fork their podcasts, see community questions | Solo learning in isolation | Knowledge compounds when shared |
| **Efficiency** | 10-30 minute focused episodes, skip what you know, drill into what you do not | Hours of searching, filtering, reading, watching to extract the same knowledge | Sotto compresses the discovery-to-understanding cycle |

### 5.3 Positioning Against Alternatives

| Alternative | Sotto's Advantage |
|-------------|------------------|
| **Google search + articles** | Audio format frees your eyes and hands. Personalized to your level. No filtering needed. |
| **YouTube tutorials** | No screen required. No 30-second ads. Tailored to your exact question. Interactive Q&A. |
| **ChatGPT / Claude chat** | Audio format for passive consumption. Two-voice conversation is more engaging than chat text. Shareable and replayable. |
| **NotebookLM** | Interactive Q&A during playback. Social feed for discovery. Conversational discovery (not just document upload). Voice diversity (not the same two voices every time). |
| **Traditional podcasts** | On-demand generation of any topic. Personalized depth. Interactive Q&A. Updatable content. |
| **Online courses** | 15 minutes vs. 15 hours. Free to start. No commitment. Just-in-time learning, not just-in-case. |
| **Audiobooks** | Focused on a single topic, not a full book. Interactive. Free tier available. Updated with community Q&A. |

---

## 6. Why Podcasts Specifically

The choice of the podcast format is not arbitrary. It is a deliberate product decision grounded in four structural advantages of audio over other content formats.

### 6.1 Passive Consumption Fits Existing Behavior

Audio is the only content format that does not require dedicated time or attention. It layers onto activities people are already doing:

| Activity | Visual Content | Audio Content |
|----------|---------------|--------------|
| Driving | Impossible (dangerous) | Natural fit |
| Exercising | Awkward (holding a phone, watching while moving) | Natural fit |
| Cooking | Impractical (wet/dirty hands) | Natural fit |
| Walking | Socially isolating (face buried in screen) | Natural fit |
| Commuting (transit) | Possible but fatiguing (small screen, crowds) | Natural fit |
| Household chores | Impossible (hands occupied) | Natural fit |

The average American spends 52 minutes per day commuting, 30 minutes exercising, and 40 minutes on household tasks. That is over two hours of daily time where audio content is the only viable learning format. Sotto captures this time.

### 6.2 Conversational Format Aids Retention

Research in educational psychology consistently shows that conversational explanation (dialogue between two people) produces better learning outcomes than monologue explanation (lecture or narration). The reasons are structural:

- **Perspective switching**: When the Host asks a naive question and the Expert answers, the listener mentally follows both perspectives, which deepens processing
- **Natural scaffolding**: The Host's questions serve as checkpoints that mirror the listener's own questions, creating a sense of "this is being explained for me"
- **Emotional engagement**: Two voices create a social context that monotone narration lacks. The listener feels like they are eavesdropping on an interesting conversation, not being lectured at
- **Pacing variation**: Dialogue naturally alternates between high-density explanation and lower-density commentary, which prevents cognitive overload

Sotto's two-voice format (Host + Expert) is deliberately designed to exploit these advantages.

### 6.3 Emotional Connection Through Voice

Voice carries information that text cannot: warmth, enthusiasm, hesitation, emphasis, humor, gravity. When an Expert says "and this is where it gets really interesting..." with genuine excitement in their voice, the listener leans in. When a Host says "wait, hold on, I'm not sure I follow..." with authentic confusion, the listener feels validated in their own confusion.

ElevenLabs' TTS technology is now advanced enough to convey these emotional nuances. Sotto's script generator includes delivery directions (laughing, excited, thoughtful, leaning in) that translate into TTS parameters, producing audio that feels like a real conversation rather than a text-to-speech readout.

This emotional dimension is why podcasts have higher completion rates than articles, why podcast advertising commands premium CPMs, and why podcast listeners report stronger parasocial relationships with hosts than with any other content creator type.

### 6.4 The Podcast Market Is Massive and Growing

The global podcasting market reached $30.7 billion in 2024 and is projected to reach $131 billion by 2030, growing at a 27% CAGR. There are 584 million podcast listeners worldwide in 2025, projected to reach 619 million by 2026. Podcast listenership is growing faster than any other media format.

AI-generated audio is the fastest-growing segment within this market. Google's NotebookLM podcast feature went viral in late 2024, demonstrating massive latent demand for AI-generated conversational audio. But NotebookLM only generates static audio from uploaded documents — no interactivity, no personalization through chat, no social layer.

Sotto enters this market at the exact intersection of two massive tailwinds: podcast consumption growth and AI-generated content adoption. The timing is optimal.

---

## 7. Product Principles

These principles guide every product decision in Sotto:

### 7.1 Listener-First, Not Creator-First

Sotto is designed from the listener's perspective. The primary user is someone who wants to learn, not someone who wants to produce. Every feature is evaluated by asking: "Does this make the listening and learning experience better?" Creator tools exist to serve listeners by producing better content.

### 7.2 Conversation Over Configuration

No forms, no wizards, no settings pages with 30 toggles. Creating a podcast should feel like describing what you want to a knowledgeable friend. The discovery chat is the product's front door because natural conversation is faster and more expressive than structured input.

### 7.3 Audio-Native, Not Text-Converted

Sotto is not a text-to-speech wrapper around articles. The scripts are written specifically for audio consumption: conversational, paced for listening, with verbal signposts ("So let's break this down..."), natural transitions, and emotional variety. Reading a Sotto transcript should feel like reading a play, not an article.

### 7.4 Learning Compounds Socially

One person's question is another person's aha moment. The social feed, forking, and community Q&A are not growth hacks — they are core to the product's value. Every interaction makes the platform smarter for everyone.

### 7.5 Respect Attention, Do Not Compete for It

Sotto does not demand a screen, a desk, or dedicated study time. It fits into the cracks of a busy life. This respect for the user's existing routine is what makes the product sustainable — it does not compete with other apps for screen time because it operates in a different modality entirely.

---

## 8. Success Metrics

| Metric | Definition | 6-Month Target | 12-Month Target |
|--------|-----------|---------------|----------------|
| **Monthly Active Users** | Users who listen to at least 1 episode/month | 500 | 2,000 |
| **Podcasts Generated** | Total episodes created per month | 1,500 | 8,000 |
| **Completion Rate** | % of episodes listened to >80% | >60% | >70% |
| **Interaction Rate** | % of listening sessions where Q&A is used | >15% | >25% |
| **Update Acceptance** | % of Q&A interactions where user accepts podcast update | >30% | >40% |
| **Free-to-Pro Conversion** | % of Free users upgrading to Pro within 30 days | >5% | >8% |
| **Monthly Churn (Pro)** | % of Pro subscribers canceling per month | <12% | <8% |
| **NPS** | Net Promoter Score from in-app survey | >40 | >50 |
| **Social Engagement** | Avg likes + saves + forks per public podcast | 3 | 8 |
| **Feed Discovery Rate** | % of listening sessions initiated from the feed (vs. own content) | >20% | >35% |
