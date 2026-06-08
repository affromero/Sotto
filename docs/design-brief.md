# Sotto — Design Brief

> Brief for a brand + product designer. The goal is a full identity rehaul (logo,
> color, type, UI) anchored on one idea: **your AI agent already knows you — so
> learn a language in your own context, with the agent you already own.**

## The product, in one line
Sotto is open-source, self-hostable language-learning infrastructure: you connect
your own AI agent — the one that already knows your work, your projects, your
interests — and it teaches you a new language through the lens of your actual
life. You own the agent, the data, and the whole stack.

## The core idea (this *is* the brief)
Every other AI language app is a generic tutor that knows nothing about you on day
one and slowly harvests data about you on *their* servers. Sotto inverts it:
**your agent already knows you.** Claude Code / Codex carry months of context about
how you work and what you care about. Sotto channels that into lessons about *your*
world — you learn German by talking about the thing you shipped last week, not "the
cat is on the table."

The feeling we sell is **intimacy + ownership + intelligence** — not "an app is
studying me," but "my own assistant, who already gets me, is now teaching me to
speak." Quiet, personal, yours. The name *Sotto* (Italian *sotto voce*, "in a low,
quiet voice") is the soul of it: a tutor speaking just to you.

Three words to design toward: **Quiet. Personal. Yours.**

## Who it's for
Technical, self-directed people who already live with an AI agent (developers,
builders, founders, power users) and want to learn a language on infrastructure
they control — not rent a gamified app. Secondary: privacy-minded learners and
self-hosters.

## Brand personality
- **We are:** calm, intimate, intelligent, crafted, literary, owned, grown-up,
  confident-but-quiet.
- **We are not:** gamified, cartoonish, loud, corporate-edtech, "AI-startup purple
  gradient," surveillance-SaaS, childish, streak-shaming.

## Anti-references (please do **not** look like)
- **Duolingo** — gamified, mascot, candy colors, streak guilt.
- **Generic "AI" SaaS** — purple/blue gradients, glassmorphism, sparkles, robot
  mascots, "magic."
- **Cold enterprise edtech** — stock photography, corporate blue, blandness.

Closer in spirit (not to copy): the warmth of a great reading tool (iA Writer,
Readwise), the restraint of a focused product (Linear, Things), the personal calm
of Obsidian — but its own thing.

## Logo
Wordmark-led; the name is short and beautiful. Explore three territories:
1. **Voice / whisper (*sotto voce*)** — a mark suggesting a quiet spoken line: a
   soundwave softened to a single calm stroke, speech rendered as something
   intimate rather than a loud speech bubble.
2. **The knowledge graph** — Sotto's signature is the personal memory graph (the
   words and ideas you own as a living constellation). A mark built from a few
   connected nodes — your knowledge as a small, elegant network.
3. **The spoken mark (diacritic)** — lean into the double-t and a diacritical /
   accent mark (the visual language of pronunciation): an accent or breve over the
   wordmark that doubles as a "spoken" cue.

Must work as a 1-color favicon/app icon at 16px, a monochrome mark, and a full
wordmark. **Avoid** globes, flags, speech bubbles, graduation caps, owls.

## Color
The current build uses warm amber `#D97706` + deep navy `#1E3A5F` + soft cream
`#FEFCF8`. Keep the **warmth + paper** feeling, but you have freedom to evolve it
into something more distinctive and grown-up. Direction: a warm, paper-like,
low-glare base (cream/bone, not stark white); one confident accent (warm — amber /
terracotta / ochre, or a single deep ink); restraint over rainbow. **Dark mode is
first-class** — this audience lives in dark mode; design it as a primary theme, not
an afterthought. WCAG AA contrast throughout.

## Typography
A characterful serif for headings/voice (gives the literary, human warmth) paired
with a clean, highly legible sans for UI/body. Current: DM Serif Display + Inter —
open to a more distinctive serif. Body type must be flawless for long reading and
must render the shipped scripts perfectly: **German, Spanish, English** (umlauts,
ß, accents, ¿¡).

## The signature visual: the memory graph
Sotto's hero is the **personal vocabulary/grammar memory graph** — every word and
idea you've learned, connected, the ones due for review gently glowing. It's
Obsidian for your language brain. Make this a centerpiece of the brand (landing
hero, in-app, marketing). Design how it should *feel*: a living, personal
constellation of what you know — warm, calm, yours — not a cold data-viz.

## Product / UI + key screens to design
A focused, distraction-free learning surface. Screens to cover:
1. **Landing** — the "your agent already knows you → learn in your context" story;
   memory-graph hero; honest competitor comparison; self-host / BYOK.
2. **Onboarding** — pick a language + connect your agent; should feel like
   introducing your assistant to a new job, not filling a signup form.
3. **Learn dashboard** — your course(s), the next class, calm progress (no streaks).
4. **The class** — one ~1h unit across four skills (grammar, reading, listening,
   speaking) as a calm worksheet you fill in; mastery-gated (you can't advance
   until you pass; failed parts come back slightly different).
5. **The class on iPad** — the same worksheet, annotated with Apple Pencil.
6. **Listening player** — an adaptive podcast about *your* topics.
7. **Speaking** — record + pronunciation feedback; encouraging, never punishing.
8. **The memory graph** — interactive, the hero.

UI copy tone: warm, plain, respectful. No "Oops!", no streak-shaming, no
exclamation spam.

## Iconography / illustration / motion
- **Icons:** a thin, calm, consistent line set. No emoji.
- **Illustration (if any):** restrained, abstract/editorial, warm — not
  flat-corporate "people doing things," not 3D blobs.
- **Motion:** subtle and physical; animate transform/opacity only; respect
  `prefers-reduced-motion`; nothing bouncy or gamified.

## Deliverables
- Logo system: wordmark, mark/app icon, monochrome, favicon.
- Color system: light + dark, as tokens.
- Type scale + pairing.
- Core component kit: buttons, inputs, cards, the worksheet, the player, badges.
- The memory-graph visual treatment.
- 4–6 key screens (web + the iPad worksheet) at **375px and desktop**.
- A short brand-usage one-pager.

## Hard constraints
- Mobile-first; must hold at **375px**; iPad-first for the worksheet.
- Accessible: WCAG AA contrast, 44px touch targets, keyboard nav, semantic HTML,
  `prefers-reduced-motion`.
- Dark mode is first-class.
- **No gamification pressure** — no guilt-streaks, leaderboards, or badges-as-
  pressure. Progress is mastery: calm, personal, real.
- Renders German / Spanish / English flawlessly (diacritics, umlauts, ß, ¿¡).

## Decisions to settle (designer ↔ you)
1. **Keep the name "Sotto"?** (Recommend yes — *sotto voce* is the brand's soul.)
2. **Tone dial:** more *warm/literary* or more *sharp/tool-like (Linear-ish)*? The
   agent-owner audience leans tool-like; the personal-tutor promise leans warm —
   suggest "warm-tool": calm and crafted, not cute.
3. **How hard to foreground "your own agent"** in the *identity* vs. keep it in the
   copy/story.

---

### Bonus: condensed prompt for an AI image / moodboard tool
> Brand identity + app UI for "Sotto," an open-source language-learning tool where
> your *own* AI assistant — which already knows your work and interests — teaches
> you a language in your personal context. Mood: quiet, intimate, intelligent,
> crafted, owned; warm paper/cream base with one confident warm accent and a strong
> dark mode; literary serif + clean sans; a signature "personal memory graph" of
> glowing connected word-nodes as the hero. NOT gamified, NOT cartoon, NOT
> purple-AI-gradient, NOT corporate. Think iA Writer warmth × Linear restraint ×
> Obsidian's personal constellation. Wordmark-led logo exploring sotto-voce
> whisper, a small node-constellation, and a diacritic/accent mark.
