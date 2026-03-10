# CLAUDE.md — Admin Showcase (Launch Video Studio)

Admin-only UI for creating cinematic product launch videos.

## Workflow (7 Steps)

1. **Script** — Import or generate a launch video script (`/api/admin/demo` POST)
2. **Podcast** — Link a podcast episode for audio + timing
3. **Video** — Classify and generate visuals per scene
4. **Avatar** — Generate avatar clips (optional)
5. **Recording** — Capture/upload scene recordings via Playwright on the Remotion sidecar
6. **Timing** — Fine-tune timing segments, transitions, SFX cues
7. **Compose** — Final video composition → `POST /api/admin/demo/[projectId]/compose`

## Components

| Component | File | Purpose |
|-----------|------|---------|
| DemoStudio | `DemoStudio.tsx` | Main orchestrator — manages project state + step navigation |
| ScriptViewer | `ScriptViewer.tsx` | Display/edit launch video script |
| PodcastPrep | `PodcastPrep.tsx` | Link podcast episode to project |
| VideoReview | `VideoReview.tsx` | Per-scene visual classification and review |
| AvatarPrep | `AvatarPrep.tsx` | Avatar clip generation workflow |
| TimingEditor | `TimingEditor.tsx` | Timing segments, speed zones, transitions |
| ActionEditor | `ActionEditor.tsx` | Edit action timing log for SFX (click/type events) |

## Video Pipeline

```
DemoProject.scenes → demo-composition.worker.ts
  → Probes durations via GET /probe?url=
  → POST /render with compositionId='LaunchVideo'
  → Remotion renders LaunchVideo composition (packages/video/)
  → Polls /render/:jobId/status
  → Downloads /render/:jobId/output → uploads to R2
```

**IMPORTANT**: As of the Remotion unification, composition goes through `POST /render` with
`compositionId='LaunchVideo'`, NOT through the deprecated `POST /stitch` route.

## Data Model

- `DemoProject` — top-level container (title, status, videoUrl, backgroundMusicUrl, etc.)
- `DemoScene` — per-scene: narration, recordingUrl, voiceoverUrl, visualUrl, transitionUrl,
  timingSegments (JSON), sfxConfig (JSON), actionTimingLog (JSON), providerBanner (JSON),
  overlays (JSON), subtitles (JSON), avatarConfig (JSON)
- All JSON fields are Prisma `Json?` columns — cast via `as unknown as Type` when reading

## API Routes

All under `/api/admin/demo/` — require admin auth.

| Route | Method | What |
|-------|--------|------|
| `/` | GET/POST | List/create projects |
| `/[projectId]` | GET/PATCH | Fetch/update project |
| `/[projectId]/import-script` | POST | Replace scenes from script JSON |
| `/[projectId]/podcast` | GET/POST | Link podcast episode |
| `/[projectId]/compose` | POST | Queue final composition |
| `/[projectId]/scenes` | GET/POST | List/create scenes |
| `/[projectId]/scenes/[sceneId]` | PATCH | Update scene |
| `/[projectId]/scenes/[sceneId]/voiceover` | POST | Queue TTS generation |
| `/[projectId]/scenes/[sceneId]/visual` | POST | Queue visual generation |

## Queue Jobs

- `demoScriptQueue` — script/scene generation
- `demoVoiceoverQueue` — per-scene TTS
- `demoVisualQueue` — per-scene visual
- `demoCompositionQueue` → `demo-composition.worker.ts` — final Remotion render

## LaunchVideo Composition (packages/video/)

The `LaunchVideo` Remotion composition handles:
- **Timing segments**: speed zones (0=skip, 1=normal, 8=fast) via `playbackRate`
- **Voiceover sync**: recording stretched to match voiceover duration
- **SFX**: click/keystroke from action timing log, ambient loops, custom cues
- **Provider banners**: spring-animated badge showing TTS provider
- **Text overlays**: positioned divs with fade-in/out
- **Subtitles**: word-highlighted chunks from narration text
- **Avatar PiP**: timed show/hide with AvatarEntrance spring animation
- **Background music**: looped with 3-second fade-out
- **Color grading**: CSS filter (brightness, saturate, contrast)
