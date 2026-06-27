# macOS Upgrade Smoke Test

Use this checklist when validating an upgrade from the retired bundle identifier
`com.typefree.app` to the current identifier `com.typefree.desktop`.

## Machine Checks

1. Build each macOS target with the release workflow or with:

   ```bash
   npm run tauri:build -- --target aarch64-apple-darwin
   npm run tauri:build -- --target x86_64-apple-darwin
   ```

2. Verify the generated app bundle identity:

   ```bash
   node scripts/verify-macos-release-identity.js --require-bundle
   ```

   The generated `.app/Contents/Info.plist` must have `CFBundleIdentifier`
   equal to `com.typefree.desktop` and `CFBundleShortVersionString` equal to the
   package version.

## Upgrade Data Setup

1. Quit Typefree.
2. Seed the legacy app data directory under
   `~/Library/Application Support/com.typefree.app/` with:
   - `settings.json`
   - `transcriptions.db`
   - `clipboard-images/`
   - `.env` if testing legacy credential migration
3. Install and launch the new `Typefree.app`.
4. Confirm the new app data directory under
   `~/Library/Application Support/com.typefree.desktop/` has copied the missing
   files without overwriting any newer file already present there.

## Manual Runtime Checks

1. Open the control panel and confirm provider/model/settings values appear.
2. Confirm history rows and clipboard image thumbnails still render.
3. Confirm localStorage-backed settings that are not backend-synced still appear
   as expected. WKWebView storage can be tied to the app identity and cannot be
   proven by the static release script.
4. Trigger a short dictation and confirm Microphone permission prompts or the
   existing grant behave correctly.
5. Paste into a normal text field and confirm Accessibility permission handling.
6. Toggle launch-at-startup once and confirm the current app is represented under
   `~/Library/LaunchAgents`.
7. Open the update area and confirm automatic updates still report unavailable
   until the Tauri updater is actually enabled.
