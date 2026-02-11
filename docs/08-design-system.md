# Design System — Sotto

> **Date**: 2026-02-08
>
> **Summary**: Sotto's design system, codenamed "Warm Intimacy," creates a visual and interactive language that evokes the feeling of sitting in a cozy room listening to two knowledgeable friends have a conversation. The system is built on golden amber and deep navy as its two core colors, DM Serif Display and Inter as its type pairing, a 4px spacing base unit, CSS Modules (never Tailwind), and mobile-first responsive design. This document specifies every design token, typography rule, component pattern, animation guideline, and responsive breakpoint.

---

## 1. Design Philosophy: "Warm Intimacy"

### 1.1 Core Principles

The design system embodies four qualities:

| Principle       | Expression                                                                    | Anti-pattern                                                         |
| --------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Warm**        | Golden amber tones, cream backgrounds, serif headings, rounded corners        | Cold blues, stark whites, rigid geometry                             |
| **Intimate**    | Soft shadows, contained spaces, conversational UI, personal feel              | Overwhelming dashboards, data-dense tables, enterprise chrome        |
| **Trustworthy** | Deep navy accents, consistent patterns, clear hierarchy, readable type        | Flashy gradients, trendy animations, unclear navigation              |
| **Effortless**  | Minimal chrome, generous whitespace, obvious actions, forgiving touch targets | Cluttered interfaces, small buttons, hidden features, mode confusion |

### 1.2 Emotional Goals

When a user opens Sotto, they should feel:

- **Welcomed** — the warm cream background and amber accents create a sense of invitation, not intimidation
- **Focused** — generous whitespace and clear hierarchy direct attention to the content and primary actions
- **Safe to explore** — tappable chips, clear labels, and forgiving interactions reduce anxiety about "doing it wrong"
- **Connected** — the social feed and profile elements create a sense of community without social media noise

### 1.3 Design Metaphor

Sotto's visual language draws from two physical metaphors:

1. **The podcast studio**: warm lighting, acoustic panels (soft surfaces), visible but unobtrusive equipment (controls)
2. **The reading nook**: comfortable seating (cream background), good lighting (clear type), a curated bookshelf (feed), a notebook for questions (Q&A)

---

## 2. Color System

### 2.1 Primary Palette

| Token           | CSS Variable              | Hex                    | RGB           | Usage                                                |
| --------------- | ------------------------- | ---------------------- | ------------- | ---------------------------------------------------- |
| Primary         | `--color-primary`         | `#D97706`              | 217, 119, 6   | CTAs, links, Host speaker, active states, highlights |
| Primary Hover   | `--color-primary-hover`   | `#B45309`              | 180, 83, 9    | Hover state for primary elements                     |
| Primary Active  | `--color-primary-active`  | `#92400E`              | 146, 64, 14   | Active/pressed state for primary elements            |
| Primary Light   | `--color-primary-light`   | `#FEF3C7`              | 254, 243, 199 | Light backgrounds, tags, badges, selection highlight |
| Primary Lighter | `--color-primary-lighter` | `#FFFBEB`              | 255, 251, 235 | Subtle tinting, hover backgrounds                    |
| Primary Subtle  | `--color-primary-subtle`  | `rgba(217,119,6,0.08)` | —             | Ghost buttons, very light overlays                   |

### 2.2 Accent Palette

| Token          | CSS Variable             | Hex                   | RGB           | Usage                                        |
| -------------- | ------------------------ | --------------------- | ------------- | -------------------------------------------- |
| Accent         | `--color-accent`         | `#1E3A5F`             | 30, 58, 95    | Expert speaker, secondary actions, depth     |
| Accent Hover   | `--color-accent-hover`   | `#162D4A`             | 22, 45, 74    | Hover state for accent elements              |
| Accent Light   | `--color-accent-light`   | `#DBEAFE`             | 219, 234, 254 | Light backgrounds for Expert-related content |
| Accent Lighter | `--color-accent-lighter` | `#EFF6FF`             | 239, 246, 255 | Subtle tinting for accent sections           |
| Accent Subtle  | `--color-accent-subtle`  | `rgba(30,58,95,0.08)` | —             | Ghost buttons, very light accent overlays    |

### 2.3 Neutral Palette

| Token            | CSS Variable               | Hex       | Usage                                        |
| ---------------- | -------------------------- | --------- | -------------------------------------------- |
| Background       | `--color-background`       | `#FEFCF8` | Page background (soft cream)                 |
| Surface          | `--color-surface`          | `#FFFFFF` | Cards, panels, modals, input fields          |
| Surface Hover    | `--color-surface-hover`    | `#FFF9F0` | Hover state for interactive surface elements |
| Surface Elevated | `--color-surface-elevated` | `#FFFFFF` | Elevated cards with shadows                  |
| Border           | `--color-border`           | `#E5E1D8` | Card borders, dividers, input borders        |
| Border Hover     | `--color-border-hover`     | `#D1CCC2` | Hover state for bordered elements            |

### 2.4 Text Colors

| Token          | CSS Variable             | Hex       | Usage                                |
| -------------- | ------------------------ | --------- | ------------------------------------ |
| Text Primary   | `--color-text-primary`   | `#1A1A1A` | Headings, body text, primary content |
| Text Secondary | `--color-text-secondary` | `#6B7280` | Captions, metadata, helper text      |
| Text Tertiary  | `--color-text-tertiary`  | `#9CA3AF` | Disabled text, placeholders          |
| Text Inverse   | `--color-text-inverse`   | `#FFFFFF` | Text on primary/accent backgrounds   |
| Muted          | `--color-muted`          | `#6B7280` | De-emphasized content, timestamps    |

### 2.5 Speaker Colors

Speaker colors are central to the podcast experience. They visually distinguish the Host and Expert in transcripts, player labels, and script previews:

| Speaker | Color Token              | Hex       | Background Token            | Background Hex | Usage                                                        |
| ------- | ------------------------ | --------- | --------------------------- | -------------- | ------------------------------------------------------------ |
| Host    | `--color-speaker-host`   | `#D97706` | `--color-speaker-host-bg`   | `#FEF3C7`      | Host name label, transcript line highlight, waveform color   |
| Expert  | `--color-speaker-expert` | `#1E3A5F` | `--color-speaker-expert-bg` | `#DBEAFE`      | Expert name label, transcript line highlight, waveform color |

The Host uses amber (warm, inviting, conversational) and the Expert uses navy (grounding, authoritative, knowledgeable). This color pairing creates visual rhythm in the transcript panel — alternating warm and cool tones that help the eye track speaker changes.

### 2.6 Semantic Colors

| Token         | CSS Variable            | Hex       | Usage                                            |
| ------------- | ----------------------- | --------- | ------------------------------------------------ |
| Success       | `--color-success`       | `#059669` | Completed actions, positive states, READY status |
| Success Light | `--color-success-light` | `#D1FAE5` | Success backgrounds, badges                      |
| Warning       | `--color-warning`       | `#F59E0B` | Caution states, usage limits approaching         |
| Warning Light | `--color-warning-light` | `#FEF3C7` | Warning backgrounds                              |
| Error         | `--color-error`         | `#DC2626` | Errors, failures, destructive actions            |
| Error Light   | `--color-error-light`   | `#FEE2E2` | Error backgrounds                                |
| Info          | `--color-info`          | `#2563EB` | Informational messages, tips                     |
| Info Light    | `--color-info-light`    | `#DBEAFE` | Info backgrounds                                 |

### 2.7 Color Usage Rules

1. **Never use raw hex values in components.** Always reference CSS variables.
2. **Primary (amber) is for action.** Anything clickable, tappable, or interactive defaults to amber.
3. **Accent (navy) is for secondary emphasis.** Expert content, secondary buttons, and depth cues.
4. **Background is cream, not white.** White (`#FFFFFF`) is reserved for elevated surfaces (cards, panels) that need to "lift" off the cream background.
5. **Avoid pure black text.** Use `#1A1A1A` (near-black) for body text — it is easier on the eyes against the cream background.
6. **Semantic colors are for states only.** Do not use success/error/warning colors for decorative purposes.

---

## 3. Typography

### 3.1 Font Families

| Font             | CSS Variable     | Category   | Source       | Usage                                                      |
| ---------------- | ---------------- | ---------- | ------------ | ---------------------------------------------------------- |
| DM Serif Display | `--font-heading` | Serif      | Google Fonts | h1, h2, h3, display text, podcast titles, section headings |
| Inter            | `--font-body`    | Sans-serif | Google Fonts | Body text, UI elements, buttons, inputs, labels, captions  |
| JetBrains Mono   | `--font-mono`    | Monospace  | Google Fonts | Code snippets, technical content, timestamps               |

**Fallback stacks**:

- Heading: `'DM Serif Display', Georgia, 'Times New Roman', serif`
- Body: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- Mono: `'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace`

### 3.2 Type Scale

The type scale uses CSS shorthand `font` properties for consistency:

| Token      | CSS Variable      | Weight | Size | Line Height | Font    | Usage                                   |
| ---------- | ----------------- | ------ | ---- | ----------- | ------- | --------------------------------------- |
| Display    | `--text-display`  | 700    | 48px | 1.1         | Heading | Landing page hero, major section titles |
| H1         | `--text-h1`       | 400    | 36px | 1.2         | Heading | Page titles                             |
| H2         | `--text-h2`       | 400    | 28px | 1.3         | Heading | Section headings                        |
| H3         | `--text-h3`       | 400    | 22px | 1.35        | Heading | Card titles, subsection headings        |
| H4         | `--text-h4`       | 600    | 18px | 1.4         | Body    | Small headings, labels                  |
| Body Large | `--text-body-lg`  | 400    | 18px | 1.6         | Body    | Lead paragraphs, feature descriptions   |
| Body       | `--text-body`     | 400    | 16px | 1.6         | Body    | Default body text                       |
| Body Small | `--text-body-sm`  | 400    | 14px | 1.5         | Body    | Secondary text, metadata                |
| Caption    | `--text-caption`  | 500    | 12px | 1.4         | Body    | Timestamps, badges, overlines           |
| Overline   | `--text-overline` | 600    | 11px | 1.4         | Body    | Section labels, category tags           |

### 3.3 Font Size Scale (Standalone)

For cases where the shorthand `font` property is not appropriate:

| Token              | Size | Usage                       |
| ------------------ | ---- | --------------------------- |
| `--font-size-xs`   | 11px | Overlines, tiny labels      |
| `--font-size-sm`   | 13px | Small captions, chip labels |
| `--font-size-base` | 15px | Standard body text          |
| `--font-size-lg`   | 17px | Slightly emphasized body    |
| `--font-size-xl`   | 20px | Large body, small headings  |
| `--font-size-2xl`  | 24px | Medium headings             |
| `--font-size-3xl`  | 30px | Large headings              |
| `--font-size-4xl`  | 36px | Page titles                 |
| `--font-size-5xl`  | 48px | Display/hero text           |

### 3.4 Typography Rules

1. **Headings are always DM Serif Display.** This serif font gives Sotto its editorial warmth. Never use Inter for headings.
2. **Body text is always Inter.** DM Serif Display is not optimized for body text readability at small sizes.
3. **DM Serif Display at weight 400 only.** The font is designed for regular weight. Bold weights are unavailable; use size differentiation instead.
4. **Maximum reading width: 65 characters.** Body text paragraphs should not exceed 65ch width for comfortable reading.
5. **Line height decreases as size increases.** Display text (1.1) is tighter than body text (1.6) because large text needs less vertical space for readability.
6. **Do not use letter-spacing on body text.** Inter is optimized for default spacing. Only use letter-spacing on overline/caption text (0.05em).

---

## 4. Spacing System

### 4.1 Base Unit: 4px

All spacing values are multiples of 4px. This creates a consistent visual rhythm across the entire application.

| Token    | CSS Variable | Value | Common Usage                                |
| -------- | ------------ | ----- | ------------------------------------------- |
| Space 1  | `--space-1`  | 4px   | Tight gaps, icon-to-text padding            |
| Space 2  | `--space-2`  | 8px   | Inline element spacing, compact padding     |
| Space 3  | `--space-3`  | 12px  | Default input padding, small card padding   |
| Space 4  | `--space-4`  | 16px  | Standard component padding, list item gaps  |
| Space 5  | `--space-5`  | 20px  | Medium padding, section sub-gaps            |
| Space 6  | `--space-6`  | 24px  | Card padding, section heading margin-bottom |
| Space 8  | `--space-8`  | 32px  | Section gaps, large component padding       |
| Space 10 | `--space-10` | 40px  | Page section separation                     |
| Space 12 | `--space-12` | 48px  | Major section separation                    |
| Space 16 | `--space-16` | 64px  | Page-level top/bottom padding               |

### 4.2 Semantic Spacing

For improved readability in component code:

| Token | CSS Variable    | Value | Usage               |
| ----- | --------------- | ----- | ------------------- |
| XS    | `--spacing-xs`  | 4px   | Minimal spacing     |
| SM    | `--spacing-sm`  | 8px   | Small spacing       |
| MD    | `--spacing-md`  | 16px  | Default spacing     |
| LG    | `--spacing-lg`  | 24px  | Large spacing       |
| XL    | `--spacing-xl`  | 32px  | Extra large spacing |
| 2XL   | `--spacing-2xl` | 48px  | Section spacing     |
| 3XL   | `--spacing-3xl` | 64px  | Page-level spacing  |

### 4.3 Spacing Rules

1. **Padding inside components**: Use `--space-3` (12px) to `--space-6` (24px).
2. **Gaps between sibling components**: Use `--space-4` (16px) to `--space-8` (32px).
3. **Section separation**: Use `--space-10` (40px) to `--space-16` (64px).
4. **Never use arbitrary values.** If 18px feels right, use 16px or 20px instead.
5. **Touch targets minimum**: 44px x 44px for mobile (Apple HIG guideline).

---

## 5. Border Radius

| Token | CSS Variable    | Value  | Usage                                 |
| ----- | --------------- | ------ | ------------------------------------- |
| SM    | `--radius-sm`   | 4px    | Small elements: badges, inline tags   |
| MD    | `--radius-md`   | 6px    | Inputs, small buttons                 |
| LG    | `--radius-lg`   | 8px    | Standard buttons, cards               |
| XL    | `--radius-xl`   | 12px   | Large cards, modals                   |
| 2XL   | `--radius-2xl`  | 16px   | Feature cards, panels                 |
| Full  | `--radius-full` | 9999px | Circles: avatars, pill buttons, chips |

**Rule**: The larger the element, the larger the border radius. Cards use `--radius-lg` to `--radius-xl`. Buttons use `--radius-md` to `--radius-lg`. Chips and pills use `--radius-full`.

---

## 6. Shadows

| Token  | CSS Variable      | Value                                                                 | Usage                              |
| ------ | ----------------- | --------------------------------------------------------------------- | ---------------------------------- |
| XS     | `--shadow-xs`     | `0 1px 1px 0 rgba(0,0,0,0.04)`                                        | Subtle lift, inactive cards        |
| SM     | `--shadow-sm`     | `0 1px 2px 0 rgba(0,0,0,0.05)`                                        | Default card shadow                |
| MD     | `--shadow-md`     | `0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)`    | Hover state for cards, dropdown    |
| LG     | `--shadow-lg`     | `0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)`  | Modals, elevated panels            |
| XL     | `--shadow-xl`     | `0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)` | Popovers, important overlays       |
| 2XL    | `--shadow-2xl`    | `0 25px 50px -12px rgba(0,0,0,0.15)`                                  | Major modals, full-screen overlays |
| Player | `--shadow-player` | `0 -4px 20px rgba(0,0,0,0.1)`                                         | Mini player (shadow casts upward)  |

**Shadow philosophy**: Shadows are subtle. Sotto's cream background already provides warmth; heavy shadows would feel harsh. The darkest shadow (`--shadow-2xl`) is only 15% opacity black.

---

## 7. Transitions and Animation

### 7.1 Transition Tokens

| Token | CSS Variable        | Duration   | Usage                            |
| ----- | ------------------- | ---------- | -------------------------------- |
| Fast  | `--transition-fast` | 150ms ease | Color changes, opacity, border   |
| Base  | `--transition-base` | 200ms ease | General hover states, transforms |
| Slow  | `--transition-slow` | 300ms ease | Layout shifts, panel open/close  |

### 7.2 Keyframe Animations

| Animation   | Keyframes                                                 | Duration                  | Usage                                    |
| ----------- | --------------------------------------------------------- | ------------------------- | ---------------------------------------- |
| `fadeIn`    | opacity: 0 -> 1                                           | 200-400ms                 | Page content, lazy-loaded elements       |
| `slideUp`   | translateY(8px) + opacity:0 -> translateY(0) + opacity:1  | 300ms                     | Toast notifications, cards entering view |
| `slideDown` | translateY(-8px) + opacity:0 -> translateY(0) + opacity:1 | 300ms                     | Dropdown menus, chat messages            |
| `spin`      | rotate(0deg) -> rotate(360deg)                            | 1000ms (linear, infinite) | Loading spinners                         |
| `pulse`     | opacity: 1 -> 0.5 -> 1                                    | 2000ms (infinite)         | Skeleton loading states                  |
| `waveform`  | scaleY(0.3) -> scaleY(1) -> scaleY(0.3)                   | varies                    | Audio waveform visualization bars        |

### 7.3 Animation Guidelines

1. **Prefer transforms and opacity.** These properties are GPU-accelerated and do not trigger layout reflows. Avoid animating width, height, margin, padding, top, left.
2. **Duration: 150-400ms for UI transitions.** Shorter than 150ms feels instantaneous (no perceived motion). Longer than 400ms feels sluggish.
3. **Ease for most things.** Use `ease` (default CSS easing) for standard transitions. Use `ease-out` for elements entering the screen (fast start, gentle stop). Use `ease-in` for elements leaving.
4. **Respect prefers-reduced-motion.** Wrap non-essential animations in a media query:
   ```css
   @media (prefers-reduced-motion: no-preference) {
     .animated {
       animation: fadeIn 300ms ease;
     }
   }
   ```
5. **No bouncing, springing, or playful animations.** Sotto's personality is warm and composed, not energetic. Animations should feel like a calm inhale, not a bounce.
6. **Staggered list animations**: When rendering a list of cards (feed, notifications), stagger by 50ms per item up to a maximum of 5 items (250ms total delay). Items beyond 5 appear instantly.

---

## 8. Z-Index Scale

| Token    | CSS Variable   | Value | Usage                        |
| -------- | -------------- | ----- | ---------------------------- |
| Dropdown | `--z-dropdown` | 1000  | Dropdown menus, autocomplete |
| Sticky   | `--z-sticky`   | 1100  | Sticky headers, sidebar      |
| Overlay  | `--z-overlay`  | 1200  | Backdrop for modals          |
| Modal    | `--z-modal`    | 1300  | Modal dialogs                |
| Toast    | `--z-toast`    | 1400  | Toast notifications          |
| Player   | `--z-player`   | 1500  | Mini player (always on top)  |

The mini player has the highest z-index because it must remain visible and interactive at all times while the user navigates the app.

---

## 9. Layout Tokens

| Token              | CSS Variable           | Default Value | Mobile Value | Usage                   |
| ------------------ | ---------------------- | ------------- | ------------ | ----------------------- |
| Sidebar Width      | `--sidebar-width`      | 260px         | 0px          | Dashboard sidebar       |
| Topbar Height      | `--topbar-height`      | 64px          | 56px         | Top navigation bar      |
| Mini Player Height | `--mini-player-height` | 72px          | 64px         | Persistent audio player |
| Max Content Width  | `--max-content-width`  | 1200px        | 100%         | Content area max-width  |

---

## 10. Responsive Breakpoints

### 10.1 Breakpoint Definitions

Sotto uses a mobile-first approach. Base styles target mobile (320px+), and media queries progressively enhance for larger screens:

| Breakpoint    | CSS Media Query              | Target Devices                       |
| ------------- | ---------------------------- | ------------------------------------ |
| Mobile (base) | No media query               | 320px-767px: phones                  |
| Tablet        | `@media (min-width: 768px)`  | 768px-1023px: tablets, small laptops |
| Desktop       | `@media (min-width: 1024px)` | 1024px-1439px: laptops, desktops     |
| Wide          | `@media (min-width: 1440px)` | 1440px+: large monitors              |

### 10.2 Layout Behavior by Breakpoint

| Element            | Mobile (base)            | Tablet (768px)           | Desktop (1024px)                   | Wide (1440px)               |
| ------------------ | ------------------------ | ------------------------ | ---------------------------------- | --------------------------- |
| **Sidebar**        | Hidden (hamburger menu)  | Hidden (hamburger)       | Visible, fixed left                | Visible, fixed left         |
| **Topbar**         | 56px, simplified         | 64px, full               | 64px, full                         | 64px, full                  |
| **Mini Player**    | 64px, bottom fixed       | 72px, bottom fixed       | 72px, bottom fixed                 | 72px, bottom fixed          |
| **Content area**   | Full width, 16px padding | Full width, 24px padding | calc(100% - sidebar), 32px padding | max-width: 1200px, centered |
| **Feed grid**      | 1 column                 | 2 columns                | 3 columns                          | 3 columns                   |
| **Chat messages**  | Full width               | max-width: 600px         | max-width: 600px                   | max-width: 600px            |
| **Podcast player** | Full width               | max-width: 800px         | max-width: 800px                   | max-width: 800px            |
| **Cards**          | Full width, stacked      | 2-up grid                | 3-up grid                          | 3-up grid                   |
| **Navigation**     | Bottom nav (MobileNav)   | Bottom nav               | Sidebar                            | Sidebar                     |

### 10.3 Mobile-First CSS Pattern

```css
/* Base: mobile */
.feedGrid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
  padding: var(--space-4);
}

/* Tablet */
@media (min-width: 768px) {
  .feedGrid {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-6);
    padding: var(--space-6);
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .feedGrid {
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-8);
    padding: var(--space-8);
  }
}
```

---

## 11. Component Patterns

### 11.1 CSS Modules Convention

Every component uses CSS Modules with the following file structure:

```
ComponentName/
  ComponentName.tsx
  ComponentName.module.css
```

Class naming within modules uses camelCase:

```css
/* Button.module.css */
.root {
}
.primary {
}
.secondary {
}
.ghost {
}
.disabled {
}
.iconLeft {
}
.iconRight {
}
```

### 11.2 Button Variants

| Variant       | Background        | Text                     | Border                      | Usage                                             |
| ------------- | ----------------- | ------------------------ | --------------------------- | ------------------------------------------------- |
| **Primary**   | `--color-primary` | `--color-text-inverse`   | None                        | Main CTAs: "Create Podcast", "Generate", "Follow" |
| **Secondary** | `--color-accent`  | `--color-text-inverse`   | None                        | Secondary actions: "Listen", "View Profile"       |
| **Outline**   | Transparent       | `--color-primary`        | `1px solid --color-primary` | Tertiary actions: "Fork", "Save"                  |
| **Ghost**     | Transparent       | `--color-text-secondary` | None                        | Minimal actions: "Cancel", "Skip"                 |
| **Danger**    | `--color-error`   | `--color-text-inverse`   | None                        | Destructive: "Delete Podcast"                     |

Button sizes:
| Size | Height | Padding | Font Size |
|------|--------|---------|-----------|
| SM | 32px | 8px 12px | 13px |
| MD | 40px | 10px 16px | 15px |
| LG | 48px | 12px 24px | 17px |

### 11.3 Card Pattern

Cards are the primary content container across the application (podcast cards, recommendation cards, notification cards):

```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  transition:
    box-shadow var(--transition-base),
    border-color var(--transition-base);
}

.card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-border-hover);
}
```

### 11.4 Input Pattern

```css
.input {
  width: 100%;
  height: 40px;
  padding: 0 var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font: var(--text-body);
  color: var(--color-text-primary);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-subtle);
  outline: none;
}

.input::placeholder {
  color: var(--color-text-tertiary);
}
```

### 11.5 Chip Pattern

Chips are tappable suggestion options in the discovery chat:

```css
.chip {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font: var(--text-body-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.chip:hover {
  background: var(--color-primary-lighter);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.chipSelected {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-text-inverse);
}
```

### 11.6 Badge/SoonBadge Pattern

The SoonBadge marks features that are planned but not yet available:

```css
.soonBadge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--space-2);
  background: var(--color-primary-light);
  border-radius: var(--radius-full);
  font: var(--text-overline);
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

### 11.7 Toast Pattern

Toasts appear at the bottom-center of the screen (above the mini player if present):

```css
.toast {
  position: fixed;
  bottom: calc(var(--mini-player-height) + var(--space-4));
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast);
  padding: var(--space-3) var(--space-6);
  background: var(--color-text-primary);
  color: var(--color-text-inverse);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  font: var(--text-body-sm);
  animation: slideUp 300ms ease;
}
```

---

## 12. Iconography

### 12.1 Icon Style

Sotto uses outline-style icons (not filled) from the Lucide icon library. Outline icons feel lighter and more approachable, aligning with the "warm intimacy" aesthetic.

| Property     | Value                                                 |
| ------------ | ----------------------------------------------------- |
| Library      | Lucide React                                          |
| Style        | Outline (strokeWidth: 1.5)                            |
| Default Size | 20px (body context), 24px (navigation), 16px (inline) |
| Color        | Inherits from parent text color                       |

### 12.2 Key Icons

| Action        | Icon                    | Context                          |
| ------------- | ----------------------- | -------------------------------- |
| Play          | `Play`                  | Player controls, podcast cards   |
| Pause         | `Pause`                 | Player controls                  |
| Ask Question  | `MessageCircleQuestion` | Interrupt button during playback |
| Create        | `Plus`                  | Create podcast CTA               |
| Like          | `Heart`                 | Social engagement                |
| Save          | `Bookmark`              | Save for later                   |
| Fork          | `GitFork`               | Fork a podcast                   |
| Follow        | `UserPlus`              | Follow a creator                 |
| Search        | `Search`                | Feed search bar                  |
| Notifications | `Bell`                  | Notification bell                |
| Settings      | `Settings`              | Settings navigation              |
| Home          | `Home`                  | Dashboard navigation             |
| Explore       | `Compass`               | Feed navigation                  |
| Profile       | `User`                  | Profile navigation               |

---

## 13. Accessibility

### 13.1 Color Contrast

All text-on-background combinations meet WCAG 2.1 AA standards (minimum 4.5:1 for normal text, 3:1 for large text):

| Combination                                      | Contrast Ratio | Passes AA             |
| ------------------------------------------------ | -------------- | --------------------- |
| Text Primary (#1A1A1A) on Background (#FEFCF8)   | 15.8:1         | Yes                   |
| Text Primary (#1A1A1A) on Surface (#FFFFFF)      | 16.8:1         | Yes                   |
| Text Secondary (#6B7280) on Background (#FEFCF8) | 4.8:1          | Yes                   |
| Text Secondary (#6B7280) on Surface (#FFFFFF)    | 5.0:1          | Yes                   |
| Text Inverse (#FFFFFF) on Primary (#D97706)      | 3.3:1          | Yes (large text only) |
| Text Inverse (#FFFFFF) on Accent (#1E3A5F)       | 9.7:1          | Yes                   |
| Primary (#D97706) on Background (#FEFCF8)        | 4.8:1          | Yes                   |

Note: White text on amber (#D97706) only passes for large text (18px+ or 14px+ bold). Buttons using this combination must use at minimum 15px font size with 600 weight.

### 13.2 Focus Styles

All interactive elements use a visible focus indicator:

```css
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

The `:focus-visible` selector ensures focus rings appear only during keyboard navigation, not on mouse clicks.

### 13.3 Screen Reader Considerations

- All images and icons have `aria-label` or `alt` attributes
- The player controls have `aria-label` descriptions: "Play podcast", "Pause podcast", "Skip forward 15 seconds"
- The mini player has `role="region"` and `aria-label="Audio player"`
- Transcript text is semantically marked with `<blockquote>` for each turn, with `aria-label` identifying the speaker
- Chat messages use `role="log"` for the container and `role="listitem"` for each message
- Loading states use `aria-live="polite"` to announce progress updates
- Modal dialogs trap focus and return focus to the trigger element on close

---

## 14. Dark Mode Considerations

Dark mode is not in the MVP scope but the design system is prepared for it. All colors are defined as CSS custom properties, enabling a future dark mode via a class toggle:

```css
[data-theme='dark'] {
  --color-background: #1a1a1a;
  --color-surface: #2a2a2a;
  --color-text-primary: #f5f5f5;
  --color-text-secondary: #a0a0a0;
  --color-border: #3a3a3a;
  /* Primary and accent colors remain unchanged for brand consistency */
}
```

The amber and navy brand colors work well on dark backgrounds without modification, making the future dark mode transition straightforward.
