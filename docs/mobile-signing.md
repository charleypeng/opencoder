# Mobile Signing & Release Configuration

Placeholders and steps for releasing the mobile apps (iOS / Android).
Generated mobile projects live in `src-tauri/gen/` and are committed
(Tauri convention; only `gen/schemas` is git-ignored).

> Status (TASK-M7-01, 2026-08-05): **local machine has no signing
> configured** — iOS simulator debug builds run unsigned; Android SDK/JDK
> are not installed locally. CI verifies debug, unsigned compilation only.

## Bundle identifier

`com.opencode.opencoder` is set in `src-tauri/tauri.conf.json` (`identifier`)
and was applied by the rename task. iOS and Android projects pick it up from
there at init time.

- iOS: `PRODUCT_BUNDLE_IDENTIFIER` per target in
  `src-tauri/gen/apple/opencoder.xcodeproj` → `com.opencode.opencoder`.
- Android: `applicationId` in
  `src-tauri/gen/android/app/build.gradle.kts` → `com.opencode.opencoder`.

## iOS signing (App Store / TestFlight)

1. Add your Apple Developer account to Xcode
   (Settings → Accounts → `+`).
2. Open `src-tauri/gen/apple/opencoder.xcodeproj`, select the
   `opencoder` target → Signing & Capabilities.
3. Choose a **Development Team** (placeholder: none selected locally).
   Tauri keeps `CODE_SIGN_IDENTITY`/`DEVELOPMENT_TEAM` empty until set here —
   simulator builds do not require a team.
4. Create an App ID `com.opencode.opencoder` and a provisioning profile in
   the Apple Developer portal (or let Xcode manage signing automatically).
5. Archive for distribution via Xcode
   (Product → Archive → Distribute App), or:
   `pnpm tauri ios build --release` with a bundle type
   (`--target aarch64-app-store` etc. — see `tauri ios build --help`).
6. Upload the `.ipa` to App Store Connect
   (`xcrun altool` or Xcode Organizer) and fill in metadata/screenshots.

### Local placeholder config

- `DEVELOPMENT_TEAM`: leave unset for debug/simulator work. Set in the
  project or via `tauri.ios.conf.json` before device builds:
  ```json
  {
    "app": {},
    "ios": { "teamId": "<TEAM_ID>" }
  }
  ```
- Device builds additionally need an Apple Development certificate installed
  on the build machine.

## Android signing (Play Store)

1. Generate a keystore (keep it private, back it up — lost keystore = lost
   app identity):
   ```bash
   keytool -genkey -v -keystore opencoder.keystore \
     -alias opencoder -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Configure Gradle signing in `src-tauri/gen/android/` — placeholder:
   `app/build.gradle.kts` currently has **no** `signingConfigs` block
   (debug builds are signed with the debug keystore automatically).
   Reference template (do not commit secrets; use env vars / CI secrets):
   ```kotlin
   android {
     signingConfigs {
       create("release") {
         storeFile = file(System.getenv("KEYSTORE_PATH"))
         storePassword = System.getenv("KEYSTORE_PASSWORD")
         keyAlias = System.getenv("KEY_ALIAS")
         keyPassword = System.getenv("KEY_PASSWORD")
       }
     }
     buildTypes {
       release {
         signingConfig = signingConfigs.getByName("release")
       }
     }
   }
   ```
3. Build the release AAB:
   `cd src-tauri/gen/android && ./gradlew bundleRelease`
   (via Tauri: `pnpm tauri android build --release`).
4. Upload the `.aab` (from
   `src-tauri/gen/android/app/build/outputs/bundle/release/`) to Google Play
   Console, fill in app content, and roll out to testing tracks.

## Current environment status (2026-08-05)

| Component | Local machine | CI (mobile.yml) |
| --- | --- | --- |
| Xcode | 26.0.1 ✓ | macos-latest ✓ |
| iOS Rust targets | `aarch64-apple-ios`, `aarch64-apple-ios-sim` ✓ | via dtolnay/rust-toolchain + tauri auto-install |
| Rust toolchain | rustup `stable-aarch64-apple-darwin` (PATH must include `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin` — Homebrew rust is default on PATH) | dtolnay/rust-toolchain@stable |
| Android SDK / NDK | **missing** (no `ANDROID_HOME`, no `~/Library/Android/sdk`) | android-actions/setup-android@v3 (NDK 27.2) |
| JDK | **missing** (no Java runtime) | temurin 17 |
| iOS signing | none (simulator unsigned) | n/a (debug, unsigned) |
| Android signing | none (debug keystore only) | n/a (debug, unsigned) |

Local Android setup (when needed):
1. Install JDK 17 (e.g. `brew install --cask temurin@17`).
2. Install Android Studio (or `brew install --cask android-commandlinetools`).
3. Accept licenses: `sdkmanager --licenses`, install
   `platform-tools platforms;android-35 build-tools;35.0.0 ndk;27.2.12479018`.
4. Export `ANDROID_HOME` and `NDK_HOME`.
