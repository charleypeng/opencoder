# Desktop Release Signing

How the three desktop installers (macOS / Windows / Linux) get signed for
release, and what happens when they are not. The CI pipeline
(`.github/workflows/desktop.yml`, TASK-M10-02) reads the environment
variables below from GitHub Secrets; builds without them produce **unsigned**
installers that still pass CI (with the exception of updater artifacts, which
always carry a signature — see below).

Mobile signing (iOS / Android) is documented separately in
`docs/mobile-signing.md`.

## Updater artifact signing (all platforms)

`bundle.createUpdaterArtifacts: true` makes every build emit signed updater
artifacts (`.tar.gz` + `.sig` for the macOS app, `.sig` next to the Windows
installers) plus `latest.json`, which the in-app updater (TASK-M8-09) and the
release pipeline (TASK-M10-04) consume. The keypair was generated in TASK-M8-09:

| Variable | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The private key (raw content or path to the key file). Public key is baked into `tauri.conf.json` `plugins.updater.pubkey`. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password protecting the private key, if one was set. |

The production private key lives at `~/.tauri/opencoder.key` on the release
machine and as the `TAURI_SIGNING_PRIVATE_KEY` GitHub Secret. **Never commit
it.** Back it up before the first publish — a lost key breaks every future
update. Without a secret, CI generates a throwaway key (`tauri signer
generate --ci`) so verification builds stay green; their artifacts must not be
shipped.

## macOS — Developer ID signing + notarization

Required for a smooth install on Apple Silicon (an unsigned or unnotarized
app is blocked by Gatekeeper and cannot be run via `open` without a
right-click workaround).

1. Create a **Developer ID Application** certificate in the Apple Developer
   portal and export it as a `.p12` (Keychain Access → export, with a
   password).
2. Set the CI secrets / local environment:

   | Variable | Purpose |
   | --- | --- |
   | `APPLE_CERTIFICATE` | Base64-encoded `.p12` (CI) / raw cert (local keychain). |
   | `APPLE_CERTIFICATE_PASSWORD` | Password of the `.p12`. |
   | `APPLE_SIGNING_IDENTITY` | Certificate name, e.g. `Developer ID Application: Your Name (TEAMID)`. When unset tauri-cli auto-discovers a Developer ID cert in the keychain. |
   | `APPLE_ID` | Apple ID account for notarization. |
   | `APPLE_PASSWORD` | App-specific password for that Apple ID (not the account password). |
   | `APPLE_TEAM_ID` | Developer team ID (visible in the portal). |

3. Build: `pnpm tauri build --bundles app,dmg` — tauri-cli codesigns with the
   identity and notarizes/staples automatically when the `APPLE_*` variables
   are set. Locally, install the cert into the login keychain once and set
   the four `APPLE_*` vars; CI imports the `.p12` into a throwaway keychain
   (see the `Import Apple certificate` step in `desktop.yml`).
4. Verify before shipping: `spctl -a -vvv -t execute <path>/opencoder.app`
   reports `accepted source=Developer ID`. Gatekeeper checks the stapled
   ticket: `xcrun stapler validate <path>/opencoder.app`.
5. For a local **universal** build use
   `pnpm tauri build --target universal-apple-darwin` (requires
   `rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

`bundle.macOS.hardenedRuntime` is `true` (default) — required for
notarization.

## Windows — Authenticode signing (optional)

Windows installers (NSIS `.exe` + WiX `.msi`) work unsigned, but SmartScreen
will warn. Two documented options:

1. **Local / single machine** — install the code-signing certificate into the
   Windows certificate store and set the thumbprint in
   `src-tauri/tauri.windows.conf.json`:

   ```json
   {
     "bundle": { "windows": { "certificateThumbprint": "<SHA1-OF-CERT>" } }
   }
   ```

   tauri-cli then signs the binaries with the built-in `signtool.exe`
   (optionally `timestampUrl`, `digestAlgorithm: "sha256"`).

2. **CI** — a thumbprint-only flow does not work on ephemeral runners, so
   either add the cert to the runner's store in a setup step, or use a
   cloud signing service via `bundle.windows.signCommand`
   (`<command> %1`, e.g. Azure Trusted Signing / `osslsigncode`). Documented
   here as the extension point; the shipped `desktop.yml` runs Windows
   unsigned.

The updater signature (`TAURI_SIGNING_PRIVATE_KEY`) is independent of
Authenticode: the `.sig` files are generated regardless of code-signing
status.

## Linux — deb + AppImage (unsigned by default)

`.deb` and AppImage are built unsigned; Linux distributions do not gate
installation on signatures and AppImages are distributed with
`--appimage-extract-and-run` semantics by end users. Optional hardening:

- **deb**: sign the package with a GPG key and publish the public key with
  the repo (`dpkg-sig --sign builder <file>.deb`).
- **AppImage**: optional GPG2 signature embedded via `gpg2 --detach-sign`.

Runtime dependencies are declared in `bundle.linux.deb.depends`
(libwebkit2gtk-4.1-0, libayatana-appindicator3-1, librsvg2-2).

## GitHub Secrets reference

| Secret | Platform | Required for |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | all | signed updater artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | all | (only if the key has a password) |
| `APPLE_CERTIFICATE` | macOS | Developer ID signing |
| `APPLE_CERTIFICATE_PASSWORD` | macOS | Developer ID signing |
| `APPLE_SIGNING_IDENTITY` | macOS | Developer ID signing |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | macOS | notarization |

## Environment status (2026-08-05)

| Component | Local machine | CI (desktop.yml) |
| --- | --- | --- |
| Apple Developer ID cert | **absent** (unsigned local builds) | via secrets when provided |
| Notarization | **absent** | via secrets when provided |
| Updater key | `~/.tauri/opencoder.key` ✓ | ephemeral key when secret absent |
| Windows cert | n/a (no Windows) | optional, unsigned by default |
| Linux signatures | n/a | none (per distribution norms) |
