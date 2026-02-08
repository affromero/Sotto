# src/components/ — React Components

All React components, organized by feature domain. CSS Modules only — NO Tailwind.

## Directory Structure

| Directory | Components | Purpose |
|-----------|-----------|---------|
| `ui/` | Button, Input, Card, Modal, Toast, Badge, Chip, Spinner, CitationMarker | Shared primitives |
| `layout/` | TopBar, Footer, Sidebar, MobileNav | App shell |
| `player/` | AudioPlayer, MiniPlayer, Waveform, PlaybackControls, TranscriptPanel, InterruptButton, ReferenceList, Teleprompter | Podcast playback + transcript |
| `chat/` | ChatContainer, ChatMessage, ChatChips, ResolutionPrompt | Chat UI |
| `discovery/` | DiscoveryChat, SuggestionChips, RecommendationCard, CreatorSuggestion | Create flow |
| `create/` | GenerationProgress, ScriptPreview | Generation status |
| `feed/` | PodcastCard, FeedGrid, TagFilter, SearchBar, TrendingSection | Public feed |
| `pricing/` | PricingCard, FeatureList, TierComparison | Pricing page |
| `profile/` | ProfileHeader, PodcastList, FollowButton, FollowerCount | User profiles |
| `notifications/` | NotificationBell, NotificationList, PushPrompt | Notifications |
| `providers/` | SessionProvider, AudioPlayerProvider, NotificationProvider | React context providers |

## Component Pattern

```tsx
// ComponentName.tsx
import styles from './ComponentName.module.css';

interface ComponentNameProps {
  variant?: 'primary' | 'secondary';
  children: React.ReactNode;
}

export function ComponentName({ variant = 'primary', children }: ComponentNameProps) {
  return (
    <div className={`${styles.root} ${styles[variant]}`}>
      {children}
    </div>
  );
}
```

## Rules
- **CSS Modules only** — every component gets `ComponentName.module.css`
- **Server Components by default** — only add `'use client'` when needed
- **No inline styles** — all styling in CSS Modules
- **Semantic HTML** — use `<button>`, `<nav>`, `<main>`, `<section>` appropriately
- **ARIA labels** — all interactive elements must be accessible
- **Mobile-first** — design for 375px width first, scale up

## Adding a New Component
1. Create `src/components/domain/ComponentName.tsx`
2. Create `src/components/domain/ComponentName.module.css`
3. Export from component (no barrel files needed — import directly)
4. Update this CLAUDE.md
