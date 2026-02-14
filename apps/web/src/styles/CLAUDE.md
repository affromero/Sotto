# src/styles/ — Global Styles & Design Tokens

## Design System: "Warm Intimacy"

All design tokens are CSS custom properties defined in `globals.css`.
JS equivalents for mobile consumption are in `@sotto/shared` (`packages/shared/src/theme.ts`).

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#D97706` (Golden Amber) | CTAs, Host speaker, links |
| `--color-accent` | `#1E3A5F` (Deep Navy) | Expert speaker, secondary |
| `--color-background` | `#FEFCF8` (Soft Cream) | Page background |
| `--color-surface` | `#FFFFFF` | Cards, panels |
| `--color-speaker-host` | `#D97706` | Host name/label in transcript |
| `--color-speaker-expert` | `#1E3A5F` | Expert name/label in transcript |

### Typography

| Token | Font | Usage |
|-------|------|-------|
| `--font-heading` | DM Serif Display | h1, h2, h3 (editorial warmth) |
| `--font-body` | Inter | Body text, UI elements |
| `--font-mono` | JetBrains Mono | Code, technical content |

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
