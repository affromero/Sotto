# apps/ios/ — Universal iPhone + iPad Client

SwiftUI app that pairs with a self-hosted Sotto server and studies against its
`/api/v1` routes. **It is a client, never a configurator**: it holds no provider
keys and cannot set a server up. Where a feature depends on server
configuration, the app says so and points at the web app.

| Path                  | Contents                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| `Sotto.xcodeproj`     | Target `Sotto` (app) + `SottoTests`; bundle `fm.sotto.app`                            |
| `Sources/App/`        | Entry point, `SottoAppModel` + its extensions, layout, root                           |
| `Sources/Design/`     | `SottoTheme`, brand mark                                                              |
| `Sources/Models/`     | `Decodable` mirrors of the API payloads                                               |
| `Sources/Networking/` | `SottoAPIClient`, server-URL policy                                                   |
| `Sources/Storage/`    | Keychain credential store                                                             |
| `Sources/Live/`       | Gemini Live websocket protocol + duplex audio engine                                  |
| `Sources/Views/`      | Pairing, Profile, Learn, Practice, Exams, Placement, Memory, Workbook, Settings, Live |
| `Tests/`              | XCTest target, `@testable import Sotto`                                               |

## Build and test

```bash
xcodebuild test -project apps/ios/Sotto.xcodeproj -scheme Sotto \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)'
```

CI runs exactly that (`.github/workflows/release-surfaces-ci.yml`, job `ios`).
Test **both** families: the layout differs by size class.

## Conventions

- **Files are added by existing on disk.** Both targets use
  `PBXFileSystemSynchronizedRootGroup`, so never hand-edit `project.pbxproj` to
  register a new file. `Sources/Info.plist` has a membership exception so it is
  the target's plist rather than a bundled resource.
- **Layout comes from `SottoLayoutMode`**, injected once in `RootView` and read
  as `@Environment(\.sottoLayout)`. Do not read `horizontalSizeClass` directly.
  `regular` (iPad) keeps panels and the PencilKit workbook; `compact` (iPhone)
  is one column and reads the workbook as a plain PDF. An unknown size class
  resolves to `regular`.
- **Model methods wrap the client.** Views call `SottoAppModel`, which resolves
  the paired client via `makeClient()`. `SottoAppModel.swift` is near the repo's
  1000-line limit, so new calls go in an extension file.
- **Long routes need an explicit timeout.** Anything hitting a handler with
  `maxDuration = 300` (class and exam generation, practice start, every writing
  grade, placement) must pass `timeout: SottoAPIClient.generationTimeout`; the
  default is 60s.
- **Server-config failures are rewritten at the client boundary.** Routes
  answer a missing provider key with raw messages naming env vars and settings.
  Map them to "set this up on the web app" (see `SottoWritingFailure`,
  `SottoPlacementFailure`, `SottoLiveFailure`) rather than telling a learner to
  open settings they cannot reach.
- **Speaking uploads then polls; writing grades in the POST.** Both are
  parameterised over a source enum (`SpeakingPromptSource`,
  `WritingPromptSource`) so class, practice, and exam share one implementation.

## App Store

- Universal: `TARGETED_DEVICE_FAMILY = "1,2"`, iOS 18 minimum. iPhone is
  portrait-only; iPad supports all orientations.
- `Sources/PrivacyInfo.xcprivacy` declares no accessed-API reasons because the
  app uses none. Adding `UserDefaults`, file-timestamp APIs, or disk-space
  checks means adding a reason code, or the upload is rejected as ITMS-91053.
- Review needs a reachable demo server and a pairing code. `SottoServerURLPolicy`
  only allows HTTPS, or HTTP on a private/local address, so the demo server must
  be HTTPS.
- Verify a release build with:
  `xcodebuild archive -project apps/ios/Sotto.xcodeproj -scheme Sotto -configuration Release -destination 'generic/platform=iOS' -archivePath /tmp/Sotto.xcarchive`
