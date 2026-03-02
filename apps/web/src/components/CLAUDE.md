# src/components/ — React Components

All React components, organized by feature domain. CSS Modules only — NO Tailwind.

## Directory Structure

| Directory        | Components                                                                                                                                                                                                                                                                                    | Purpose                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ui/`            | Button, Input, Card, Modal, Toast, Badge (+ creator/admin/system variants), Chip, Spinner, CitationMarker, TtsProviderLogo, OverflowMenu, FreeTierBanner, FreeTierCounter, StarRating, SottoBadge                                                                                              | Shared primitives                                                                           |
| `layout/`        | TopBar, Footer, PublicNav, Sidebar, MobileNav                                                                                                                                                                                                                                                 | App shell                                                                                   |
| `player/`        | AudioPlayer, MiniPlayer, Waveform, PlaybackControls, TranscriptPanel, InterruptButton, InterruptChatPanel, ReferenceList, Teleprompter, ForkAttribution, ForkLineage, ForkRemixModal, ForkGraph, VersionHistory, ListeningQueue, SegmentQuestionBadge, ShareMenu, EmbedCodeModal, EmbedPlayer, CommunityQuestions, QuestionCard, CommentSection, CommentCard, CommentCompose, PostListenRating, ClaimFlagButton, PodcastJsonLd | Podcast playback + transcript + fork lineage + version history + Q&A + comments + sharing + embed + rating + claim flagging + structured data |
| `chat/`          | ChatContainer, ChatMessage, ChatChips, ResolutionPrompt                                                                                                                                                                                                                                       | Chat UI                                                                                     |
| `discovery/`     | DiscoveryChat, SuggestionChips, LanguageBanner, RecommendationCard, CreatorSuggestion, InterestGrid, InspireMe, InspireQuiz, InspireTrendingList, VoicePicker, VoiceCard, HumeVoiceBrowser                                                                                                     | Create flow + interest selection + topic inspiration + voice selection + language detection  |
| `create/`        | GenerationProgress, ScriptEditor, ModelDropdown, LlmModelDropdown, TtsModelDropdown, SttModelDropdown, DurationSelector                                                                                                                                                                      | Generation status + script review/edit + Cursor-style model dropdowns (LLM, TTS, STT) + duration  |
| `import/`        | ImportUploader, ImportProgress                                                                                                                                                                                                                                                                | Audio import: drag-and-drop upload + pipeline status                                        |
| `feed/`          | PodcastCard, FeedGrid, TagFilter, SearchBar, TrendingSection, UserSearchGrid, SuggestedFollows, ActivityFeed, ActivityItem                                                                                                                                                                    | Public feed + activity feed + user discovery + suggested follows                            |
| `profile/`       | ProfileHeader, PodcastList, FollowButton, FollowerCount, UserCard, FollowListModal                                                                                                                                                                                                            | User profiles + follower/following lists                                                    |
| `collections/`   | CollectionCard, AddToCollectionModal, CollectionDetail                                                                                                                                                                                                                                        | Curated podcast collections                                                                 |
| `voices/`        | VoiceMarketplaceCard, VoicePaymentModal                                                                                                                                                                                                                                                       | Voice marketplace browse + request cards + payment modal                                    |
| `notifications/` | NotificationBell, NotificationList, PushPrompt                                                                                                                                                                                                                                                | Notifications                                                                               |
| `settings/`      | VoicePreferenceSelector, TtsProviderCards, AiProviderCards                                                                                                                                                                                                                                    | Voice preferences + TTS/AI provider BYOK key management                                     |
| `landing/`       | LandingShell, LandingNav, AuthCTA, WaitlistForm, WaitlistProvider, JsonLd, PoweredByProviders                                                                                                                                                                                                | Landing page: shell (reveal+ripple), nav, auth CTA, waitlist, JSON-LD, provider badges      |
| `providers/`     | SessionProvider, AudioPlayerProvider, NotificationProvider, EventProvider, PageViewTracker, StripeProvider                                                                                                                                                                                    | React context providers + event tracking + Stripe Elements                                  |

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
