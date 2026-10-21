# Native Android

Standalone Kotlin and Compose client in package `fm.sotto.app`, outside npm workspaces.
Its initial scope is canonical server pairing and complete two-player games.
Solo courses stay in the web/iOS clients. Explicit Add to study uses the existing API.

Use Java 21 and an Android SDK with API 37 and build-tools 36.0.0:

```sh
./gradlew lint testDebugUnitTest assembleDebug assembleRelease bundleRelease
./gradlew connectedDebugAndroidTest
```

The connected gate runs on attached task-owned Android 16 and 17 emulators.
Actual process-stop recovery uses a host fixture and requires explicit emulator selection:

```sh
./gradlew assembleDebug assembleDebugAndroidTest
node ../../e2e/android/process.mjs emulator-5580
```

The driver only accepts emulator serials and installs the test APKs. It verifies exact
uncertain-action replay and original credential recovery across force-stop. On Android 17
it also denies, grants and revokes local-network permission against the emulator host bridge.
These externally staged tests are excluded from the ordinary connected gate by annotation.

Keep the verified Gradle wrapper and pinned version catalogue. Never commit SDK paths,
signing keys or passwords. Release artifacts remain unsigned until actual signing is configured.

All network traffic uses `network/SottoClient.kt`. Play never follows redirects, uses
cookies, caches private responses or sends a browser Origin. Temporary household pairing
uses its own origin-bound ephemeral cookie client. HTTPS is required outside syntactically
local/private hosts. Manifest cleartext support exists for self-hosted local HTTP only;
the central request policy must reject public HTTP before connecting.
Android 17 local-network permission is enforced centrally before all private/local requests,
including polling and recovery. Permission changes never submit saved mutations automatically.
Keep explicit app-wide permission copy and the Settings path for private split-DNS servers.

An application-scoped ProtectedStore serializes authenticated AndroidKeyStore encryption
and atomic no-backup persistence. Credentials, proofs and drafts never enter saved-state
bundles, ordinary preferences, logs, intent extras or backups. Storage failures are visible.
Preserve received credentials and exact uncertain mutations until recovery or explicit
ID-bound abandonment. No plaintext or authentication fallback.

MainActivity handles cold and warm links through the strict invitation parser. Only a
focused, resumed game surface renews host presence. Every foreground lifetime has a new
nonce; background/navigation cancels old work and releases that lifetime's lease.

Use native Compose, Sotto paper/blue/ink colors, serif headings, 48dp touch targets,
scrollable keyboard-safe forms, dark mode and responsive tablet widths. Server projections
and allowed actions control visibility. Never reconstruct another player's hidden state.

JVM and instrumented tests consume the exact shared Play fixture bytes. Mock only system
boundaries. Keep files below 1000 lines and at most ten code files per new directory.
