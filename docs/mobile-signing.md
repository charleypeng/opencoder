# Mobile Signing & Release Configuration

Signing and release documentation for the mobile apps (iOS / Android).
Generated mobile projects live in `src-tauri/gen/` and are committed
(Tauri convention; only `gen/schemas` is git-ignored). `gen/apple` is
committed (TASK-M7-01); `gen/android` is NOT — the local machine has no
Android SDK/JDK, so CI scaffolds it with `tauri android init` (TASK-M10-03).

> Status (TASK-M10-03, 2026-08-05): **local machine has no signing
> configured** — iOS simulator RELEASE builds run unsigned and are verified
> locally + in CI (install + launch on the simulator ✓); iOS device RELEASE
> builds compile unsigned into a non-installable `.ipa` (verified locally ✓,
> CI best-effort job); Android SDK/JDK are not installed locally
> (env-blocked, documented below); CI verifies the iOS simulator release,
> iOS device release unsigned (best-effort) and Android debug (required) +
> release (best-effort).

## Bundle identifier

`com.opencode.opencoder` is set in `src-tauri/tauri.conf.json` (`identifier`)
and was applied by the rename task. iOS and Android projects pick it up from
there at init time.

- iOS: `PRODUCT_BUNDLE_IDENTIFIER` per target in
  `src-tauri/gen/apple/opencoder.xcodeproj` → `com.opencode.opencoder`.
- Android: `applicationId` in
  `src-tauri/gen/android/app/build.gradle.kts` → `com.opencode.opencoder`.

## Permissions minimalism

The app asks for **camera only** — used exclusively for QR-code server
scanning (TASK-M7-08, `tauri-plugin-barcode-scanner`).

- iOS: `NSCameraUsageDescription` is the only usage description
  ("Scan an OpenCode connect QR code to add a server."), present in both
  `src-tauri/gen/apple/opencoder_iOS/Info.plist` and its XcodeGen source
  `src-tauri/gen/apple/project.yml` (keep the two in sync; a regenerated
  Info.plist must be re-checked — TASK-M7-08 note).
- Android: `CAMERA` goes into `AndroidManifest.xml` when the gen/android
  scaffold lands (TASK-M7-08 appendix has the note). Nothing else is added
  beyond the platform template defaults (e.g. `INTERNET`).
- No location / photos / mic / contacts / notifications-on-Android
  permissions are declared anywhere.

## iOS signing (App Store / TestFlight)

1. Add your Apple Developer account to Xcode
   (Settings → Accounts → `+`).
2. Open `src-tauri/gen/apple/opencoder.xcodeproj`, select the
   `opencoder` target → Signing & Capabilities.
3. Choose a **Development Team**. Tauri keeps
   `CODE_SIGN_IDENTITY`/`DEVELOPMENT_TEAM` empty until set here — simulator
   builds do not require a team.
4. Create an App ID `com.opencode.opencoder` and a provisioning profile in
   the Apple Developer portal (or let Xcode manage signing automatically).
5. Archive for distribution via Xcode
   (Product → Archive → Distribute App), or:
   `pnpm tauri ios build --target aarch64 --ci --export-method app-store-connect`
   (release is the default build mode; `--debug` is the opt-out).
6. Upload the `.ipa` to App Store Connect
   (`xcrun altool` or Xcode Organizer) and fill in metadata/screenshots.

### Release build modes (verified TASK-M10-03)

| Target | Command (release) | Signing | Outcome |
| --- | --- | --- | --- |
| Simulator (aarch64-sim) | `pnpm tauri ios build --target aarch64-sim --ci --no-sign` | none needed | ✓ verified locally + CI (required job). App bundle at `src-tauri/gen/apple/build/arm64-sim/opencoder.app` (12MB; install + launch on the iPhone 17 simulator ✓) |
| Device (aarch64) | `pnpm tauri ios build --target aarch64 --ci --no-sign` | unsigned (needs team for install) | ✓ compiles to a 6.5MB `.ipa` at `src-tauri/gen/apple/build/arm64/opencoder.ipa` — verified unsigned (`code object is not signed at all`, no provisioning profile), NOT installable; CI best-effort job runs the same command |
| Device (App Store) | `pnpm tauri ios build --target aarch64 --ci --export-method app-store-connect` | team + distribution profile | needs a signing team (Xcode `DEVELOPMENT_TEAM`) + certificates; CI signing can ride the `IOS_CERTIFICATE` / `IOS_CERTIFICATE_PASSWORD` / `IOS_MOBILE_PROVISION` env vars |

`--no-sign` skips code signing when bundling, so unsigned device bundles
compile without a team — they just cannot be installed on a device (ad-hoc
signing would be needed for that).

### Where the team ID comes from

- Locally: Xcode → target → Signing & Capabilities sets `DEVELOPMENT_TEAM`
  in the project (persisted into `src-tauri/gen/apple/opencoder.xcodeproj`
  and mirrored by the XcodeGen source `src-tauri/gen/apple/project.yml`;
  `tauri ios build` syncs identifier/team/lib name from the project,
   tauri-cli 2.11 — there is NO `ios.teamId` key in the Tauri config schema;
   the replacement is `ios.developmentTeam` (JSON alias `development-team`)
   in tauri.ios.conf.json, or the `APPLE_DEVELOPMENT_TEAM` env var).
- CI: tauri-cli sets up signing automatically from the
  `IOS_CERTIFICATE` / `IOS_CERTIFICATE_PASSWORD` / `IOS_MOBILE_PROVISION`
  environment variables (imports the cert, installs the provisioning
  profile) — the secrets-based route for a future signed CI job; the
  current mobile.yml stays unsigned on purpose.
- Device builds additionally need an Apple Development certificate
  installed on the build machine (locally) or the env vars above (CI).

### App Store Connect submission checklist (TASK-M10-03)

1. **Screenshots** — required per device family; capture from the matching
   simulators (Xcode → Simulator → File > Save Screen Shot):
   - iPhone 6.7" (iPhone 16 Pro Max class): 1290×2796
   - iPhone 6.5": 1284×2778, iPhone 5.5": 1242×2208 (when 6.7"/6.5" are
     both shown, the 5.5" slot is optional; App Store Connect lists the
     exact slots for the current app record)
   - iPad 12.9" (optional, iPad support is declared): 2048×2732
   - Localized per storefront; 6.5" (or 6.7") + 12.9" are the minimum.
     Screenshots cannot be produced on this machine headless — capture on a
     macOS machine with Xcode simulators installed, or from a real device
     (Xcode → Window → Devices and Simulators → Take Screenshot).
2. **Privacy manifest (PrivacyInfo.xcprivacy)** — required for App Store
   submissions since May 1, 2024 (iOS 17+ SDK) when the app uses declared
   "required-reason" APIs. This app: no tracking, no third-party SDKs, no
   analytics; camera usage is declared via `NSCameraUsageDescription`
   (a privacy manifest is for *collected data* and required-reason APIs,
   not usage descriptions). Decision: **not added yet** — before the first
   submission, run the App Store Connect "Privacy" questionnaire and add a
   minimal `PrivacyInfo.xcprivacy` (NSPrivacyTracking: NO,
   NSPrivacyCollectedDataTypes: none, NSPrivacyAccessedAPITypes: only what
   the Rust/plugin stack actually uses, e.g. `NSPrivacyAccessedAPICategoryUserDefaults`
   with reason `CA92.1` if `UserDefaults` is touched) into
   `src-tauri/gen/apple/opencoder_iOS/` + `project.yml` if Apple's tooling
   flags anything.
3. **Age rating** — complete the App Store Connect questionnaire (no
   violence/gambling; the app renders user-generated chat content, so
   answer the user-content questions honestly — expected 4+ with the
   user-generated-content flags, which also imply the moderation/reporting
   question must be answered).
4. **App privacy "Nutrition Labels"** — App Store Connect → App Privacy:
   declare "Data Not Collected" unless the questionnaire mapping says
   otherwise.
5. Version/bundle sync: `CFBundleShortVersionString` 0.1.0 + `CFBundleVersion`
   0.1.0 come from the Tauri config (`src-tauri/gen/apple/project.yml`),
   `tauri ios build --build-number N` bumps the latter.
6. TestFlight internal build → smoke test on a real device before release
   (the M10-06 regression checklist covers device items).

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
   (via Tauri: `pnpm tauri android build` — release is the default).
4. Upload the `.aab` (from
   `src-tauri/gen/android/app/build/outputs/bundle/release/`) to Google Play
   Console, fill in app content, and roll out to testing tracks.

### Release build state (TASK-M10-03)

- `tauri android build` (release) **without** the signingConfigs block
  fails — expected. The debug build (`tauri android build --debug`) signs
  with the auto-generated debug keystore and is the CI verification chain.
- CI (mobile.yml android job): init + debug build (required) + release
  build (best-effort, continue-on-error — fails without a keystore).
- Local machine: **no Android SDK/JDK** (env-blocked, TASK-M7-01) — the
  gen/android scaffold, the CAMERA manifest entry and the signingConfigs
  block all land once the environment is available; the steps are
  documented in docs/tasks/M7.md and above.

## Current environment status (2026-08-05)

| Component | Local machine | CI (mobile.yml) |
| --- | --- | --- |
| Xcode | 26.0.1 ✓ | macos-latest ✓ |
| iOS Rust targets | `aarch64-apple-ios`, `aarch64-apple-ios-sim` ✓ | via dtolnay/rust-toolchain + tauri auto-install |
| Rust toolchain | rustup `stable-aarch64-apple-darwin` (PATH must include `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin` — Homebrew rust is default on PATH) | dtolnay/rust-toolchain@stable |
| Android SDK / NDK | **missing** (no `ANDROID_HOME`, no `~/Library/Android/sdk`) | android-actions/setup-android@v3 (NDK 27.2) |
| JDK | **missing** (no Java runtime) | temurin 17 |
| iOS signing | none (simulator unsigned; device needs team) | n/a (unsigned) |
| Android signing | none (debug keystore only) | debug keystore; release needs a real keystore |

Local Android setup (when needed):
1. Install JDK 17 (e.g. `brew install --cask temurin@17`).
2. Install Android Studio (or `brew install --cask android-commandlinetools`).
3. Accept licenses: `sdkmanager --licenses`, install
   `platform-tools platforms;android-35 build-tools;35.0.0 ndk;27.2.12479018`.
4. Export `ANDROID_HOME` and `NDK_HOME`.
