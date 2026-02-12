# UI Mockups — Sotto

> **Date**: 2026-02-08
>
> **Summary**: Page-by-page layout specifications for every screen in Sotto. Each section describes the layout structure, component placement, content hierarchy, and responsive behavior. No pixel-perfect images are provided; instead, structured text descriptions and ASCII layout diagrams define the spatial relationships. Designers and developers should use these specs alongside the design system (docs/04-design-system.md) to build each page.

---

## 1. Landing Page (`/`)

### 1.1 Purpose

Convert visitors into signups by demonstrating Sotto's core value: personalized, interactive AI podcasts.

### 1.2 Layout Structure

```
+============================================================+
|  [Logo: Sotto]                    [Feed] [Pricing] [Login]  |
+============================================================+
|                                                              |
|            "Podcasts that listen back."                       |
|                                                              |
|     Generate AI podcasts from any topic, interrupt to         |
|     ask questions, and share knowledge with the world.        |
|                                                              |
|     [Create Your First Podcast]    [Explore the Feed]         |
|                                                              |
+--------------------------------------------------------------+
|                                                              |
|  HOW IT WORKS                                                |
|                                                              |
|  +----------------+  +----------------+  +----------------+  |
|  | 1. CHAT        |  | 2. LISTEN      |  | 3. ASK         |  |
|  |                |  |                |  |                |  |
|  | Tell Sotto     |  | A personalized |  | Interrupt any  |  |
|  | what you want  |  | two-voice      |  | time to ask    |  |
|  | to learn.      |  | podcast,       |  | questions.     |  |
|  | It asks smart  |  | ready in       |  | Sotto answers  |  |
|  | questions.     |  | minutes.       |  | in context.    |  |
|  +----------------+  +----------------+  +----------------+  |
|                                                              |
+--------------------------------------------------------------+
|                                                              |
|  FEATURED PODCASTS FROM THE COMMUNITY                        |
|                                                              |
|  +------------------+  +------------------+  +-----------+   |
|  | [Podcast Card]   |  | [Podcast Card]   |  | [Card]    |   |
|  | Title            |  | Title            |  | Title     |   |
|  | @creator  12min  |  | @creator  8min   |  | @creator  |   |
|  | 847 plays        |  | 2.3k plays       |  | 156 plays |   |
|  | [Play]           |  | [Play]           |  | [Play]    |   |
|  +------------------+  +------------------+  +-----------+   |
|                                                              |
+--------------------------------------------------------------+
|                                                              |
|  WHAT MAKES SOTTO DIFFERENT                                  |
|                                                              |
|  +----------------------------+  +------------------------+  |
|  | Interactive Q&A            |  | Social Discovery       |  |
|  | Pause and ask questions    |  | Browse what others     |  |
|  | mid-playback. Get answers  |  | are learning. Fork     |  |
|  | in context.                |  | podcasts. Follow       |  |
|  |                            |  | creators.              |  |
|  +----------------------------+  +------------------------+  |
|  +----------------------------+  +------------------------+  |
|  | Voice Diversity            |  | Updatable Content      |  |
|  | Every podcast sounds       |  | Your questions improve |  |
|  | unique with distinct       |  | the podcast for        |  |
|  | voices and accents.        |  | everyone.              |  |
|  +----------------------------+  +------------------------+  |
|                                                              |
+--------------------------------------------------------------+
|                                                              |
|  PRICING          [See docs/pricing page for full layout]    |
|  Embedded PricingCard x4 (Free / Starter / Pro / Studio)        |
|                                                              |
+--------------------------------------------------------------+
|                                                              |
|  READY TO START LEARNING?                                    |
|                                                              |
|  [Create Your First Podcast — It's Free]                     |
|                                                              |
+--------------------------------------------------------------+
|  Footer: Sotto 2026  |  Privacy  |  Terms  |  Twitter/X     |
+--------------------------------------------------------------+
```

### 1.3 Section Details

**Navigation bar**: Fixed top. Logo (DM Serif Display, amber) left-aligned. Navigation links right-aligned: Feed, Pricing, Login. On mobile, Login becomes a button and Feed/Pricing collapse into a hamburger menu.

**Hero section**: Cream background. Headline in DM Serif Display, 48px. Subheadline in Inter, 18px, text-secondary color. Two CTAs: primary button "Create Your First Podcast" (amber, full-width on mobile) and secondary outline button "Explore the Feed." Vertical padding: 64px top, 48px bottom.

**How It Works**: Three cards in a horizontal row (single column on mobile). Each card has a step number (overline, amber), heading (h3), and body text. Cards use the standard card pattern with border and subtle shadow.

**Featured Podcasts**: Three PodcastCard components from the feed. Shows title, creator handle, duration, play count, and a play button. Horizontal scroll on mobile (snap scroll).

**What Makes Sotto Different**: 2x2 grid of feature cards (single column on mobile). Each card has an icon (Lucide), heading, and 2-sentence description.

**Pricing Preview**: Four PricingCard components side-by-side (stacked on mobile, 2x2 on tablet). Abbreviated version of the pricing page.

**Final CTA**: Full-width amber background. White text headline. Single centered button.

**Footer**: Full width, border-top. Logo, copyright, privacy/terms links, social link.

### 1.4 Responsive Behavior

| Element            | Mobile              | Tablet         | Desktop            |
| ------------------ | ------------------- | -------------- | ------------------ |
| Hero headline      | 36px, centered      | 48px, centered | 48px, left-aligned |
| Hero CTAs          | Stacked, full width | Side by side   | Side by side       |
| How It Works cards | Stacked vertically  | 3 columns      | 3 columns          |
| Featured Podcasts  | Horizontal scroll   | 2 columns      | 3 columns          |
| Feature grid       | Single column       | 2 columns      | 2 columns          |
| Pricing cards      | Stacked vertically  | 2 columns      | 4 columns          |

---

## 2. Auth Pages (`/auth/login`, `/auth/signup`)

### 2.1 Layout Structure

```
+============================================================+
|                       [Sotto Logo]                           |
+============================================================+
|                                                              |
|              +----------------------------+                  |
|              |                            |                  |
|              |   Welcome back to Sotto    |   (or "Join      |
|              |                            |    Sotto" for     |
|              |   [Continue with Google]   |    signup)        |
|              |   [Continue with GitHub]   |                  |
|              |   [Continue with Apple]    |                  |
|              |                            |                  |
|              |   -------- or --------     |                  |
|              |                            |                  |
|              |   Email                    |                  |
|              |   [_____________________]  |                  |
|              |                            |                  |
|              |   [Send Magic Link]        |                  |
|              |                            |                  |
|              |   Don't have an account?   |                  |
|              |   Sign up (link)           |                  |
|              |                            |                  |
|              +----------------------------+                  |
|                                                              |
+--------------------------------------------------------------+
```

### 2.2 Section Details

**Background**: Full page cream (`--color-background`).

**Card**: Centered vertically and horizontally. White surface card with `--shadow-md`. Max-width 420px. Padding: 32px.

**Logo**: Sotto wordmark centered above the card. DM Serif Display, amber, 28px.

**Heading**: "Welcome back to Sotto" (login) or "Join Sotto" (signup). DM Serif Display, 28px.

**OAuth buttons**: Full-width, stacked vertically, 8px gap. Each button: white background, 1px border, 44px height, provider icon left-aligned, text centered. Hover: light gray background.

**Divider**: Horizontal line with "or" text centered, text-tertiary color.

**Email input**: Standard input pattern. Label above. Full width.

**Submit button**: Full-width primary amber button. "Send Magic Link" text.

**Toggle link**: Below button. "Don't have an account? Sign up" (login page) or "Already have an account? Log in" (signup page). Text-secondary with amber link.

### 2.3 Responsive Behavior

| Element                | Mobile                  | Tablet+             |
| ---------------------- | ----------------------- | ------------------- |
| Card width             | Full width, 16px margin | Max 420px, centered |
| Card vertical position | Starts at 80px from top | Centered vertically |

---

## 3. Dashboard (`/(dashboard)/dashboard`)

### 3.1 Layout Structure

```
+----------+====================================================+
|          |  [TopBar: Dashboard          [Bell] [Avatar/Menu]]  |
| Sidebar  |=================================================== |
|          |                                                     |
| [Home]   |  Good morning, Priya.                              |
|[Discover]|                                                     |
| [Create] |  USAGE THIS MONTH                                  |
|[Billing] |  +------------------------------------------------+|
|[Settings]|  | [====........] 1 of 2 credits used    [Upgrade]||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  YOUR PODCASTS                                      |
|          |                                                     |
|          |  +------------------+  +------------------+         |
|          |  | [Podcast Card]   |  | [Podcast Card]   |         |
|          |  | Title            |  | Title            |         |
|          |  | Status: READY    |  | Status: SCRIPTING|         |
|          |  | 12 min, 3 plays  |  | Generating...    |         |
|          |  | [Play] [Share]   |  | [Progress: 45%]  |         |
|          |  +------------------+  +------------------+         |
|          |                                                     |
|          |  +------------------+                               |
|          |  | [+ Create New]   |                               |
|          |  | Start a new      |                               |
|          |  | podcast          |                               |
|          |  +------------------+                               |
|          |                                                     |
|          |  LIKED & SAVED                                      |
|          |                                                     |
|          |  +------------------+  +------------------+         |
|          |  | [Podcast Card]   |  | [Podcast Card]   |         |
|          |  +------------------+  +------------------+         |
|          |                                                     |
|          |  TRENDING TO FORK                    [See all ->]   |
|          |                                                     |
|          |  +------------------+  +------------------+         |
|          |  | Title            |  | Title            |         |
|          |  | @creator · 8 min |  | @creator · 12min |         |
|          |  | 5 forks · 847 ▶  |  | 3 forks · 234 ▶  |         |
|          |  | [Fork]           |  | [Fork]           |         |
|          |  +------------------+  +------------------+         |
|          |                                                     |
+----------+-----------------------------------------------------+
|  [MiniPlayer: Now Playing — "Transformers Intuition" ▶ ====]  |
+---------------------------------------------------------------+
```

### 3.2 Section Details

**Sidebar** (desktop only): Fixed left, 260px wide. Background: white surface. Logo at top, navigation links below. Active link has amber left border and amber text. Links: Dashboard, Discover (feed), Create. Role-dependent links follow: Analytics, Voices, Team (CREATOR/ADMIN only). Then Billing (non-admin), Settings. Admin users also see an "Admin Panel" link.

**TopBar**: Fixed top, extends right of sidebar. Page title left, notification bell and user avatar/dropdown right. Bell shows unread count badge (amber circle with white number).

**Greeting**: Personalized "Good morning/afternoon/evening, {name}." DM Serif Display, h2.

**Usage meter**: Card with progress bar. Shows "X of Y credits used this month." Progress bar fills with amber. If near limit (>80%), shows warning color. Upgrade button (outline) links to pricing page.

**Your Podcasts**: Grid of the user's own podcasts. Each card shows title, status badge (color-coded: READY=green, GENERATING_AUDIO=amber pulsing, FAILED=red), duration, play count. In-progress podcasts show a progress bar instead of play count. Empty state: single "Create New" card with plus icon.

**Liked and Saved**: Section showing podcasts the user has liked or saved from the feed. Horizontal scroll on mobile.

**Trending to Fork**: Section below Liked & Saved showing 3-4 trending public podcasts (ordered by fork count descending) with fork buttons. Each card displays title, creator handle, duration, fork count, and play count. "See all" link navigates to `/feed?sort=most_forked`. Gives users a path to fork popular content without leaving the dashboard.

**MiniPlayer**: Fixed bottom bar, full width. Shows current podcast title, play/pause, progress bar. Tapping expands to full player page.

### 3.3 Responsive Behavior

| Element      | Mobile                                        | Tablet                 | Desktop             |
| ------------ | --------------------------------------------- | ---------------------- | ------------------- |
| Sidebar      | Hidden, replaced by MobileNav at bottom       | Hidden, hamburger menu | Visible, fixed left |
| TopBar       | Simplified, logo + bell + avatar              | Full                   | Full                |
| Podcast grid | 1 column                                      | 2 columns              | 2-3 columns         |
| MobileNav    | Fixed bottom: Home, Discover, Create, Profile | Hidden                 | Hidden              |
| MiniPlayer   | Above MobileNav                               | Bottom                 | Bottom              |

**MobileNav structure**:

```
+--------+----------+--------+---------+
|  Home  | Discover | Create | Profile |
| [icon] |  [icon]  | [icon] |  [icon] |
+--------+----------+--------+---------+
```

---

## 4. Create / Discovery Chat (`/create`)

### 4.1 Layout Structure

```
+----------+====================================================+
|          |  [TopBar: Create Podcast      [Back to Dashboard]]  |
| Sidebar  |====================================================|
|          |                                                     |
|          |  +------------------------------------------------+|
|          |  |                                                ||
|          |  |  [Sotto avatar]                                ||
|          |  |  Hey! What are you curious about today?        ||
|          |  |                                                ||
|          |  |                          [User avatar]         ||
|          |  |        I want to understand how transformers   ||
|          |  |        work in AI                              ||
|          |  |                                                ||
|          |  |  [Sotto avatar]                                ||
|          |  |  Great topic! How deep should we go?           ||
|          |  |                                                ||
|          |  |  [Quick overview]  [Standard]  [Deep dive]     ||
|          |  |                                                ||
|          |  |                          [User avatar]         ||
|          |  |                              Standard          ||
|          |  |                                                ||
|          |  |  [Sotto avatar]                                ||
|          |  |  What's your background with this?             ||
|          |  |                                                ||
|          |  |  [Total beginner] [Some ML] [I'm an engineer] ||
|          |  |                                                ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  +------------------------------------------------+|
|          |  | [Type your message...]              [Send ->]  ||
|          |  +------------------------------------------------+|
|          |                                                     |
+----------+-----------------------------------------------------+
```

### 4.2 Section Details

**Chat container**: Centered, max-width 600px. Full height minus topbar and input area. Scrollable vertically. Messages appear at the bottom (newest last), auto-scroll on new message.

**Sotto messages**: Left-aligned. Small circular avatar (Sotto logo icon, amber background). Message bubble: white background, border, rounded corners (12px top-right, 12px bottom-right, 12px bottom-left, 4px top-left — indicating left-aligned origin). Font: body text, text-primary.

**User messages**: Right-aligned. User's avatar (or initials circle). Message bubble: amber background, white text. Rounded corners: 12px top-left, 4px top-right, 12px bottom-left, 12px bottom-right.

**Chip suggestions**: Appear below Sotto's message. Horizontally arranged, wrapping to next line if needed. Each chip: pill shape (border-radius: full), white background, border, text-primary. On hover: amber border, amber text. On selection: amber background, white text. After selection, chips become non-interactive (selected chip highlighted, others grayed out).

**Recommendation cards**: When Sotto finds similar podcasts, recommendation cards appear inline in the chat. Each card shows: podcast title, creator handle, duration, play count, and action buttons (Listen, Create Mine).

```
  [Sotto avatar]
  I found 2 podcasts on similar topics:

  +------------------------------------------+
  | "Transformers Explained Simply"          |
  | @maria - 12 min - 847 plays              |
  | [Listen]  [View Profile]                 |
  +------------------------------------------+
  +------------------------------------------+
  | "Attention Is All You Need Breakdown"    |
  | @deeplearner - 18 min - 2.3k plays       |
  | [Listen]  [View Profile]                 |
  +------------------------------------------+

  Want to listen to one of these, or should I
  create a fresh one for you?

  [Listen to Maria's] [Create mine] [Explore more]
```

**Input area**: Fixed at bottom of chat container. Full-width input with placeholder "Type your message..." and a send button (amber circle with arrow icon) right-aligned inside the input. On mobile, the input should use position: sticky to stay visible when the keyboard opens.

**Generation state**: After user confirms "Create mine," the chat transitions to a generation progress view:

```
  [Sotto avatar]
  On it! Here's the progress:

  +------------------------------------------+
  |  Writing the script...        [========] |
  |                                          |
  |  Estimated time: 2-3 minutes             |
  |                                          |
  |  I'll notify you when it's ready.        |
  |  You can leave this page.                |
  +------------------------------------------+
```

### 4.3 Responsive Behavior

| Element              | Mobile                        | Tablet             | Desktop            |
| -------------------- | ----------------------------- | ------------------ | ------------------ |
| Chat max-width       | Full width, 12px padding      | 600px, centered    | 600px, centered    |
| Chips                | Wrap to 2-3 rows              | Single row if fits | Single row if fits |
| Input area           | Sticky bottom, above keyboard | Fixed bottom       | Fixed bottom       |
| Recommendation cards | Full width                    | Max 500px          | Max 500px          |

---

## 5. Podcast Player (`/podcast/[podcastId]`)

### 5.1 Layout Structure

```
+----------+====================================================+
|          |  [TopBar: Podcast Title        [Share] [Options]]   |
| Sidebar  |====================================================|
|          |                                                     |
|          |  +------------------------------------------------+|
|          |  |                                                ||
|          |  |  "Transformers Intuition: How Attention        ||
|          |  |   Mechanism Actually Works"                    ||
|          |  |                                                ||
|          |  |  by @priya  ·  Created Feb 8, 2026             ||
|          |  |  [Like ♡ 12]  [Save ⊡ 3]  [Fork ⑂ 1]         ||
|          |  |                                                ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  +------------------------------------------------+|
|          |  |                                                ||
|          |  |         [Waveform Visualization]               ||
|          |  |  ▁▃▅▇▅▃▁▃▅▇█▇▅▃▁▃▅▇▅▃▁▃▅▇▅▃▁▃▅▇▅▃▁         ||
|          |  |                                                ||
|          |  |              3:42 / 12:18                       ||
|          |  |                                                ||
|          |  |     [⏪15]    [⏸ Pause]    [15⏩]              ||
|          |  |                                                ||
|          |  |     Speed: [0.5] [1x] [1.5] [2x]              ||
|          |  |                                                ||
|          |  |  +------------------------------------------+  ||
|          |  |  |  💬 Ask a Question                       |  ||
|          |  |  +------------------------------------------+  ||
|          |  |                                                ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  TRANSCRIPT                                         |
|          |                                                     |
|          |  +------------------------------------------------+|
|          |  |                                                ||
|          |  |  ▌HOST (0:00)                                  ||
|          |  |  Welcome to today's deep dive on               ||
|          |  |  transformers. I'm really excited about        ||
|          |  |  this one because...                           ||
|          |  |                                                ||
|          |  |  ▌EXPERT (0:18)                                ||
|          |  |  Thanks for having me. Let's start with       ||
|          |  |  the fundamental question: why do we           ||
|          |  |  even need transformers?                       ||
|          |  |                                                ||
|          |  |  ▌HOST (0:32)        ← currently playing       ||
|          |  |  Right, that's the key question. So            ||
|          |  |  before transformers, we had RNNs...           ||
|          |  |                                                ||
|          |  +------------------------------------------------+|
|          |                                                     |
+----------+-----------------------------------------------------+
```

### 5.2 Section Details

**Podcast header**: Card at top. Title in DM Serif Display, h2. Creator handle as link (navigates to profile). Creation date. Social action buttons: Like (heart icon + count), Save (bookmark icon + count), Fork (git-fork icon + count). Like/Save toggle states: filled icon when active.

**Player controls**: Centered within a card. Waveform visualization: horizontal bar chart where each bar's height represents audio amplitude. Bars colored amber (Host segments) and navy (Expert segments), creating a visual timeline. Current position indicated by a playhead line. The waveform is tappable/draggable to seek.

**Time display**: Current position and total duration, centered below waveform. Font: mono, caption size.

**Transport controls**: Large center button (play/pause, 56px circle, amber fill). Skip back 15s and skip forward 15s buttons flanking (40px circles, outline style).

**Speed control**: Row of speed options (0.5x, 1x, 1.5x, 2x). Current speed highlighted with amber background pill. Tapping changes playback rate.

**Ask a Question button**: Full-width, prominent. Amber outline with message-circle-question icon. Positioned below transport controls. When tapped, audio pauses and the InterruptChatPanel opens.

**InterruptChatPanel lifecycle** (component: `InterruptChatPanel`):

The panel manages a state machine with these phases:

1. **idle**: Textarea input ("Ask anything about what you just heard...") + "Ask" submit button. Both have 44px minimum touch targets. Enter submits (Shift+Enter for newline). Previous Q&A for this podcast displayed as a scrollable history list above the input.
2. **submitting**: Spinner replaces input area, input disabled. POST to `/api/podcasts/[id]/interact` with question text and current playback timestamp.
3. **polling**: Spinner continues. Polls GET `/api/podcasts/[id]/interact/[interactionId]` every 2 seconds until `status=ANSWERED`. Safety timeout at 60 seconds resets to idle with an error message.
4. **answered**: Displays Claude's answer text + ResolutionPrompt component (helpful/not helpful buttons, and for podcast owners: "incorporate into podcast" option).
5. **resolved**: If resolved, resets to idle after a brief confirmation message ("Thanks for your feedback!" or "Podcast updated!"). The new Q&A appears in the scrollable history list for reference.

```
  +------------------------------------------+
  |  Ask a Question                   [X]    |
  |                                          |
  |  Previous Q&A:                           |
  |  Q: "What does attention mean?"          |
  |  A: "In transformers, attention is..."   |
  |  (resolved)                              |
  |                                          |
  |  +--------------------------------------+|
  |  | Ask anything about what you just     ||
  |  | heard...                             ||
  |  +--------------------------------------+|
  |  [Ask]                                   |
  +------------------------------------------+
```

**ShareMenu**: Replaces the single share button in the TopBar. A dropdown menu triggered by a "Share" button (Share2 icon). Options: Copy Link (copies podcast URL, shows "Link copied!" toast), Share on X (opens Twitter intent URL), Embed (public podcasts only -- opens EmbedCodeModal with a copyable iframe snippet), Download MP3 (streams audio from R2 via `/api/podcasts/[id]/download`). Closes on outside click or Escape key.

**ForkGraph**: Visual SVG fork lineage graph. Shows ancestors as a vertical chain at top, the current podcast highlighted (amber border/fill), and forks fanning out horizontally below. Displayed when the lineage has 3+ nodes; falls back to the simpler ForkLineage list component on mobile or for small lineages. Node colors: ancestor = navy, current = amber, fork = neutral surface. Edges use bezier curves with arrowhead markers. Limits display to 3 ancestors and 5 forks. Responsive: recalculates layout on resize, uses smaller node dimensions on mobile (<768px).

**SegmentQuestionBadge**: Small pill badge rendered next to transcript segments, showing "N" with a question-mark icon. Only rendered when count > 0 and only visible to the podcast owner. Provides at-a-glance visibility into which segments are generating the most listener questions.

**Transcript panel**: Scrollable list of turns. Each turn shows: speaker label (HOST in amber, EXPERT in navy) with left border in speaker color, timestamp, and text. The currently playing turn is highlighted with a light background (speaker-color-bg). The transcript auto-scrolls to follow playback. Tapping a turn seeks to that timestamp. Podcast owners see a SegmentQuestionBadge next to each segment that has received questions.

### 5.3 Responsive Behavior

| Element             | Mobile                    | Tablet                   | Desktop                  |
| ------------------- | ------------------------- | ------------------------ | ------------------------ |
| Layout              | Single column, scrollable | Single column, max 800px | Single column, max 800px |
| Waveform            | Full width, 60px height   | Full width, 80px height  | Full width, 80px height  |
| Transport buttons   | Play: 48px, skip: 36px    | Play: 56px, skip: 40px   | Play: 56px, skip: 40px   |
| Ask Question button | Full width                | Full width               | Full width               |
| Transcript          | Below player, full height | Below player             | Side panel option        |

---

## 6. Feed (`/feed`)

### 6.1 Layout Structure

```
+----------+====================================================+
|          |  [TopBar: Discover          [Search input] [Bell]]  |
| Sidebar  |====================================================|
|          |                                                     |
|          |  TRENDING THIS WEEK                                 |
|          |  +------------------+  +---------+  +---------+    |
|          |  | [Featured Card]  |  | [Card]  |  | [Card]  |    |
|          |  | Large format     |  | Small   |  | Small   |    |
|          |  | with cover art   |  | format  |  | format  |    |
|          |  +------------------+  +---------+  +---------+    |
|          |                                                     |
|          |  BROWSE BY TOPIC                                    |
|          |  [AI/ML] [Science] [Business] [History] [Tech] ... |
|          |                                                     |
|          | [All] [Remixes]    [Recent] [Popular] [Trending] [Most Forked] |
|          |                                                     |
|          |  +------------------+  +------------------+         |
|          |  | [Podcast Card]   |  | [Podcast Card]   |         |
|          |  |                  |  |                  |         |
|          |  | Title            |  | Title            |         |
|          |  | @creator         |  | @creator         |         |
|          |  | 12 min           |  | 8 min            |         |
|          |  | ♡ 23  ▶ 847     |  | ♡ 12  ▶ 234     |         |
|          |  |                  |  |                  |         |
|          |  | [tags] [tags]    |  | [tags] [tags]    |         |
|          |  +------------------+  +------------------+         |
|          |                                                     |
|          |  +------------------+  +------------------+         |
|          |  | [Podcast Card]   |  | [Podcast Card]   |         |
|          |  +------------------+  +------------------+         |
|          |                                                     |
|          |  [Load More]                                        |
|          |                                                     |
+----------+-----------------------------------------------------+
|  [MiniPlayer]                                                  |
+---------------------------------------------------------------+
```

### 6.2 Section Details

**Search bar**: In the topbar on desktop, below the topbar as a standalone element on mobile. Standard input with search icon left, clear button right. Searches across podcast titles, topics, tags, and creator names. Results update as the user types (debounced 300ms).

**Trending section**: Horizontal row of 3-5 featured podcasts. First card is larger (spans 2 grid units on desktop). Shows cover art (generated gradient from podcast metadata colors or a default pattern), title, creator, play count. Horizontal scroll on mobile.

**Tag filter**: Horizontal row of tag chips. Each chip: pill shape, toggleable. Multiple tags can be selected (AND filter). Selected tags are amber filled. Horizontal scroll when tags overflow.

**Podcast grid**: Standard grid layout. Each PodcastCard shows:

- Podcast title (h3, DM Serif Display, truncated to 2 lines)
- Creator handle (link to profile)
- Duration badge
- Social stats: like count (heart icon), play count (play icon)
- Tags (1-3 small tag pills)
- Play button overlay on hover (amber circle with play icon)

**Sort pills**: Pill-style radio group above the grid. Options: Recent, Popular, Trending, Most Forked. Active pill uses amber fill. Alongside the sort pills, a mode toggle (also pill-style radio group) lets users switch between "All" and "Remixes" — the Remixes mode filters to show only forked podcasts.

**Pagination**: "Load More" button at bottom (cursor-based pagination). Loads 12 more podcasts per click.

### 6.3 PodcastCard Component Detail

```
+------------------------------------------+
|  [Gradient/Art Background Area]          |
|                                          |
|         [▶ Play on hover]               |
|                                          |
+------------------------------------------+
|  Title of the Podcast Episode            |
|  That Might Be Two Lines                 |
|                                          |
|  @creatorname  ·  12 min                 |
|                                          |
|  ♡ 23   ▶ 847   ⑂ 3                    |
|                                          |
|  [AI/ML]  [Transformers]                 |
+------------------------------------------+
```

The top area is a 16:9 aspect ratio block with a gradient background derived from the podcast's primary tag color. On hover, a semi-transparent overlay appears with a centered play button.

### 6.4 Responsive Behavior

| Element       | Mobile                                    | Tablet            | Desktop           |
| ------------- | ----------------------------------------- | ----------------- | ----------------- |
| Search        | Below topbar, full width                  | In topbar         | In topbar         |
| Trending      | Horizontal scroll, 1 large + peek of next | 1 large + 2 small | 1 large + 2 small |
| Tag filter    | Horizontal scroll                         | Horizontal scroll | Wrapping row      |
| Podcast grid  | 1 column                                  | 2 columns         | 3 columns         |
| Card art area | 3:2 aspect ratio                          | 16:9              | 16:9              |

---

## 7. Profile (`/profile/[userId]`)

### 7.1 Layout Structure

```
+----------+====================================================+
|          |  [TopBar: Profile             [Back]]               |
| Sidebar  |====================================================|
|          |                                                     |
|          |  +------------------------------------------------+|
|          |  |  [Avatar - 80px circle]                        ||
|          |  |                                                ||
|          |  |  Priya Nair                                    ||
|          |  |  @priya                                        ||
|          |  |                                                ||
|          |  |  UX Designer exploring the intersection of     ||
|          |  |  psychology and technology.                    ||
|          |  |                                                ||
|          |  |  23 podcasts  ·  156 followers  ·  42 following||
|          |  |                                                ||
|          |  |  [Follow]  (or [Following ✓] if already)      ||
|          |  |                                                ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  PODCASTS                    [Sort: Newest ▼]       |
|          |                                                     |
|          |  +------------------+  +------------------+         |
|          |  | [Podcast Card]   |  | [Podcast Card]   |         |
|          |  +------------------+  +------------------+         |
|          |  +------------------+  +------------------+         |
|          |  | [Podcast Card]   |  | [Podcast Card]   |         |
|          |  +------------------+  +------------------+         |
|          |                                                     |
+----------+-----------------------------------------------------+
```

### 7.2 Section Details

**Profile header**: Card with user avatar (80px circle, border: 2px solid amber if the user is the currently viewed profile owner), display name (h1, DM Serif Display), handle (@username, text-secondary), bio (body text, max 160 characters), stats row (podcasts count, followers, following), and follow button.

**Follow button**: If viewing someone else's profile: primary amber button "Follow." If already following: secondary outline button "Following" with checkmark. If viewing own profile: no follow button, instead an "Edit Profile" link.

**Podcast list**: Grid of the user's public podcasts. Same PodcastCard component as the feed. If viewing own profile, also shows unlisted and private podcasts with visibility badges.

**Stats**: Tapping "followers" or "following" opens a modal with a scrollable list of users (avatar, name, handle, follow/unfollow button).

### 7.3 Responsive Behavior

| Element      | Mobile              | Tablet             | Desktop            |
| ------------ | ------------------- | ------------------ | ------------------ |
| Avatar size  | 64px                | 80px               | 80px               |
| Profile card | Full width          | Max 600px centered | Max 600px centered |
| Stats        | Below bio, centered | Below bio, inline  | Below bio, inline  |
| Podcast grid | 1 column            | 2 columns          | 3 columns          |

---

## 8. Pricing (`/pricing`)

### 8.1 Layout Structure

```
+============================================================+
|  [Nav: Logo    Feed  Pricing  Login]                        |
+============================================================+
|                                                              |
|        Choose your plan                                      |
|        Start free, upgrade when you need more.               |
|                                                              |
|  +-------------+  +-------------+  +-------------+  +-------------+  |
|  |             |  |             |  | MOST POPULAR|  |             |  |
|  |  FREE       |  |  STARTER    |  |  PRO        |  |  STUDIO     |  |
|  |  $0/month   |  |  $9/month   |  |  $24/month  |  |  $49/month  |  |
|  |             |  |             |  |             |  |             |  |
|  |  ✓ 2 credits|  |  ✓ 5 credits|  |  ✓ 15 credits|  |  ✓ 50 credits|  |
|  |  ✓ 10 min   |  |  ✓ 10 min   |  |  ✓ 10 min   |  |  ✓ 10 min   |  |
|  |  ✓ 2 Q&As   |  |  ✓ 5 Q&As   |  |  ✓ Unlimited|  |  ✓ Unlimited|  |
|  |  ✓ Public   |  |  ✓ 1 clone  |  |  ✓ Private  |  |  ✓ Premium  |  |
|  |  ✓ Community|  |  ✓ Download |  |  ✓ Analytics|  |  ✓ Marketplace|
|  |             |  |             |  |  ✓ 3 clones |  |  ✓ 10 clones|  |
|  |             |  |             |  |  ✓ PDF export|  |  ✓ 0 premium|  |
|  |             |  |             |  |             |  |  ✓ Premium SFX|
|  |  [Start]    |  |  [Upgrade]  |  |  [Upgrade]  |  |  [Go Studio]|  |
|  |             |  |             |  |             |  |             |  |
|  +-------------+  +-------------+  +-------------+  +-------------+  |
|                                                              |
+--------------------------------------------------------------+
|                                                              |
|  COMING SOON                                                 |
|                                                              |
|  +-------------------------+  +-------------------------+    |
|  | Video Explainers [SOON] |  | Voice Cloning    [SOON] |    |
|  | AI-generated visuals    |  | Clone your own voice    |    |
|  | synced to audio         |  | as Host or Expert       |    |
|  +-------------------------+  +-------------------------+    |
|  +-------------------------+  +-------------------------+    |
|  | Course Mode      [SOON] |  | Multi-Language   [SOON] |    |
|  | Series with knowledge   |  | Generate in 29          |    |
|  | checks and progress     |  | languages               |    |
|  +-------------------------+  +-------------------------+    |
|  +-------------------------+  +-------------------------+    |
|  | Live Collab      [SOON] |  | Embed Widget     [SOON] |    |
|  | Listen together with    |  | Embeddable player       |    |
|  | shared Q&A              |  | for blogs and docs      |    |
|  +-------------------------+  +-------------------------+    |
|  +-------------------------+  +-------------------------+    |
|  | Custom Intro     [SOON] |  | Playlists        [SOON] |    |
|  | Branded podcast         |  | Curated ordered         |    |
|  | intro music             |  | collections             |    |
|  +-------------------------+  +-------------------------+    |
|                                                              |
+--------------------------------------------------------------+
|                                                              |
|  FAQ                                                         |
|                                                              |
|  [▸ What counts as a podcast?               ]                |
|  [▸ Can I cancel anytime?                   ]                |
|  [▸ What happens to my podcasts if I cancel?]                |
|  [▸ How does the Creator plan work?         ]                |
|                                                              |
+--------------------------------------------------------------+
```

### 8.2 Section Details

**Pricing cards**: Four cards side by side. Pro card is slightly elevated (larger shadow, "MOST POPULAR" badge at top in amber). Each card: white background, border, tier name (h3), price (display size, DM Serif Display), feature list (checkmarks in amber), CTA button (Free=outline, Starter=outline, Pro=primary amber, Studio=secondary accent).

**SOON badges**: Small amber pill badges next to feature names. Uses the SoonBadge component.

**Coming Soon section**: 2-column grid (single column on mobile) of feature preview cards. Each card has a feature name, SOON badge, and 1-2 sentence description. Subtle styling (lighter border, text-secondary descriptions) to indicate these are not yet available.

**FAQ section**: Accordion-style collapsible questions. Chevron icon rotates on expand. Single question open at a time. Answers appear below with slide-down animation.

### 8.3 Responsive Behavior

| Element           | Mobile             | Tablet             | Desktop            |
| ----------------- | ------------------ | ------------------ | ------------------ |
| Pricing cards     | Stacked vertically | 2 columns          | 4 columns          |
| Pro card emphasis | Amber top border   | Elevated, larger   | Elevated, larger   |
| Coming Soon grid  | 1 column           | 2 columns          | 2 columns          |
| FAQ               | Full width         | Max 700px centered | Max 700px centered |

---

## 9. Settings (`/(dashboard)/settings`)

### 9.1 Layout Structure

```
+----------+====================================================+
|          |  [TopBar: Settings]                                 |
| Sidebar  |====================================================|
|          |                                                     |
|          |  PROFILE                                            |
|          |  +------------------------------------------------+|
|          |  |  [Avatar upload]                               ||
|          |  |                                                ||
|          |  |  Name                                          ||
|          |  |  [Priya Nair________________]                  ||
|          |  |                                                ||
|          |  |  Bio                                           ||
|          |  |  [UX Designer exploring...__]                  ||
|          |  |                                                ||
|          |  |  Email                                         ||
|          |  |  priya@example.com (read-only)                 ||
|          |  |                                                ||
|          |  |  [Save Changes]                                ||
|          |  |                                                ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  NOTIFICATIONS                                      |
|          |  +------------------------------------------------+|
|          |  |  Push notifications    [Toggle: ON]             ||
|          |  |  Email notifications   [Toggle: OFF]            ||
|          |  |                                                ||
|          |  |  Notify me when:                               ||
|          |  |  ✓ My podcast is ready                         ||
|          |  |  ✓ Someone likes my podcast                    ||
|          |  |  ✓ Someone forks my podcast                    ||
|          |  |  ✓ I get a new follower                        ||
|          |  |  ✓ Similar podcast is created                  ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  PLAYBACK PREFERENCES                               |
|          |  +------------------------------------------------+|
|          |  |  Default speed:  [0.5] [1x] [1.5] [2x]        ||
|          |  |  Auto-play next: [Toggle: OFF]                 ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  CONNECTED ACCOUNTS                                 |
|          |  +------------------------------------------------+|
|          |  |  Google    Connected as priya@gmail.com         ||
|          |  |  GitHub    [Connect]                            ||
|          |  |  Apple     [Connect]                            ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  DANGER ZONE                                        |
|          |  +------------------------------------------------+|
|          |  |  [Delete Account]                              ||
|          |  |  This will permanently delete your account     ||
|          |  |  and all your podcasts.                        ||
|          |  +------------------------------------------------+|
|          |                                                     |
+----------+-----------------------------------------------------+
```

### 9.2 Section Details

**Profile section**: Card with avatar upload (click to change, circular crop), name input, bio textarea (max 160 chars with character counter), email (read-only, displayed as text), and save button.

**Avatar upload**: Clicking the avatar opens a file picker. After selection, a circular crop overlay appears. The cropped image is uploaded to R2 and the User.image field is updated.

**Notifications section**: Toggle switches for push and email notifications. Checkboxes for notification types. All changes save immediately (no save button needed — use optimistic UI).

**Playback preferences**: Speed selector (same pill-style as the player). Auto-play toggle.

**Connected accounts**: List of OAuth providers. Connected providers show the email/username. Unconnected providers show a "Connect" button.

**Danger zone**: Red-bordered card. Delete account button (red, requires confirmation modal with "Type DELETE to confirm" input).

### 9.3 Responsive Behavior

| Element  | Mobile              | Desktop                           |
| -------- | ------------------- | --------------------------------- |
| Sections | Full width, stacked | Max 600px, centered               |
| Avatar   | 64px                | 80px                              |
| Inputs   | Full width          | Full width within 600px container |

---

## 10. Billing (`/(dashboard)/billing`)

### 10.1 Layout Structure

```
+----------+====================================================+
|          |  [TopBar: Billing]                                  |
| Sidebar  |====================================================|
|          |                                                     |
|          |  CURRENT PLAN                                       |
|          |  +------------------------------------------------+|
|          |  |  Free Plan                                     ||
|          |  |  $0/month                                      ||
|          |  |                                                ||
|          |  |  1 of 2 credits used this month                ||
|          |  |  [=====...............] 50%                    ||
|          |  |                                                ||
|          |  |  Resets on March 1, 2026                       ||
|          |  |                                                ||
|          |  |  [Upgrade to Pro]  [View All Plans]            ||
|          |  |                                                ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  USAGE DETAILS                                      |
|          |  +------------------------------------------------+|
|          |  |  Credits used:      1 / 2                      ||
|          |  |  Max duration:      10 min                     ||
|          |  |  Interactions used: 2 / 4 (2 per podcast)      ||
|          |  |  Visibility:        Public only                ||
|          |  +------------------------------------------------+|
|          |                                                     |
|          |  BILLING HISTORY                                    |
|          |  +------------------------------------------------+|
|          |  |  No billing history (Free plan)                ||
|          |  +------------------------------------------------+|
|          |                                                     |
+----------+-----------------------------------------------------+
```

**For paid users, the billing section shows:**

```
          |  CURRENT PLAN                                       |
          |  +------------------------------------------------+|
          |  |  Pro Plan                                      ||
          |  |  $24/month                                     ||
          |  |                                                ||
          |  |  Next billing date: March 8, 2026              ||
          |  |  Payment method: Visa ending 4242              ||
          |  |                                                ||
          |  |  [Manage Subscription]  [Change Plan]          ||
          |  |                                                ||
          |  +------------------------------------------------+|
          |                                                     |
          |  USAGE THIS PERIOD                                  |
          |  +------------------------------------------------+|
          |  |  Credits: 8 / 15                               ||
          |  |  [==========..........] 53%                     ||
          |  |                                                ||
          |  |  Rollover: 2 / 5 max                            ||
          |  |  Interactions: 45 (unlimited per podcast)       ||
          |  +------------------------------------------------+|
          |                                                     |
          |  BILLING HISTORY                                    |
          |  +------------------------------------------------+|
          |  |  Feb 8, 2026   Pro Plan    $24.00   [Receipt]  ||
          |  |  Jan 8, 2026   Pro Plan    $24.00   [Receipt]  ||
          |  |  Dec 8, 2025   Pro Plan    $24.00   [Receipt]  ||
          |  +------------------------------------------------+|
```

### 10.2 Section Details

**Current plan card**: Shows tier name, price, usage progress bar, and billing cycle dates. Free users see upgrade CTA. Paid users see "Manage Subscription" (opens Stripe customer portal) and "Change Plan" options.

**Usage details**: Detailed breakdown of all tier limits with current usage. Progress bars for countable limits (credits, rollover). Text for non-countable limits (duration, visibility, interactions).

**Billing history**: Table of past charges with date, description, amount, and receipt link (opens Stripe-hosted receipt). Empty state for free users.

**Cancel subscription**: For paid users, a "Cancel subscription" link at the bottom. Opens a confirmation modal: "Your plan will remain active until {periodEnd}. After that, you'll be moved to the Free plan. Your existing podcasts will remain accessible."

### 10.3 Responsive Behavior

| Element         | Mobile       | Desktop       |
| --------------- | ------------ | ------------- |
| Plan card       | Full width   | Max 600px     |
| Usage details   | Stacked rows | 2-column grid |
| Billing history | Card list    | Table         |

---

## 11. Embed Player (`/podcast/[podcastId]/embed`)

### 11.1 Purpose

Lightweight, self-contained player page designed for iframe embedding on external sites (blogs, documentation, newsletters). Served with `robots: noindex` metadata to prevent search engine indexing.

### 11.2 Layout Structure

```
+--------------------------------------------------+
|  [Play/Pause]  Title of the Podcast     3:42/12:18|
|                Creator Name                       |
|  [==============================................] |
|                                                   |
|              Powered by Sotto                     |
+--------------------------------------------------+
```

### 11.3 Section Details

**Page** (`src/app/podcast/[podcastId]/embed/page.tsx`): Server component that fetches the podcast from Prisma. Returns 404 if the podcast is not READY, has no audio URL, or is PRIVATE. Renders the `EmbedPlayer` component with no app chrome (no sidebar, topbar, or navigation).

**EmbedPlayer** (`src/components/player/EmbedPlayer.tsx`): Client component with:

- **Play/pause button**: Single toggle button with play/pause SVG icons
- **Info area**: Podcast title and creator name
- **Duration display**: Current time / total duration in `M:SS` format
- **Progress bar**: Clickable/seekable progress bar. Fill color follows the design system primary
- **"Powered by Sotto" link**: Opens the full podcast page (`/podcast/[podcastId]`) in a new tab

**EmbedCodeModal** (`src/components/player/EmbedCodeModal.tsx`): Modal accessible from the ShareMenu on the full podcast page. Displays a read-only textarea with the iframe snippet:

```html
<iframe
  src="https://sotto.fm/podcast/[id]/embed"
  width="100%"
  height="160"
  frameborder="0"
  allow="autoplay"
  loading="lazy"
  style="border-radius:12px;max-width:600px"
>
</iframe>
```

Includes a "Copy Code" button with "Copied!" feedback state.

### 11.4 Constraints

- Minimum width: 300px, height: ~160px
- No navigation chrome, no sidebar, no MiniPlayer
- Only available for public podcasts in READY status
- `noindex` robots directive to avoid duplicate content in search

### 11.5 Responsive Behavior

| Element       | <300px       | 300px+            |
| ------------- | ------------ | ----------------- |
| Title         | Truncated    | Full, single line |
| Creator name  | Truncated    | Full              |
| Progress bar  | Full width   | Full width        |
| Duration text | Smaller font | Standard caption  |

---

## 12. Component Hierarchy Summary

This section maps every page to its component tree for developer reference:

### Landing Page

```
LandingPage
├── LandingNav (Logo, links, Login button)
├── HeroSection (headline, subheadline, CTAs)
├── HowItWorks (3x FeatureCard)
├── FeaturedPodcasts (3x PodcastCard)
├── DifferentiatorGrid (4x FeatureCard)
├── PricingPreview (3x PricingCard)
├── FinalCTA (headline, button)
└── Footer
```

### Dashboard

```
DashboardLayout
├── Sidebar (navigation links)
├── TopBar (title, NotificationBell, UserMenu)
├── DashboardPage
│   ├── Greeting
│   ├── UsageMeter (progress bar, upgrade CTA)
│   ├── PodcastGrid (PodcastCard[])
│   │   └── CreateCard (empty state CTA)
│   ├── LikedSavedSection (PodcastCard[])
│   └── TrendingToFork (trending public podcasts with fork buttons)
├── MobileNav (bottom navigation, mobile only)
└── MiniPlayer (if podcast playing)
```

### Create/Discovery

```
DashboardLayout
├── CreatePage
│   └── DiscoveryChat
│       ├── ChatContainer (scrollable)
│       │   ├── ChatMessage[] (Sotto + User messages)
│       │   ├── ChatChips (suggestion chips)
│       │   └── RecommendationCard[] (if matches found)
│       ├── ChatInput (text input + send button)
│       └── GenerationProgress (after "Create mine")
└── MiniPlayer
```

### Podcast Player

```
DashboardLayout
├── PodcastPage
│   ├── PodcastHeader (title, creator, social buttons)
│   │   └── ShareMenu (dropdown: Copy Link, Share on X, Embed, Download MP3)
│   │       └── EmbedCodeModal (iframe snippet with copy button)
│   ├── ForkGraph (SVG lineage visualization, shown when >=3 nodes)
│   ├── AudioPlayer
│   │   ├── Waveform (visualization)
│   │   ├── TimeDisplay
│   │   ├── PlaybackControls (skip, play/pause, speed)
│   │   └── InterruptButton ("Ask a Question")
│   ├── InterruptChatPanel (question lifecycle: idle/submitting/polling/answered/resolved)
│   │   └── ResolutionPrompt (helpful/not helpful + incorporate option)
│   └── TranscriptPanel (speaker-labeled turns, auto-scroll)
│       └── SegmentQuestionBadge (per-segment question count, owner-only)
└── MiniPlayer (hidden when full player visible)
```

### Feed

```
DashboardLayout
├── FeedPage
│   ├── SearchBar
│   ├── TagFilter (chip row)
│   ├── FilterPanel (advanced filters: depth, audience, tone, duration, date)
│   ├── ModeToggle (pill group: All / Remixes)
│   ├── SortPills (pill group: Recent / Popular / Trending / Most Forked)
│   ├── TrendingSection (featured PodcastCard[], shown only on default view)
│   ├── FeedGrid (PodcastCard[])
│   └── LoadMoreButton
└── MiniPlayer
```

### Profile

```
DashboardLayout
├── ProfilePage
│   ├── ProfileHeader (avatar, name, handle, bio, stats, follow button)
│   ├── SortDropdown
│   └── PodcastGrid (PodcastCard[])
└── MiniPlayer
```

---

## 13. Empty States

Every list and grid has a designed empty state:

| Context                   | Empty State Content                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Dashboard - My Podcasts   | Illustration of headphones. "No podcasts yet. Create your first one!" with [Create Podcast] button                          |
| Dashboard - Liked & Saved | "Podcasts you like and save will appear here. Explore the feed to discover content." with [Explore Feed] link               |
| Feed - No Results         | "No podcasts match your search. Try different keywords or browse by tag."                                                   |
| Feed - No Podcasts        | "The feed is empty. Be the first to create a podcast!" with [Create Podcast] button                                         |
| Profile - No Podcasts     | "This creator hasn't published any podcasts yet." (viewing others) or "You haven't created any podcasts yet." (viewing own) |
| Notifications             | "All caught up! You'll see notifications here when someone likes, forks, or follows."                                       |
| Billing History           | "No billing history. You're on the Free plan."                                                                              |

All empty states use text-secondary color, centered layout, and include a relevant action button or link when applicable.

---

## 14. Loading States

| Context                      | Loading Pattern                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Page load                    | Skeleton screens: gray pulsing rectangles matching content layout shapes                    |
| Podcast cards                | Card skeleton with rectangle for art area, 2 line-skeletons for title, 1 short for metadata |
| Chat message (AI responding) | Three animated dots ("typing indicator") in a Sotto message bubble                          |
| Audio generation             | Progress bar with percentage + descriptive status text                                      |
| Button action                | Button text replaced with spinner, button disabled                                          |
| Feed search                  | Cards fade to 50% opacity during search, then fade in new results                           |
| Profile load                 | Avatar circle skeleton, name line skeleton, bio line skeletons                              |

Skeleton colors: Background `#E5E1D8` with pulse animation cycling opacity 0.5 to 1.0 (uses the `pulse` keyframe from the design system).
