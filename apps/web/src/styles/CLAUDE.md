# src/styles/ — Global Styles & Design Tokens

## Design System: "SottoDesign aula"

All design tokens are CSS custom properties defined in `globals.css`.
JS equivalents for mobile consumption are in `@sotto/shared` (`packages/shared/src/theme.ts`).
Dark mode uses the "terminal" palette via `[data-theme='dark']`. The wordmark name and glass bead carry a blue to pink gradient (`#6AA0FF` to `#FF8FB1`).

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#3F4FB0` (aula blue) | CTAs, links, primary accent |
| `--color-accent` | `#2A3550` (ink slate) | Secondary emphasis |
| `--color-background` | `#F5F4F0` (paper) | Page background |
| `--color-surface` | `#FFFFFF` | Cards, panels |
| `--color-text-primary` | `#1E2128` (ink) | Body text |
| `--color-speaker-0..3` | blue, slate, teal, rose | Indexed voice palette (transcript, class) |

### Typography

| Token | Font | Usage |
|-------|------|-------|
| `--font-heading` | Newsreader | h1, h2, h3 and voice (editorial serif) |
| `--font-body` | IBM Plex Sans | Body text, UI elements |
| `--font-mono` | IBM Plex Mono | Labels, eyebrows, infra |

### Layout

| Token | Value | Usage |
|-------|-------|-------|
| `--sidebar-width` | 260px (0 on mobile) | Dashboard sidebar |
| `--topbar-height` | 64px (56px on mobile) | Top navigation bar |
| `--mini-player-height` | 72px (64px on mobile) | Persistent audio player |
| `--max-content-width` | 1200px | Content max-width |

### Mobile-First

All CSS is written mobile-first:
```css
.component { /* mobile styles */ }
@media (min-width: 768px) { .component { /* tablet+ */ } }
@media (min-width: 1024px) { .component { /* desktop+ */ } }
```
