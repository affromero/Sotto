# src/components/ — React Components

All React components, organized by feature domain. CSS Modules only — NO Tailwind.

## Directory Structure

| Directory        | Components                                                                                                                                                                                                  | Purpose                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `ui/`            | Button, Input, Card, Modal, Toast, Badge (+ creator/admin/system variants), Chip, Spinner, CitationMarker, TtsProviderLogo                                                                                  | Shared primitives                                              |
| `layout/`        | TopBar, Footer, Sidebar, MobileNav                                                                                                                                                                          | App shell                                                      |
| `player/`        | AudioPlayer, MiniPlayer, Waveform, PlaybackControls, TranscriptPanel, InterruptButton, ReferenceList, Teleprompter, ForkAttribution, ForkLineage, ForkRemixModal, ForkGraph, VersionHistory, ListeningQueue | Podcast playback + transcript + fork lineage + version history |
| `chat/`          | ChatContainer, ChatMessage, ChatChips, ResolutionPrompt                                                                                                                                                     | Chat UI                                                        |
| `discovery/`     | DiscoveryChat, SuggestionChips, RecommendationCard, CreatorSuggestion, InterestGrid, InspireMe, TopicCard                                                                                                   | Create flow + interest selection + topic inspiration           |
| `create/`        | GenerationProgress, ScriptPreview, TtsProviderSelector                                                                                                                                                      | Generation status + TTS provider selection                     |
| `import/`        | ImportUploader, ImportProgress                                                                                                                                                                              | Audio import: drag-and-drop upload + pipeline status           |
| `feed/`          | PodcastCard, FeedGrid, TagFilter, SearchBar, TrendingSection                                                                                                                                                | Public feed + content-type badges (AI/Human/Imported)          |
| `pricing/`       | PricingCard, FeatureList, TierComparison                                                                                                                                                                    | Pricing page (5 tiers + BYOK)                                  |
| `billing/`       | CreditPackCard                                                                                                                                                                                              | Credit pack purchase cards                                     |
| `profile/`       | ProfileHeader, PodcastList, FollowButton, FollowerCount                                                                                                                                                     | User profiles                                                  |
| `notifications/` | NotificationBell, NotificationList, PushPrompt                                                                                                                                                              | Notifications                                                  |
| `settings/`      | VoicePreferenceSelector, TtsProviderCards                                                                                                                                                                   | Voice preferences + TTS provider BYOK key management           |
| `providers/`     | SessionProvider, AudioPlayerProvider, NotificationProvider, EventProvider, PageViewTracker                                                                                                                  | React context providers + event tracking                       |

## Component Pattern

```tsx
// ComponentName.tsx
import styles from './ComponentName.module.css';

interface ComponentNameProps {
  variant?: 'primary' | 'secondary';
  children: React.ReactNode;
}

export function ComponentName({ variant = 'primary', children }: ComponentNameProps) {
  return <div className={`${styles.root} ${styles[variant]}`}>{children}</div>;
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
