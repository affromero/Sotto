# LaunchVideoScript Authoring Guide

Use this guide when crafting a `LaunchVideoScript` JSON for the Sotto Launch Video Studio. The JSON is authored in Claude Code sessions, then imported into the DemoStudio UI for orchestration.

## Schema Version

Always set `"version": 1`.

## Top-Level Structure

```json
{
  "version": 1,
  "project": {
    "title": "Sotto Language Launch",
    "description": "Optional description"
  },
  "defaults": {
    "ttsProvider": "elevenlabs",
    "ttsModel": "eleven_v3",
    "ttsVoiceId": "<voice-id>",
    "backgroundMusicUrl": "https://media.example.com/demos/music/bg.mp3",
    "backgroundMusicVolume": 0.08,
    "subtitles": { "enabled": true, "style": "cinematic", "position": "bottom" }
  },
  "scenes": [...]
}
```

## Available TTS Providers

| Provider | ID | Models | Notes |
|----------|-----|--------|-------|
| ElevenLabs | `elevenlabs` | `eleven_v3`, `eleven_flash_v2_5`, `eleven_turbo_v2`, `eleven_multilingual_v2` | Premium quality |
| OpenAI | `openai` | `tts-1-hd`, `tts-1`, `gpt-4o-mini-tts` | Reliable |
| Cartesia | `cartesia` | `sonic-3`, `sonic-turbo`, `sonic-2` | Low latency |
| Hume | `hume` | `octave-v1` | Emotional expression |
| Fal | `fal` | `qwen3-tts-1.7b`, `qwen3-tts-0.6b` | Open-source |

Each scene can override the default TTS provider with `ttsProvider`, `ttsModel`, `ttsVoiceId`.

## Scene Structure

```json
{
  "title": "Landing Page Introduction",
  "narration": "Learn a language, taught in your own context...",
  "actions": [...],
  "sfx": { ... },
  "providerBanner": { ... },
  "avatar": { ... },
  "overlays": [...],
  "subtitles": { ... },
  "transition": { "type": "fade" },
  "ttsProvider": "openai",
  "ttsVoiceId": "alloy"
}
```

Only `title`, `narration`, and `actions` are required. Everything else is optional.

## Actions (13 Types)

Actions choreograph the browser recording. They execute sequentially via Playwright.

### Navigation & Waiting

```json
{ "type": "navigate", "url": "https://your-domain.example" }
{ "type": "wait", "ms": 1500 }
{ "type": "waitForSelector", "selector": ".hero-title", "timeout": 5000 }
```

### Mouse & Keyboard

```json
{ "type": "click", "selector": "button.cta" }
{ "type": "hover", "selector": ".nav-link" }
{ "type": "type", "selector": "textarea.chat-input", "text": "Tell me about quantum computing", "speed": { "min": 30, "max": 80 } }
{ "type": "keypress", "key": "Enter" }
```

- `click` triggers a realistic mouse move + click (with SFX if enabled)
- `type` types character-by-character with random delays (speed in ms per char)
- `keypress` presses a single key (Enter, Escape, Tab, etc.)

### Scroll & Zoom

```json
{ "type": "scroll", "distance": 400, "duration": 1200 }
{ "type": "zoom", "selector": ".script-panel", "scale": 1.5, "duration": 800 }
{ "type": "zoomReset", "duration": 500 }
```

- `scroll` scrolls the page by `distance` pixels over `duration` ms
- `zoom` zooms into an element (CSS transform); `zoomReset` restores

### Interceptors

Interceptors mock API responses so the video shows instant results instead of loading spinners. All intercepted content is **real pre-generated data** — the interceptor just skips the wait.

```json
{ "type": "intercept", "name": "discovery", "options": { "podcastId": "abc123" } }
{ "type": "intercept", "name": "interact", "options": { "podcastId": "abc123" } }
{ "type": "intercept", "name": "scriptApprove", "options": { "podcastId": "abc123" } }
{ "type": "intercept", "name": "avatar", "options": { "videoUrl": "https://media.example.com/demos/avatars/clip.mp4" } }
{ "type": "clearIntercept", "name": "discovery" }
```

Available interceptors:
- `discovery` — mock topic discovery (instant podcast creation)
- `interact` — mock chat interaction (instant AI responses)
- `scriptApprove` — mock script approval
- `avatar` — mock avatar session (instant READY with pre-generated video)

### Screenshot

```json
{ "type": "screenshot", "label": "after-script-review" }
```

Takes a screenshot for debugging. Not included in final video.

## SFX Configuration

```json
{
  "sfx": {
    "clickSounds": true,
    "typingSounds": true,
    "ambientUrl": "https://media.example.com/demos/sfx/ambient-soft.mp3",
    "ambientVolume": 0.1,
    "cues": [
      { "atSeconds": 3.5, "sfxUrl": "https://media.example.com/demos/sfx/whoosh.mp3", "volume": 0.4 }
    ]
  }
}
```

- `clickSounds`/`typingSounds` default to `true` — set `false` to silence
- `ambientUrl` loops for the scene duration
- `cues` place custom SFX at exact timestamps within the scene

SFX timing for clicks/keystrokes is automatic — derived from the action timing log recorded during the browser session.

## Provider Banner

Shows which TTS provider is being used. Useful for voice comparison scenes.

```json
{
  "providerBanner": {
    "provider": "ElevenLabs",
    "showAtSeconds": 0,
    "hideAtSeconds": null,
    "position": "bottom-right"
  }
}
```

- `hideAtSeconds: null` means the banner stays for the entire scene
- Positions: `bottom-left`, `bottom-right`, `top-left`, `top-right`
- Rendered as a semi-transparent dark box with white text (Inter Bold)

## Avatar PiP (Picture-in-Picture)

Overlays a pre-generated avatar video clip as a floating window.

```json
{
  "avatar": {
    "videoUrl": "https://media.example.com/demos/avatars/mina-speaking.mp4",
    "posX": 0.72,
    "posY": 0.05,
    "width": 0.25,
    "height": 0.35,
    "maskShape": "rounded",
    "showAtSeconds": 2,
    "hideAtSeconds": null
  }
}
```

- All positions/sizes are normalized 0.0-1.0 relative to video dimensions
- `maskShape`: `none` (rectangular), `rounded` (rounded corners), `circle`
- The avatar clip must be pre-generated and uploaded to R2 before import

## Text Overlays

Timed text that appears over the video.

```json
{
  "overlays": [
    {
      "text": "Place. Practice. Progress.",
      "position": "center",
      "showAtSeconds": 1,
      "hideAtSeconds": 4,
      "fontSize": 36,
      "backgroundColor": "rgba(0,0,0,0.7)",
      "textColor": "#FFFFFF"
    }
  ]
}
```

Positions: `center`, `bottom-center`, `top-center`, `bottom-left`, `bottom-right`.

## Subtitles

Auto-generated from the narration text, split into ~8-word chunks distributed evenly across the voiceover duration.

```json
{
  "subtitles": {
    "enabled": true,
    "style": "cinematic",
    "position": "bottom",
    "fontSize": 32
  }
}
```

- `style: "default"` — white text with black outline
- `style: "cinematic"` — larger text with semi-transparent background box
- Can be set in `defaults` (applies to all scenes) or per-scene

## Transitions

Applied between scenes during composition.

```json
{ "transition": { "type": "fade" } }
```

Types: `fade`, `dissolve`, `wipe`.

## Authoring Tips

1. **Start with interceptors** — set up interceptors before the actions that trigger API calls. Clear them when done.

2. **Narration drives pacing** — the voiceover audio length determines scene duration. Write narration that matches the action tempo. Short narration = short scene.

3. **Use `wait` generously** — add 500-1500ms waits between major actions for visual breathing room. The video feels rushed without them.

4. **Provider banners for comparison** — when showcasing multiple TTS providers, use consecutive scenes with different `ttsProvider` and matching `providerBanner`. This creates a "voice comparison" segment.

5. **SFX defaults are good** — `clickSounds` and `typingSounds` are on by default. Only override if you want to silence a quiet/narrative-only scene.

6. **Background music volume** — keep at 0.05-0.10. Higher drowns out narration.

7. **Avatar clips** — generate these in advance using the Avatar step in DemoStudio. Reference the R2 URL in the script.

8. **Scene ordering** — scenes compose in array order. Each scene is recorded independently, then stitched with transitions.

9. **Real content** — everything shown in the video (podcasts, scripts, audio, video) must exist in the database first. The interceptors skip the generation wait but serve the real content.

10. **Test incrementally** — import and record one scene at a time to verify timing before importing the full script.
