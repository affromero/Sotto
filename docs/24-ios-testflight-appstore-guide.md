# iOS TestFlight & App Store Guide

> Step-by-step walkthrough for building, testing, and shipping the Sotto iOS app.

## Prerequisites

| Requirement | Details |
|-------------|---------|
| Apple Developer Account | $99/year — [developer.apple.com](https://developer.apple.com/programs/) |
| EAS CLI | `npm install -g eas-cli` |
| Expo account | Free — `eas login` |
| Xcode 16+ | Required for local builds and simulator testing |
| Physical iOS device | Required for push notification testing |

---

## 1. Apple Developer Account Setup

1. Enroll at [developer.apple.com/programs](https://developer.apple.com/programs/) ($99/year)
2. Complete identity verification (takes 24-48 hours)
3. Note your **Team ID** — visible in [Membership](https://developer.apple.com/account/#/membership)
4. Note your **App Apple ID** — visible in App Store Connect → App Information → Apple ID
5. Add the `submit` block to `apps/mobile/eas.json`:
   ```json
   "submit": {
     "production": {
       "ios": {
         "appleId": "me@afromero.co",
         "ascAppId": "<Apple ID from App Store Connect>",
         "appleTeamId": "<Team ID from developer.apple.com>"
       }
     }
   }
   ```

---

## 2. EAS Build Setup

```bash
cd apps/mobile

# Link to Expo account + create EAS project
eas init

# Configure build (auto-detects Expo project)
eas build:configure
```

This generates/updates `eas.json` with build profiles and links the project to your Expo account.

### Certificates & Provisioning

EAS handles certificates automatically on first build. If you need manual control:

```bash
# Let EAS manage certificates (recommended)
eas credentials

# View current credentials
eas credentials --platform ios
```

EAS creates and stores:
- **Distribution certificate** — signs the binary
- **Provisioning profile** — links cert to bundle ID (`fm.sotto.app`)
- **Push notification key** — for expo-notifications

---

## 3. Development Build

A development build is a debug build with the Expo dev client baked in. Faster iteration than Expo Go, supports native modules like `react-native-track-player`.

```bash
# Build for iOS Simulator
eas build --platform ios --profile development --local

# Build for physical device (over-the-air install)
eas build --platform ios --profile development
```

After the build completes:
- **Simulator**: drag the `.app` file onto the simulator
- **Physical device**: scan the QR code from the EAS build page, or install via the Expo dashboard

### Running with the dev build

```bash
# Start Metro bundler
cd apps/mobile
npx expo start --dev-client

# The dev build on your device/simulator connects to this Metro server
```

---

## 4. TestFlight — Internal Testing

Internal testers = your Apple Developer account team members (up to 100 people). No App Review required.

### Build for TestFlight

```bash
# Preview profile = TestFlight-ready build
eas build --platform ios --profile preview
```

### Upload to App Store Connect

```bash
# Auto-upload after build completes
eas submit --platform ios --latest
```

Or upload manually:
1. Download the `.ipa` from the EAS build dashboard
2. Open **Transporter** (macOS app from Apple)
3. Drag the `.ipa` into Transporter → click Deliver

### Set Up Internal Testing

1. Go to [App Store Connect](https://appstoreconnect.apple.com/) → My Apps → Sotto
2. Click **TestFlight** tab
3. Under **Internal Testing**, click **+** → create a group (e.g., "Core Team")
4. Add testers by Apple ID email — they get an invite via TestFlight app
5. Select the uploaded build → enable testing
6. Testers install via the **TestFlight** app on their iPhones

### What testers need

- iPhone running iOS 14.0+ (our minimum target)
- TestFlight app installed (free from App Store)
- Apple ID that you've added as a tester

---

## 5. TestFlight — External Testing

External testers = anyone you invite (up to 10,000). Requires **Beta App Review** (usually 24-48 hours, shorter than full review).

### Submit for Beta Review

1. App Store Connect → TestFlight → External Testing
2. Create group (e.g., "Beta Users")
3. Select build → "Submit for Review"
4. Fill in:
   - **What to test**: describe key flows (create podcast, listen, ask questions)
   - **Contact info**: support email
   - **Sign-in credentials**: test account email/password if login is required
5. Wait for approval (typically same day or next day)

### Inviting external testers

- **By email**: add up to 10,000 email addresses
- **Public link**: generate a TestFlight public link (shareable, 10,000 installs max)

---

## 6. App Store Submission

### Build for production

```bash
eas build --platform ios --profile production
```

### Upload

```bash
eas submit --platform ios --latest
```

### App Store Connect — Fill Out Metadata

Go to App Store Connect → My Apps → Sotto → App Store tab:

**App Information**:
- Name: `Sotto`
- Subtitle: `Podcasts that listen back`
- Primary category: Education
- Secondary category: News
- Age rating: 12+ (AI-generated content)

**Pricing**: Free (billing handled via web, not IAP)

**Version Information** (for each localization):
- Description (see `docs/15-ios-app-strategy.md` for copy)
- Keywords: `podcast, AI, learning, education, audio, interactive, voice`
- Support URL: `https://sotto.fm/support`
- Marketing URL: `https://sotto.fm`

**Screenshots** (required sizes):
- 6.7" (iPhone 15 Pro Max): 1290 x 2796 px
- 6.5" (iPhone 15 Plus): 1284 x 2778 px
- 5.5" (iPhone 8 Plus): 1242 x 2208 px

Capture screenshots on simulators matching each size, or use a tool like [shots.so](https://shots.so) for framed screenshots.

**App Review Information**:
- Contact: your name + email + phone
- Demo account: provide test credentials if the app requires login
- Notes: "This is an AI podcast app. All AI-generated content is labeled with an 'AI-Generated' badge."

**Privacy**:
- Privacy policy URL: `https://sotto.fm/privacy`
- Privacy nutrition label:
  - Data Linked to You: email, user content (podcasts), identifiers (push token)
  - Data Not Linked to You: diagnostics
  - Data Used to Track You: none

### Submit for Review

Click **Submit for Review**. First submissions take 1-3 days (sometimes longer). Subsequent updates are faster (often same day).

---

## 7. Post-Submission

### Monitor review status

- Check App Store Connect daily
- You'll get email notifications for status changes
- Status flow: `Waiting for Review` → `In Review` → `Ready for Distribution` (or `Rejected`)

### Responding to rejection

1. Read the rejection reason carefully in Resolution Center
2. Fix the issue
3. Reply in Resolution Center explaining what changed
4. Resubmit the build
5. Turnaround is usually faster for resubmissions (same day)

### Release options

- **Manual release**: you click "Release" when ready
- **Automatic**: release as soon as approved
- **Phased release**: roll out to 1%, 2%, 5%, 10%, 20%, 50%, 100% over 7 days

---

## 8. OTA Updates (No App Store Review)

For JS-only changes (no native module additions/changes), use EAS Update to push over-the-air:

```bash
# Push an update to the production branch
eas update --branch production --message "fix: correct player timestamp display"

# Push to preview (TestFlight) branch
eas update --branch preview --message "feat: add share button to player"
```

**What qualifies for OTA**: any change to JS/TS files, assets, or styles.

**What requires a new build**: adding/removing native modules (e.g., adding `expo-camera`), bumping Expo SDK, changing `app.json` native config (bundle ID, permissions, etc.).

---

## 9. Common Gotchas

| Issue | Solution |
|-------|----------|
| Build fails with "no provisioning profile" | Run `eas credentials` to regenerate |
| TestFlight build stuck "Processing" | Wait up to 30 min; Apple processes the binary |
| "Missing compliance" warning | Go to App Store Connect → TestFlight → click the build → fill export compliance (select "No" for encryption if you only use HTTPS) |
| Rejection: "AI content not labeled" | Add "AI-Generated" badge on all podcast cards |
| Rejection: "missing privacy policy" | Publish at `sotto.fm/privacy` and link in App Store Connect |
| Rejection: "app is a repackaged website" | Emphasize native features: background audio, push notifications, offline playback |
| Push notifications not working on TestFlight | Ensure push notification key is configured: `eas credentials --platform ios` |
| Background audio stops after 30s | Verify `UIBackgroundModes: ["audio"]` in `app.json` and that `react-native-track-player` is properly initialized |

---

## 10. Version Bumping

Update version in `apps/mobile/app.json`:

```json
{
  "expo": {
    "version": "1.0.0"   // User-facing version (shown in App Store)
  }
}
```

EAS auto-increments the build number. To set it manually:

```json
{
  "expo": {
    "ios": {
      "buildNumber": "42"  // Internal build number (must increment each upload)
    }
  }
}
```

Or let EAS auto-increment in `eas.json`:

```json
{
  "build": {
    "production": {
      "autoIncrement": true
    }
  }
}
```

---

## Checklist

### Pre-TestFlight
- [ ] Apple Developer account active
- [ ] `eas init` + `eas build:configure` done
- [ ] `eas.json` has correct `appleTeamId`
- [ ] Development build runs on device/simulator
- [ ] All screens navigable, no crashes
- [ ] API calls work against staging/production backend

### Pre-App Store
- [ ] Privacy policy live at `sotto.fm/privacy`
- [ ] Terms of service live at `sotto.fm/terms`
- [ ] App Store screenshots captured (3 device sizes)
- [ ] App description + keywords written
- [ ] Privacy nutrition label filled out
- [ ] "AI-Generated" badge visible on all podcast content
- [ ] Background audio works when app is backgrounded
- [ ] Push notifications register and deliver
- [ ] Export compliance answered (TestFlight → build → "Missing Compliance")
- [ ] TestFlight beta tested by at least 10 users
- [ ] No console warnings or crash loops

### Post-Launch
- [ ] Monitor crash reports (Sentry / Expo dashboard)
- [ ] Respond to App Review feedback within 24h
- [ ] Set up OTA update branch for quick fixes
- [ ] Plan first App Store update (v1.0.1) for post-launch fixes
