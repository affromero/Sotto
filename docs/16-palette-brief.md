# Color Palette Design Brief — Sotto

> **Date**: 2026-02-08
>
> **Summary**: Comprehensive color palette brief for Sotto, an interactive AI podcast platform. This document is self-contained — no codebase access required. It presents the current palette for refinement, proposes alternative directions, defines semantic color requirements, specifies accessibility standards, describes application contexts, and includes AI prompts for moodboard visualization. Suitable for human designers and AI tools.

---

## 1. Brand Context

### 1.1 What is Sotto?

Sotto is an AI-powered podcast platform. Users chat with AI to describe a topic, and Sotto generates a personalized two-voice conversational podcast. Listeners can interrupt mid-playback to ask questions, and the episode updates with those clarifications. A social feed lets users discover, listen to, fork, and follow creators.

**Name origin**: From Italian "sotto voce" — speaking in a soft, intimate voice.

### 1.2 Design Philosophy: "Warm Intimacy"

Sotto's visual language evokes two physical spaces:

1. **The podcast studio**: Warm lighting, acoustic panels (soft surfaces), unobtrusive but capable equipment
2. **The reading nook**: Comfortable seating, good lamp light, a curated bookshelf, a notebook for questions

| Principle | Expression | Anti-pattern |
|-----------|-----------|-------------|
| **Warm** | Golden tones, cream backgrounds, soft corners | Cold blues, stark whites, rigid geometry |
| **Intimate** | Soft shadows, contained spaces, personal feel | Overwhelming dashboards, data-dense enterprise chrome |
| **Trustworthy** | Deep accents, consistent patterns, clear hierarchy | Flashy gradients, trendy effects, unclear navigation |
| **Effortless** | Minimal chrome, generous whitespace, obvious actions | Cluttered interfaces, small buttons, hidden features |

### 1.3 Key UI Contexts for the Palette

The palette must serve these specific product surfaces:

| Surface | Description | Color needs |
|---------|-------------|-------------|
| **Discovery chat** | User chats with AI to design their podcast; tappable suggestion chips | Primary CTAs, chip states, chat bubbles |
| **Audio player** | Playback controls, waveform visualization, transcript panel | Speaker differentiation (Host vs. Expert), progress indicators |
| **Social feed** | Grid of podcast cards with tags, likes, creator avatars | Card backgrounds, metadata text, tag colors, engagement icons |
| **Transcript** | Alternating turns between Host and Expert with citations | Two distinct speaker colors with readable backgrounds |
| **Pricing page** | Three tiers (Free / Pro / Team) with feature comparison | Tier differentiation, CTA hierarchy, "SOON" badges |
| **Dashboard** | Usage stats, podcast list, settings, billing | Data visualization, status indicators, navigation highlights |

---

## 2. Direction A: Refine the Current Palette

The current palette is already implemented in CSS. This direction refines and extends it rather than replacing it.

### 2.1 Current Core Colors

| Name | Hex | RGB | Current role |
|------|-----|-----|-------------|
| **Golden Amber** | `#D97706` | 217, 119, 6 | Primary — CTAs, links, Host speaker, active states |
| **Deep Navy** | `#1E3A5F` | 30, 58, 95 | Accent — Expert speaker, secondary actions, depth |
| **Soft Cream** | `#FEFCF8` | 254, 252, 248 | Background — page-level warmth |
| **White** | `#FFFFFF` | 255, 255, 255 | Surface — cards, panels, inputs |
| **Near-Black** | `#1A1A1A` | 26, 26, 26 | Text primary — headings, body |
| **Gray** | `#6B7280` | 107, 114, 128 | Text secondary — captions, metadata |

### 2.2 Extended Amber Scale (to define)

The current system has 5 amber stops. A production palette needs 9-10 stops for full flexibility:

| Stop | Current hex | Suggested refinement | Usage |
|------|-----------|---------------------|-------|
| **50** | `#FFFBEB` | Keep or warm slightly | Lightest tint — hover backgrounds, subtle highlights |
| **100** | `#FEF3C7` | Keep | Light backgrounds, tags, badges, selection highlight |
| **200** | — | **Define** | Chip backgrounds, secondary surface tints |
| **300** | — | **Define** | Border accent, subtle dividers in amber contexts |
| **400** | — | **Define** | Disabled state for amber buttons, soft icons |
| **500** | `#D97706` | Keep (this is the brand amber) | Primary CTAs, Host speaker, active states |
| **600** | `#B45309` | Keep | Hover state |
| **700** | `#92400E` | Keep | Active/pressed state |
| **800** | — | **Define** | Dark amber for text-on-light-amber backgrounds |
| **900** | — | **Define** | Darkest amber for high-contrast text uses |

### 2.3 Extended Navy Scale (to define)

| Stop | Current hex | Suggested refinement | Usage |
|------|-----------|---------------------|-------|
| **50** | `#EFF6FF` | Keep | Lightest tint — subtle navy backgrounds |
| **100** | `#DBEAFE` | Keep | Light backgrounds, Expert content areas |
| **200** | — | **Define** | Chip backgrounds, secondary navy surfaces |
| **300** | — | **Define** | Border accent, subtle dividers |
| **400** | — | **Define** | Disabled state, soft icons |
| **500** | — | **Define** | Mid-range navy for secondary buttons |
| **600** | `#1E3A5F` | Keep (this is the brand navy) | Expert speaker, secondary actions |
| **700** | `#162D4A` | Keep | Hover state |
| **800** | — | **Define** | Dark navy for dark mode surfaces |
| **900** | — | **Define** | Darkest navy for deep backgrounds |

### 2.4 Neutral / Cream Scale (to define)

The current system jumps from cream (`#FEFCF8`) to white (`#FFFFFF`) with only two border tones. A full neutral scale is needed:

| Stop | Current hex | Suggested refinement | Usage |
|------|-----------|---------------------|-------|
| **50** | `#FEFCF8` | Keep (page background) | Overall page warmth |
| **100** | `#FFF9F0` | Keep (surface hover) | Interactive surface hover |
| **200** | — | **Define** | Subtle card differentiation, section backgrounds |
| **300** | `#E5E1D8` | Keep (borders) | Card borders, dividers, input borders |
| **400** | `#D1CCC2` | Keep (border hover) | Hover state borders |
| **500** | — | **Define** | Stronger dividers, disabled backgrounds |
| **600** | `#9CA3AF` | Keep (tertiary text) | Placeholder text, disabled labels |
| **700** | `#6B7280` | Keep (secondary text) | Captions, metadata, timestamps |
| **800** | — | **Define** | Strong secondary text, subtle headings |
| **900** | `#1A1A1A` | Keep (primary text) | Headings, body text |

### 2.5 Dark Mode Palette (to define)

Dark mode is planned but not yet implemented. The designer should propose dark mode values that maintain brand warmth:

| Token | Light mode | Dark mode (to define) | Constraint |
|-------|-----------|----------------------|-----------|
| **Background** | `#FEFCF8` (cream) | **Define** — suggest a warm dark, not pure black | Must feel warm, not cold or sterile |
| **Surface** | `#FFFFFF` | **Define** — slightly lighter than background | Cards must visually "lift" off background |
| **Text primary** | `#1A1A1A` | **Define** — off-white, not pure `#FFFFFF` | Pure white on dark is harsh; soften slightly |
| **Text secondary** | `#6B7280` | **Define** — lighter gray | Must pass WCAG AA on dark background |
| **Border** | `#E5E1D8` | **Define** — subtle dark border | Visible but not prominent |
| **Primary (amber)** | `#D97706` | Keep or lighten slightly | Amber may need to be brighter on dark backgrounds for contrast |
| **Accent (navy)** | `#1E3A5F` | Lighten significantly | Navy on dark is invisible; needs lighter variant |
| **Speaker Host** | `#D97706` | **Define** — ensure readability on dark | Must stand out in dark transcript panel |
| **Speaker Expert** | `#1E3A5F` | **Define** — must be visible on dark | Critical for transcript readability |

### 2.6 Gradient Definitions (to define)

The current system uses no gradients. Subtle gradients may enhance:

| Gradient | Suggested use | Constraint |
|----------|-------------|-----------|
| **Amber warm** (amber-50 to amber-100) | Hero section backgrounds, pricing card highlights | Must be barely perceptible — a subtle warmth shift, not a visible gradient |
| **Navy depth** (navy-600 to navy-900) | Dark section backgrounds, footer | Should feel like depth, not decoration |
| **Cream-to-white** (cream-50 to white) | Card backgrounds that fade to surface | Almost imperceptible — adds subtle dimension |
| **Speaker blend** (amber to navy) | Transition indicator in transcript when speakers change | Very subtle, used sparingly |

---

## 3. Direction B: Alternative Palette Proposals

Three alternative palettes that could replace the current amber + navy system. Each maintains Sotto's "warm intimacy" personality while exploring a different color mood.

### 3.1 Alternative 1: "Warm Clay + Sage"

**Mood**: Earthy, grounded, organic — like a conversation in a sunlit pottery studio or a botanical library.

| Role | Color | Hex | RGB |
|------|-------|-----|-----|
| Primary | Warm Clay / Terracotta | `#C2703E` | 194, 112, 62 |
| Primary hover | Deep Clay | `#A35B2F` | 163, 91, 47 |
| Primary light | Clay Wash | `#FAEEE5` | 250, 238, 229 |
| Accent | Sage Green | `#5B7B6A` | 91, 123, 106 |
| Accent hover | Deep Sage | `#496253` | 73, 98, 83 |
| Accent light | Sage Mist | `#E8F0EB` | 232, 240, 235 |
| Background | Warm Linen | `#FBF8F4` | 251, 248, 244 |
| Surface | White | `#FFFFFF` | 255, 255, 255 |
| Text primary | Charcoal | `#2D2926` | 45, 41, 38 |
| Text secondary | Warm Gray | `#7D756E` | 125, 117, 110 |

**Why it works**: Terracotta is warmer and more organic than amber. Sage green provides a natural complement that feels calm and knowledgeable. The overall palette reads as "artisanal" and "considered" — aligned with Sotto's quality-over-quantity positioning.

**Trade-off**: Less corporate-friendly than amber + navy. The earthy tones may read as lifestyle/wellness rather than tech/education for some audiences.

### 3.2 Alternative 2: "Warm Violet + Gold"

**Mood**: Regal, contemplative, literary — like a conversation in a well-appointed study with mahogany shelves and warm lamplight.

| Role | Color | Hex | RGB |
|------|-------|-----|-----|
| Primary | Warm Violet | `#7C5CBF` | 124, 92, 191 |
| Primary hover | Deep Violet | `#6347A0` | 99, 71, 160 |
| Primary light | Violet Wash | `#F0ECF8` | 240, 236, 248 |
| Accent | Muted Gold | `#B8922F` | 184, 146, 47 |
| Accent hover | Deep Gold | `#9A7A22` | 154, 122, 34 |
| Accent light | Gold Wash | `#FAF5E8` | 250, 245, 232 |
| Background | Warm Parchment | `#FDFBF7` | 253, 251, 247 |
| Surface | White | `#FFFFFF` | 255, 255, 255 |
| Text primary | Deep Charcoal | `#1E1B2E` | 30, 27, 46 |
| Text secondary | Muted Plum | `#6B6380` | 107, 99, 128 |

**Why it works**: Violet conveys wisdom, creativity, and thoughtfulness. Gold adds warmth and prestige. The combination feels intellectual without being cold — appropriate for an AI learning tool. This palette would differentiate Sotto strongly from every competitor in the podcast space (which cluster around blue, green, orange, and red).

**Trade-off**: Violet is uncommon in audio/podcast branding, which makes it distinctive but also unfamiliar. Accessibility requires careful attention — violet on light backgrounds needs sufficient saturation to pass contrast checks.

### 3.3 Alternative 3: "Copper + Slate"

**Mood**: Industrial-warm, confident, precise — like a conversation in a well-lit modern loft with exposed brick and steel beams.

| Role | Color | Hex | RGB |
|------|-------|-----|-----|
| Primary | Burnished Copper | `#C27045` | 194, 112, 69 |
| Primary hover | Deep Copper | `#A35A33` | 163, 90, 51 |
| Primary light | Copper Wash | `#FAF0E8` | 250, 240, 232 |
| Accent | Slate Blue | `#4A6274` | 74, 98, 116 |
| Accent hover | Deep Slate | `#3A4F5F` | 58, 79, 95 |
| Accent light | Slate Mist | `#E8EEF2` | 232, 238, 242 |
| Background | Warm Stone | `#FDFCF9` | 253, 252, 249 |
| Surface | White | `#FFFFFF` | 255, 255, 255 |
| Text primary | Off-Black | `#1C1C1E` | 28, 28, 30 |
| Text secondary | Cool Gray | `#6E7781` | 110, 119, 129 |

**Why it works**: Copper retains the warmth of amber but adds more depth and sophistication. Slate blue is a less saturated, more muted alternative to navy that feels more modern. The combination reads as "premium but approachable." This palette would transition well between light and dark mode because copper and slate work naturally on dark backgrounds.

**Trade-off**: Copper is close enough to amber that it might not feel like a meaningful change. The slate blue is less distinct from general "professional blue" than navy is.

---

## 4. Semantic Color System Requirements

Regardless of which palette direction is chosen, the following semantic colors must be defined:

### 4.1 Status Colors

| Token | Purpose | Constraint |
|-------|---------|-----------|
| **Success** | Completed generation, ready status, positive feedback | Must be green-family; pass AA on both light and dark backgrounds |
| **Success light** | Background for success messages, badges | Tinted version of success; readable with success-colored text on it |
| **Warning** | Usage limits approaching, rate limit notices, caution states | Must be yellow/amber-family; cannot be confused with the primary brand amber |
| **Warning light** | Background for warning messages | If primary is amber, this is tricky — warning must be visually distinct from primary-light |
| **Error** | Failed generation, payment failure, destructive actions | Must be red-family; high urgency signal |
| **Error light** | Background for error messages, destructive action confirmation | Soft red that does not create alarm when used as a section background |
| **Info** | Tips, onboarding hints, informational banners | Must be blue-family; lower urgency than warning |
| **Info light** | Background for informational messages | Must not be confused with accent-light if accent is also blue-family |

### 4.2 Interactive State Colors

| State | Requirement |
|-------|------------|
| **Hover** | Slightly darker or more saturated than default; must be perceptible but not jarring |
| **Active/Pressed** | Darker than hover; provides tactile feedback |
| **Focus ring** | High contrast outline (2px solid) visible on all backgrounds; amber is current |
| **Disabled** | Desaturated and lightened; must still be readable but clearly non-interactive |
| **Selected/Active** | Filled with primary color (e.g., selected chip, active nav item) |

### 4.3 Speaker Colors

This is Sotto-specific and critical. Every podcast has two voices:

| Speaker | Current | Requirement |
|---------|---------|------------|
| **Host** | Amber `#D97706` on `#FEF3C7` background | Warm, inviting, conversational — the "friendly questioner" |
| **Expert** | Navy `#1E3A5F` on `#DBEAFE` background | Grounded, authoritative, knowledgeable — the "wise explainer" |

Requirements:
- The two speaker colors must be **instantly distinguishable** from each other
- Each speaker color on its corresponding light background must pass **WCAG AA** for normal text
- The colors must create a **visual rhythm** in the transcript — alternating warm and cool tones that help the eye track speaker changes
- Neither speaker color should be confused with semantic colors (success, warning, error, info)

---

## 5. Accessibility Requirements

### 5.1 WCAG AA Compliance (Minimum)

| Combination | Minimum ratio | Applies to |
|-------------|-------------|-----------|
| Normal text (< 18px, < 14px bold) on background | 4.5:1 | All body text, captions, labels |
| Large text (>= 18px, >= 14px bold) on background | 3:1 | Headings, buttons, large labels |
| UI components and graphical objects | 3:1 | Icons, borders, form controls, focus indicators |
| Text on primary-colored buttons | 4.5:1 (preferred) or 3:1 (large) | Button labels on amber/primary fill |

### 5.2 Known Accessibility Challenge

White text (`#FFFFFF`) on amber (`#D97706`) has a contrast ratio of approximately **3.3:1**. This passes for large text (18px+) but fails for normal text. Any palette refinement must address this:

**Options**:
1. Darken the amber slightly for button backgrounds (e.g., `#C06806`) while keeping `#D97706` for non-text uses
2. Use dark text on amber buttons instead of white
3. Accept the current ratio and enforce a minimum 15px semibold for text on amber (current approach)

The designer should evaluate and recommend an approach.

### 5.3 Color Blindness Considerations

The palette must be tested against these conditions:

| Condition | Prevalence | Risk |
|-----------|-----------|------|
| **Protanopia** (no red perception) | ~1% of males | Amber may appear yellowish-green; ensure it does not merge with success green |
| **Deuteranopia** (no green perception) | ~5% of males | Similar concern — amber and green may converge |
| **Tritanopia** (no blue perception) | ~0.01% | Navy may appear dark gray; ensure navy and dark text remain distinguishable |

**Requirement**: Speaker colors (Host vs. Expert) must remain distinguishable under protanopia and deuteranopia simulations. If the amber and navy pair fails this test under certain simulations, provide a supplementary differentiation method (icon, label, or position) — but the colors themselves should be as robust as possible.

### 5.4 Contrast Testing Matrix

The designer should provide a contrast testing matrix for the final palette. Example format:

| Foreground | Background | Ratio | AA Normal | AA Large | AAA Normal |
|-----------|-----------|-------|-----------|----------|------------|
| Text primary | Background | ?:1 | Pass/Fail | Pass/Fail | Pass/Fail |
| Text primary | Surface | ?:1 | Pass/Fail | Pass/Fail | Pass/Fail |
| Text secondary | Background | ?:1 | Pass/Fail | Pass/Fail | Pass/Fail |
| Primary | Background | ?:1 | Pass/Fail | Pass/Fail | Pass/Fail |
| Text inverse | Primary | ?:1 | Pass/Fail | Pass/Fail | Pass/Fail |
| Text inverse | Accent | ?:1 | Pass/Fail | Pass/Fail | Pass/Fail |
| Speaker Host | Speaker Host bg | ?:1 | Pass/Fail | Pass/Fail | Pass/Fail |
| Speaker Expert | Speaker Expert bg | ?:1 | Pass/Fail | Pass/Fail | Pass/Fail |

---

## 6. Application Mockup Descriptions

These describe how the palette should look in specific product contexts. The designer should create visual mockups or swatches for each.

### 6.1 Discovery Chat Screen

- **Background**: Page background color (cream/warm)
- **Chat bubbles — AI**: Surface color with subtle border; AI text in text-primary
- **Chat bubbles — User**: Primary color fill with inverse text
- **Suggestion chips**: Surface background with border; on hover, primary-light background with primary text; selected state fills with primary color
- **Input bar**: Surface background, border, text-primary; send button in primary color
- **Overall feeling**: Warm, conversational, like texting a knowledgeable friend

### 6.2 Podcast Player Screen

- **Background**: Page background
- **Waveform**: Primary color (amber) for Host segments, accent color (navy) for Expert segments; inactive portions in border-color gray
- **Current position indicator**: Primary color, pulsing gently
- **Transcript panel**: Surface background; Host turns have primary-light background tint; Expert turns have accent-light background tint; speaker labels in their respective colors (primary for Host, accent for Expert)
- **"Ask a Question" button**: Primary color, prominent, with icon
- **Playback controls**: Text-primary icons; active state in primary color
- **Overall feeling**: Focused, readable, intimate — like following along with a conversation

### 6.3 Social Feed Screen

- **Background**: Page background
- **Podcast cards**: Surface color, border, subtle shadow; on hover, border darkens slightly and shadow deepens
- **Card title**: Text-primary, heading font
- **Card metadata** (creator, duration, date): Text-secondary
- **Tag pills**: Primary-light background with primary text; compact, rounded
- **Like/save/fork icons**: Text-secondary; on active, like = primary (amber heart), save = accent, fork = text-secondary
- **Trending section**: Slight background tint (primary-lighter or accent-lighter)
- **Overall feeling**: Clean, browsable, inviting — like a curated bookstore shelf

### 6.4 Pricing Page

- **Background**: Page background
- **Free tier card**: Surface, standard border, no special highlight
- **Pro tier card**: Primary border or subtle primary background tint — this is the "recommended" tier
- **Team tier card**: Accent border or subtle accent background tint
- **CTA buttons**: Primary fill for the recommended tier; outline for others
- **"SOON" badges**: Primary-light background with primary text, small rounded pill
- **Feature checkmarks**: Success color
- **Overall feeling**: Clear hierarchy, the Pro tier visually "pops" without being garish

### 6.5 Dark Mode (any screen)

- **Background**: Warm dark (not pure black — suggest `#1A1917` or similar warm-tinted dark)
- **Surface**: Slightly lighter than background (like `#262420` — warm dark gray)
- **Text primary**: Off-white (`#F0EDE8` — slightly warm, not pure white)
- **Primary (amber)**: May need to brighten to `#E8890F` or similar to maintain contrast on dark
- **Accent (navy)**: Must lighten significantly — suggest mid-range blue `#5B8ABD` or similar
- **Borders**: Subtle warm-tinted dark lines
- **Overall feeling**: Cozy evening reading, not "dark mode" for the sake of it — like the podcast studio at night with warm accent lighting

---

## 7. AI Generation Prompts for Moodboard Visualization

### 7.1 Direction A — Refined Amber + Navy (Midjourney)

```
Moodboard for a podcast app brand palette. Warm golden amber (#D97706), deep navy (#1E3A5F), soft cream (#FEFCF8) background. Interior design reference: warm podcast studio with amber pendant lights, navy acoustic panels, cream walls, wooden elements. Typography: serif headings, clean sans-serif body. The feeling of sitting in a cozy room listening to two knowledgeable friends talk. Flat color swatches overlaid. --ar 16:9 --style raw --v 6.1
```

```
UI color palette visualization for a podcast app. Light theme: cream background, white cards, amber buttons and highlights, navy text accents. Dark theme: warm charcoal background, slightly lighter card surfaces, brightened amber accents, lighter blue replacing navy. Both themes shown side by side with example app screens. Clean, modern, editorial aesthetic. --ar 16:9 --style raw --v 6.1
```

### 7.2 Direction B Alternatives (Midjourney)

**Warm Clay + Sage**:
```
Moodboard for a podcast app brand palette. Warm terracotta clay (#C2703E), sage green (#5B7B6A), warm linen background. Interior reference: botanical library with terracotta pots, sage green book spines, natural linen curtains, wooden reading table. Organic, earthy, grounded. Flat color swatches overlaid. --ar 16:9 --style raw --v 6.1
```

**Warm Violet + Gold**:
```
Moodboard for a podcast app brand palette. Warm violet (#7C5CBF), muted gold (#B8922F), parchment background. Interior reference: mahogany study with violet velvet chair, gold desk lamp, parchment paper, leather-bound books. Regal, contemplative, literary. Flat color swatches overlaid. --ar 16:9 --style raw --v 6.1
```

**Copper + Slate**:
```
Moodboard for a podcast app brand palette. Burnished copper (#C27045), slate blue (#4A6274), warm stone background. Interior reference: modern loft with exposed copper pipes, slate-colored concrete, warm stone walls, large windows. Industrial-warm, confident, precise. Flat color swatches overlaid. --ar 16:9 --style raw --v 6.1
```

### 7.3 DALL-E Prompts

**Direction A**:
```
A flat-design color palette moodboard for a podcast app called "Sotto." The palette features warm golden amber (#D97706), deep navy (#1E3A5F), and soft cream (#FEFCF8). Show large color swatches arranged in a grid alongside a simplified app UI mockup using these colors. The UI has a cream background, white cards with amber buttons, and navy text. Include a dark mode variant with warm charcoal backgrounds. Clean, modern, editorial aesthetic.
```

**Alternative — Warm Clay + Sage**:
```
A flat-design color palette moodboard for a podcast app. The palette features warm terracotta (#C2703E), sage green (#5B7B6A), and warm linen (#FBF8F4). Show large color swatches alongside a simplified app UI mockup. Cream/linen background, white cards, terracotta buttons, sage green accents. Organic, earthy, warm. Clean modern design.
```

---

## 8. Deliverables

### 8.1 Required Outputs

| Deliverable | Description |
|------------|------------|
| **Primary palette** | Full 9-10 stop scale for each core color (primary, accent, neutral) |
| **Semantic palette** | Success, warning, error, info — each with base, hover, light, and lighter stops |
| **Speaker palette** | Host and Expert colors with text and background variants |
| **Dark mode palette** | Full token mapping from light to dark |
| **Gradient definitions** | 3-4 subtle gradients with specific use cases |
| **Contrast matrix** | Full WCAG testing results for all foreground/background pairings |
| **Color blindness report** | Simulations for protanopia, deuteranopia, tritanopia |
| **Application mockups** | At minimum: discovery chat, player, feed, pricing — in both light and dark |
| **CSS variable mapping** | Token names and values for developer handoff |
| **Figma color styles** | If using Figma, organized color style library |

### 8.2 Token Naming Convention

Follow this naming pattern for developer handoff:

```
--color-{category}-{shade}

Examples:
--color-primary-50
--color-primary-100
--color-primary-500  (brand color)
--color-primary-900

--color-accent-50
--color-accent-600  (brand color)

--color-neutral-50  (cream background)
--color-neutral-900 (near-black text)

--color-success
--color-success-light
--color-warning
--color-error
--color-info

--color-speaker-host
--color-speaker-host-bg
--color-speaker-expert
--color-speaker-expert-bg
```

---

## 9. Evaluation Criteria

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Brand alignment** | 25% | Does the palette feel warm, intimate, intelligent, and calm? |
| **Accessibility** | 25% | Does every combination meet WCAG AA? Is the color blindness report clean? |
| **Dark mode quality** | 15% | Does dark mode feel intentional and warm, not like an afterthought? |
| **System completeness** | 15% | Are all tokens defined? All scales filled? All semantic colors present? |
| **Distinctiveness** | 10% | Is this palette visually distinct from competitors (Spotify, Apple Podcasts, NotebookLM)? |
| **Application fit** | 10% | Do the mockups look cohesive, readable, and inviting across all screens? |

---

## 10. Brand Context Summary (for quick reference)

| Item | Value |
|------|-------|
| **Brand name** | Sotto |
| **Tagline** | Podcasts that listen back |
| **Origin** | Italian: "sotto voce" = soft voice, intimate tone |
| **Product** | AI-generated interactive podcasts with Q&A |
| **Design philosophy** | "Warm Intimacy" — podcast studio + reading nook |
| **Heading font** | DM Serif Display (serif, editorial) |
| **Body font** | Inter (sans-serif, clean) |
| **Current primary** | Golden Amber `#D97706` |
| **Current accent** | Deep Navy `#1E3A5F` |
| **Current background** | Soft Cream `#FEFCF8` |
| **Current text** | Near-Black `#1A1A1A` |
| **Target audience** | Curious learners, busy professionals, educators |
| **Competitors** | NotebookLM, Spotify, Apple Podcasts, Podbean AI |
| **Key differentiator** | Mid-playback Q&A that updates the episode |
