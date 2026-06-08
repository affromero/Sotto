# sotto-pencilkit

Native PencilKit ink-capture module for the Sotto mobile app.

## Requirements

This module contains native Swift code (`PKCanvasView` / PencilKit) and **cannot run inside Expo Go**. It requires a custom Expo dev client or a TestFlight / App Store build produced by EAS.

- iOS 14+ (PencilKit minimum)
- A custom dev build (see below)
- Apple Pencil, Scribble, or finger input — all accepted via `drawingPolicy = .anyInput`

## How it works

`index.ts` uses `requireOptionalNativeModule('SottoPencilKit')` to feature-detect the native layer. When the module is absent (Expo Go, Android), `isPencilKitAvailable` is `false` and `PencilKitCanvas` returns `null`. Callers must gate the ink overlay on that flag.

Ink is capture-only — strokes are never graded by the module itself. The host screen receives each drawing change as a base64-encoded `PKDrawing` via the `onChange` event and may forward it to the API (`POST /api/classes/[classId]/ink`).

## Rebuild after changes

```bash
# 1. Regenerate the native ios/ project
npx expo prebuild --platform ios --clean

# 2. Install pods
cd ios && pod install && cd ..

# 3. EAS dev build (installs on a connected device or simulator)
eas build --platform ios --profile development
```

For a simulator-only build without EAS:

```bash
npx expo run:ios
```

## Props

| Prop | Type | Description |
|------|------|-------------|
| `initialStrokes` | `string \| undefined` | Base64-encoded `PKDrawing` to restore on mount |
| `onChange` | `(base64: string) => void` | Called whenever the canvas drawing changes |
| `style` | `StyleProp<ViewStyle>` | Standard RN style |

## File layout

```
modules/sotto-pencilkit/
  index.ts                      JS interface (feature-detect + React wrapper)
  expo-module.config.json       Declares the apple module name
  app.plugin.js                 Expo config plugin (wires into app.json)
  ios/
    SottoPencilKit.podspec      CocoaPods spec
    SottoPencilKitModule.swift  ExpoModulesCore Module + PKCanvasView wrapper
  README.md                     This file
```
