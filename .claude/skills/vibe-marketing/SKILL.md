---
name: vibe-marketing
description: |
  Marketing playbook engine for Sotto. Generates strategy docs, weekly content calendars,
  campaign briefs, and performance analysis. Grounded in brand identity + live product state.
  Modes: /vibe-marketing playbook | weekly | campaign <name> | analyze
---

# Vibe Marketing

Marketing engine for Sotto. Turns Claude Code into a content strategist that generates playbooks, weekly calendars, campaign briefs, and analysis reports — all grounded in Sotto's brand identity and current product state.

**Thesis:** Media is the most mispriced asset right now. This skill helps you create it systematically.

## Modes

| Command | What It Does |
|---------|-------------|
| `/vibe-marketing playbook` | Master strategy document: positioning, pillars, hooks, channels, experiments |
| `/vibe-marketing weekly` | 7-day content calendar with ready-to-post content |
| `/vibe-marketing campaign <name>` | Specific campaign brief (producthunt, waitlist, referral, etc.) |
| `/vibe-marketing analyze` | Review what's working, competitor intel, course-correct |
| `/vibe-marketing` (no args) | Ask which mode to run |

---

## Step 0: Load Context (All Modes)

**Always do this first, regardless of mode.**

### 0a. Load Brand Identity

Read the brand source of truth:

```
Read: .claude/skills/vibe-marketing/sotto-brand.json
```

This contains: brand basics, voice rules, audience personas, content pillars, competitor positioning, design tokens, pricing tiers, product status, hashtags, and channel config.

### 0b. Load Product State

Read the current product state from CLAUDE.md:

```
Read: CLAUDE.md
```

Cross-reference with `product_status` in the brand JSON. The CLAUDE.md has the authoritative list of what's built, what's live, and what the tech stack is.

### 0c. Parse Mode

Parse the argument passed to the skill:

| Argument | Mode |
|----------|------|
| `playbook` | Mode 1: Playbook |
| `weekly` | Mode 2: Weekly Calendar |
| `campaign <name>` | Mode 3: Campaign Brief (extract campaign name) |
| `analyze` | Mode 4: Analyze |
| (empty) | Ask user via AskUserQuestion |

If no argument is provided, ask:

```
AskUserQuestion:
  Q1: "What would you like to create?" header="Mode"
    - "Playbook" — Master marketing strategy document
    - "Weekly Calendar" — 7 days of ready-to-post content
    - "Campaign Brief" — Strategy for a specific campaign
    - "Analyze" — Review what's working, course-correct
```

### 0d. Ensure Output Directory

Create the output directory structure if it doesn't exist:

```bash
mkdir -p docs/marketing/weekly docs/marketing/campaigns docs/marketing/analysis
```

---

## Mode 1: Playbook

Generates a comprehensive marketing strategy document. This is the master reference that all other modes draw from.

**Output:** `docs/marketing/playbook.md`

### Step 1: Research Competitors

Search for the latest on each competitor listed in `sotto-brand.json`:

```
WebSearch: "NotebookLM latest features updates 2026"
WebSearch: "Wondercraft AI podcast platform 2026"
WebSearch: "AI podcast generator tools comparison 2026"
```

Extract:
- New features or announcements
- Pricing changes
- User sentiment (complaints, praise)
- Market positioning shifts

### Step 2: Research Trending Conversations

Search for what's trending in the AI + audio space:

```
WebSearch: "AI podcast generation trending 2026"
WebSearch: "interactive audio AI 2026"
WebSearch: "text to podcast AI tools"
WebSearch: "AI voice cloning podcast creator tools"
```

Extract:
- Hot topics people care about
- Conversations Sotto can join
- Content gaps no one is filling
- Viral formats in the AI/tech space

### Step 3: Generate Positioning & Voice Guide

Using brand voice rules from `sotto-brand.json`, generate:

**Positioning Statement:**
```
For [audience] who [need], Sotto is [category] that [key benefit].
Unlike [competitor], Sotto [key differentiator].
```

**Voice Examples:** Write 3 example posts in each tone from `voice.tone_spectrum`:
- Educational
- Product
- Behind the scenes
- Engagement
- Thought leadership

**Anti-examples:** Write 3 examples of what Sotto should NEVER sound like, referencing the `voice.dont` rules.

### Step 4: Generate Content Pillars with Examples

For each pillar in `content_pillars`, generate:
- 5 post ideas with full hooks
- 2 thread outlines (Twitter/X)
- 1 long-form piece outline (newsletter/blog)
- Recommended posting frequency per pillar

**Content mix target:** No more than 30% promotional. The rest should be educational, engaging, or behind-the-scenes.

### Step 5: Generate Hook Templates

Generate 20+ hook templates organized by type:

| Type | Description | Example |
|------|-------------|---------|
| Question | Opens with curiosity | "What if your podcast could answer questions?" |
| Statistic | Opens with a number | "The average person listens to 7 podcasts/week but remembers 10% of what they hear." |
| Story | Opens with narrative | "Yesterday I tried to explain quantum computing to my dad. Then I tweeted @sottofm..." |
| Contrarian | Challenges conventional wisdom | "Podcasts are broken. They're monologues pretending to be conversations." |
| How-to | Teaches something specific | "How to turn any research paper into an interactive podcast in 3 minutes:" |
| Social Proof | Leverages community | "This researcher turned her PhD thesis into a podcast. Her advisor asked for the link." |
| Behind the Scenes | Shows the build | "We spent 3 days on a bug that made our podcasts sound like chipmunks. Here's what happened." |
| Demo | Shows the product | "[Video/screenshot] I tweeted @sottofm 'make a podcast about black holes' and 90 seconds later..." |

Each template should:
- Be specific to Sotto's product and features
- Reference real capabilities (not vaporware)
- Include a variable `[TOPIC]` where the user can customize

### Step 6: Generate Channel Strategy

For each channel in `channels` from the brand JSON:

**Twitter/X (@sottofm):**
- Posting cadence and best times
- Content ratio (educational : product : engagement : BTS)
- Thread strategy (which pillars work best as threads)
- The @sottofm bot as a marketing flywheel (every tweet-generated podcast is organic content)
- Engagement strategy (who to reply to, what to retweet)
- Growth tactics specific to AI/tech Twitter

**Reddit:**
- Target subreddits with posting guidelines
- What works (value-first, technical depth) vs what doesn't (self-promo)
- 5 ready-to-post value posts (not ads)
- Comment strategy on relevant threads

**TikTok / Reels:**
- Video format templates (demo, before/after, reaction, tutorial)
- 5 video concepts with scripts
- Hook formulas for short-form video
- Optimal posting times and hashtags

**Newsletter / SEO:**
- Weekly newsletter structure
- 10 SEO-targeted blog post topics with search intent
- Internal linking strategy
- Lead magnet ideas

**Product Hunt:**
- Launch timeline (T-minus 4 weeks to launch day)
- Community prep checklist
- Launch day content plan
- Post-launch follow-up

### Step 7: Generate Experiment Framework

Design 5 starter experiments:

Each experiment includes:
- **Hypothesis:** What we think will work
- **Metric:** What we measure
- **Duration:** How long to run
- **Effort:** Low / Medium / High
- **Content pieces:** What to create
- **Success criteria:** What "good" looks like
- **Kill criteria:** When to stop

Example experiments:
1. @sottofm bot as viral loop (tweet → podcast → share)
2. Technical build-in-public thread series
3. Reddit value bombing (5 subreddits, 1 week)
4. Demo video on TikTok (3 formats, test which hooks)
5. Referral incentive test (free Pro month for 3 referrals)

### Step 8: Compile and Write

Compile the full playbook into a single markdown document with YAML frontmatter:

```yaml
---
type: marketing-playbook
generated: YYYY-MM-DD
product_stage: pre-launch
version: 1
---
```

**Structure:**
1. Executive Summary (1 paragraph)
2. Product Status & Key Hooks
3. Positioning & Voice Guide
4. Audience Personas
5. Content Pillars & Examples
6. Hook Templates Library
7. Channel Strategy (per channel)
8. Experiment Framework
9. Competitive Intelligence
10. Content Calendar Seed (first 2 weeks)
11. Metrics & KPIs

**Before writing:** Show a preview of the table of contents and key highlights to the user. Ask for confirmation:

```
AskUserQuestion:
  Q1: "Ready to write the playbook?" header="Confirm"
    - "Yes, write it" — Save to docs/marketing/playbook.md
    - "Let me review first" — Show the full draft before saving
```

Write to: `docs/marketing/playbook.md`

---

## Mode 2: Weekly Calendar

Generates a 7-day content calendar with fully written, copy-paste ready content.

**Output:** `docs/marketing/weekly/YYYY-WNN.md`

### Step 1: Determine Target Week

```bash
# Get current ISO week number and Monday date
date +%Y-W%V
date -d "monday" +%Y-%m-%d 2>/dev/null || date -d "next monday" +%Y-%m-%d
```

If the playbook exists, read it:
```
Read: docs/marketing/playbook.md
```

### Step 2: Research Timely Hooks

Search for current trending topics to make content timely:

```
WebSearch: "AI news this week February 2026"
WebSearch: "podcast industry news February 2026"
WebSearch: "trending tech Twitter topics today"
WebSearch: "NotebookLM updates February 2026"
```

Extract:
- Trending topics Sotto can riff on
- Competitor news to respond to
- Industry events or milestones
- Viral formats or memes to adapt

### Step 3: Generate 7-Day Calendar

For each day (Monday through Sunday), generate 2-3 content pieces.

**Each content piece must include:**

```markdown
### [Day] [Date] — [Platform] — [Time]

**Pillar:** [content pillar from brand JSON]
**Type:** Educational | Social Proof | BTS | Engagement | Product Demo | Thought Leadership
**Platform:** Twitter/X | Reddit | TikTok | Newsletter | LinkedIn

**Hook:**
> [First line / first 3 seconds — the most important part]

**Body:**
[Full text of the post. For Twitter threads, number each tweet. For TikTok, write a script with timing notes. For Reddit, write the full post body.]

**CTA:**
[What we want them to do — follow, try the bot, join waitlist, reply, share]

**Visual Spec:**
[Description of any image/video needed. Written to be passed to /generate-image or recorded as a demo. Include dimensions, style notes, and key elements.]

**Posting Notes:**
[Any context: best time to post, whether to boost, engagement strategy for replies]
```

### Daily Content Mix

| Day | Theme | Content Focus |
|-----|-------|---------------|
| Monday | Momentum | Educational + product insight to start the week |
| Tuesday | Deep Dive | Thread or long-form piece on a pillar topic |
| Wednesday | Community | Engagement post, poll, or user spotlight |
| Thursday | BTS / Builder | Behind-the-scenes of building Sotto |
| Friday | Demo Day | Product demo, feature highlight, or use case |
| Saturday | Light | Meme, relatable content, or casual engagement |
| Sunday | Reflection | Thought leadership, week recap, or teaser for next week |

### Step 4: Generate Newsletter Draft

If newsletter is in the channel strategy, generate a weekly newsletter:

**Structure:**
- Subject line (A/B test: 2 options)
- Opening hook (1-2 sentences)
- This Week in Sotto (product updates, if any)
- Featured Topic (deep dive on one pillar)
- Community Spotlight (user story or interesting podcast generated)
- Quick Links (3-5 curated links)
- CTA (try Sotto, share with a friend, reply with feedback)

### Step 5: Verify Content Mix

Run a quality check on the generated calendar:

**Content mix validation:**
- Max 30% promotional (product demos, feature announcements, CTAs to sign up)
- At least 40% educational or value-giving
- At least 15% engagement (questions, polls, community)
- At least 15% BTS / thought leadership

**Pillar balance:**
- Each of the 5 content pillars should appear at least twice in the week
- No single pillar should dominate (max 40% of content)

**Platform balance:**
- Twitter/X: 10-15 pieces/week (2-3/day)
- Reddit: 2-3 value posts/week
- TikTok/Reels: 2-3 videos/week
- Newsletter: 1/week

**Voice check:**
- Review against `voice.do` and `voice.dont` from brand JSON
- No banned words or phrases
- Tone matches the `tone_spectrum` for each content type

If any check fails, adjust the calendar before presenting.

### Step 6: Preview and Write

Show the user a summary:

```
Weekly Calendar: YYYY-WNN (Mon [date] - Sun [date])

Content pieces: [count]
- Twitter/X: [count] posts, [count] threads
- Reddit: [count] posts
- TikTok/Reels: [count] scripts
- Newsletter: 1

Content mix:
- Educational: [%]
- Product: [%]
- Engagement: [%]
- BTS: [%]

Pillars covered: [list]
Timely hooks: [list of trending topics referenced]
```

Ask for confirmation:

```
AskUserQuestion:
  Q1: "Ready to save the weekly calendar?" header="Confirm"
    - "Yes, save it" — Write to docs/marketing/weekly/YYYY-WNN.md
    - "Show me the full calendar first" — Display everything before saving
    - "Adjust something" — Let me specify what to change
```

Write to: `docs/marketing/weekly/YYYY-WNN.md` with frontmatter:

```yaml
---
type: weekly-calendar
generated: YYYY-MM-DD
week: YYYY-WNN
week_dates: "Mon YYYY-MM-DD to Sun YYYY-MM-DD"
product_stage: pre-launch
content_count: N
---
```

---

## Mode 3: Campaign Brief

Generates a detailed campaign brief for a specific marketing initiative.

**Output:** `docs/marketing/campaigns/<name>.md`

### Campaign Templates

| Campaign Name | Focus |
|--------------|-------|
| `producthunt` | Product Hunt launch day strategy + preparation timeline |
| `waitlist` | Waitlist growth mechanics (0 to N signups) |
| `referral` | Viral referral loop design |
| `feature-launch` | Single feature announcement rollout |
| `twitter-loop` | Leverage @sottofm bot as a growth loop (tweet to podcast to share) |
| `community` | Community building (Discord/Reddit/Twitter) |
| `seo` | SEO content strategy for organic discovery |
| (custom) | Any other name — ask user for details |

### Step 1: Identify Campaign

If the campaign name matches a template above, use that template's focus.

If it's a custom campaign name, ask:

```
AskUserQuestion:
  Q1: "What's the goal of this campaign?" header="Objective"
    - "Grow signups/waitlist"
    - "Launch a feature"
    - "Build community"
    - "Drive engagement"
```

### Step 2: Research

Search for relevant data based on the campaign type:

**producthunt:**
```
WebSearch: "Product Hunt launch strategy 2026 best practices"
WebSearch: "AI product Product Hunt launch tips"
WebSearch: "Product Hunt top AI launches 2026"
```

**waitlist:**
```
WebSearch: "waitlist growth strategy pre-launch 2026"
WebSearch: "viral waitlist mechanics examples"
```

**twitter-loop:**
```
WebSearch: "Twitter bot viral growth strategy"
WebSearch: "tweet to action growth loops"
```

**seo:**
```
WebSearch: "AI podcast generator SEO keywords volume"
WebSearch: "podcast creation tools search trends 2026"
```

Adapt searches for other campaign types.

### Step 3: Generate Campaign Brief

Every campaign brief follows this structure:

```markdown
# Campaign: [Name]

## Objective
[One sentence: what we're trying to achieve]

## Key Metric
[The single number we're optimizing for]

## Target Audience
[Which persona(s) from the brand JSON, plus any campaign-specific targeting]

## Timeline
[Week-by-week breakdown with milestones]

| Week | Phase | Key Actions | Goal |
|------|-------|-------------|------|
| W-4 | Prep | [actions] | [milestone] |
| W-3 | Build | [actions] | [milestone] |
| W-2 | Seed | [actions] | [milestone] |
| W-1 | Hype | [actions] | [milestone] |
| W0 | Launch | [actions] | [milestone] |
| W+1 | Follow-up | [actions] | [milestone] |

## Channel Strategy

### [Channel 1]
- **What:** [content type]
- **When:** [timing]
- **Content pieces:** [list with hooks]

### [Channel 2]
...

## Content Pieces (Fully Written)

### Piece 1: [Title]
**Platform:** [platform]
**Type:** [type]
**Timing:** [when to post]

[Full copy-paste ready content]

### Piece 2: [Title]
...

[Generate 5-10 fully written content pieces per campaign]

## Budget
[Estimated costs: ad spend, tools, design, etc. $0 if organic only]

## Success Criteria
- [Metric 1]: [target]
- [Metric 2]: [target]
- [Metric 3]: [target]

## Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [risk] | Low/Med/High | Low/Med/High | [mitigation] |

## Post-Campaign
[What to do after: retarget, analyze, iterate, scale]
```

### Campaign-Specific Additions

**producthunt:**
- Maker community prep checklist (T-4 weeks)
- Launch day hour-by-hour schedule
- Comment response templates
- Upvote strategy (ethical, within PH rules)
- Post-launch content series

**waitlist:**
- Landing page copy suggestions
- Referral mechanics (share to skip the line)
- Email sequence (confirmation → updates → launch invite)
- Social proof elements to add to the page

**twitter-loop:**
- How the @sottofm bot works (explain the existing feature)
- Content pieces that demonstrate the bot
- Viral thread templates ("I tweeted @sottofm and...")
- Engagement strategy to amplify bot-generated podcasts
- Metrics: tweets mentioning @sottofm, podcasts generated, shares

**referral:**
- Referral mechanics design
- Incentive structure (what referrers and referees get)
- Share mechanics (link, email, social)
- Viral coefficient targets

**seo:**
- Keyword research (target terms + search volume estimates)
- Content calendar (1 post/week targeting a keyword)
- On-page SEO checklist
- Internal linking strategy
- Competitor content gap analysis

### Step 4: Preview and Confirm

Show a summary of the campaign brief, then ask:

```
AskUserQuestion:
  Q1: "Ready to save the campaign brief?" header="Confirm"
    - "Yes, save it" — Write to docs/marketing/campaigns/<name>.md
    - "Show full brief first" — Display everything before saving
    - "Adjust something" — Let me specify what to change
```

### Step 5: Write

Write to: `docs/marketing/campaigns/<name>.md` with frontmatter:

```yaml
---
type: campaign-brief
campaign: <name>
generated: YYYY-MM-DD
product_stage: pre-launch
objective: "<one-line objective>"
key_metric: "<metric>"
timeline: "<duration>"
---
```

---

## Mode 4: Analyze

Reviews existing marketing content, checks competitor moves, and generates a course-correction report.

**Output:** `docs/marketing/analysis/YYYY-MM-DD.md`

### Step 1: Read Existing Content

Scan for existing marketing outputs:

```
Glob: docs/marketing/**/*.md
```

Read the most recent files:
- Latest playbook (if exists)
- Latest weekly calendar(s)
- Any campaign briefs
- Previous analysis reports

### Step 2: Research Current State

Search for Sotto mentions and competitor activity:

```
WebSearch: "sotto.fm OR sottofm OR 'sotto podcast'"
WebSearch: "NotebookLM updates news February 2026"
WebSearch: "AI podcast generator new tools 2026"
WebSearch: "@sottofm twitter"
```

### Step 3: Check Product Changes

Read CLAUDE.md to see if anything has changed since the last playbook/calendar:

```
Read: CLAUDE.md
```

Compare `product_status.whats_live` in the brand JSON with what CLAUDE.md shows. Note any new features that should be marketed.

### Step 4: Generate Analysis Report

```markdown
# Marketing Analysis — YYYY-MM-DD

## Content Audit

### What We've Published
[Summary of content from docs/marketing/weekly/]
- Total pieces: [count]
- By platform: [breakdown]
- By pillar: [breakdown]
- By type: [breakdown]

### Content Mix Health
| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Promotional | < 30% | [%] | [ok/adjust] |
| Educational | > 40% | [%] | [ok/adjust] |
| Engagement | > 15% | [%] | [ok/adjust] |
| BTS | > 15% | [%] | [ok/adjust] |

### Pillar Coverage
[Which pillars are over/under-represented]

## Competitor Intelligence

### NotebookLM
- Latest moves: [from web search]
- Our response: [what we should do]

### Other Competitors
- [Notable changes]

## Market Trends
- [Trending topics in AI/audio]
- [Opportunities to join conversations]

## Product Updates
- [New features since last analysis that need marketing]
- [Suggested content pieces for new features]

## Recommendations

### Double Down On
[What seems to be working or has high potential]

### Stop or Reduce
[What's not contributing to goals]

### New Experiments
[3 new experiments to try]

### Content Gaps
[Topics or formats we haven't tried yet]

## Next Week's Focus
[Top 3 priorities for next week's content]
```

### Step 5: Write

Write to: `docs/marketing/analysis/YYYY-MM-DD.md` with frontmatter:

```yaml
---
type: analysis-report
generated: YYYY-MM-DD
product_stage: pre-launch
previous_analysis: YYYY-MM-DD (or "none")
---
```

---

## Quality Checklist (All Modes)

Before writing any output, verify:

### Brand Voice
- [ ] Every content piece follows `voice.do` rules
- [ ] No content violates `voice.dont` rules
- [ ] No banned words: "revolutionary", "game-changing", "disruptive", "leverage", "synergy", "ecosystem", "paradigm"
- [ ] Uses "listeners", "creators", "people", or "you" — never "users"
- [ ] Tone matches `tone_spectrum` for the content type

### Accuracy
- [ ] No claims about features that don't exist (check `product_status.whats_live`)
- [ ] Features listed as building are NOT marketed as available
- [ ] Pricing is accurate (Free $0, Pro $14, Creator $29)
- [ ] Competitor references are sourced from web search, not hallucinated
- [ ] @sottofm Twitter bot is referenced correctly as an existing feature

### Content Quality
- [ ] Every piece is copy-paste ready — no placeholder text, no `[INSERT]` brackets
- [ ] Hooks are specific and compelling (not generic)
- [ ] CTAs are clear and match the content type
- [ ] Visual specs are detailed enough for `/generate-image`
- [ ] Thread tweets are each under 280 characters
- [ ] Reddit posts are value-first, not self-promotional

### Content Mix (Weekly Calendar only)
- [ ] Max 30% promotional
- [ ] Min 40% educational
- [ ] Min 15% engagement
- [ ] Min 15% BTS / thought leadership
- [ ] All 5 content pillars represented
- [ ] No single pillar > 40% of content

### Process
- [ ] User confirmation obtained before writing files
- [ ] Output directory exists
- [ ] Frontmatter is correct and complete
- [ ] File saved to correct path

---

## Integration Notes

### @sottofm Twitter Bot

The @sottofm bot is already built and live. It's both a product feature AND a marketing channel:

- **As product:** Anyone can tweet `@sottofm make a podcast about [topic]` and get a podcast back
- **As marketing:** Every bot-generated podcast is organic social proof. Quote-tweet the best ones. Create content showing the bot in action.
- **As growth loop:** User tweets @sottofm → podcast generated → user shares → their followers see → they try @sottofm

Always reference the bot in marketing content. It's the most compelling demo.

### /generate-image

Visual specs in content pieces are formatted to be passed directly to the `/generate-image` skill. When creating visual specs, include:
- Dimensions (1080x1080 for Instagram/Twitter, 1920x1080 for video thumbnails)
- Style notes (use Sotto's design tokens: amber #D97706, navy #1E3A5F, cream #FEFCF8)
- Key elements to include
- Text overlays (if any)
- Provider recommendation (Ideogram for text-heavy, FLUX for photorealistic)

### Future Integrations

When Notion MCP is available, content calendars can be synced to a Notion database. When Slack MCP is available, draft reviews can be posted for team feedback. These are not required — the skill works entirely with local markdown files.

---

## File Structure Reference

```
docs/marketing/
├── playbook.md                     # Master playbook (mode: playbook)
├── weekly/
│   ├── 2026-W07.md                 # Weekly calendars (mode: weekly)
│   ├── 2026-W08.md
│   └── ...
├── campaigns/
│   ├── producthunt.md              # Campaign briefs (mode: campaign)
│   ├── waitlist.md
│   ├── twitter-loop.md
│   └── ...
└── analysis/
    ├── 2026-02-09.md               # Analysis reports (mode: analyze)
    └── ...
```

---

## Usage

```
/vibe-marketing              # Ask which mode
/vibe-marketing playbook     # Generate master playbook
/vibe-marketing weekly       # Generate this week's content calendar
/vibe-marketing campaign producthunt   # Product Hunt launch brief
/vibe-marketing campaign waitlist      # Waitlist growth brief
/vibe-marketing campaign twitter-loop  # @sottofm bot growth loop brief
/vibe-marketing campaign seo           # SEO content strategy
/vibe-marketing campaign my-idea       # Custom campaign (will ask for details)
/vibe-marketing analyze       # Review + course-correct
```

**First run?** Start with `playbook` to establish the strategy, then `weekly` for immediate content.
