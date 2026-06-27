# macOS Signing Policy

Current policy: unsigned by default.

Typefree currently publishes macOS artifacts as unsigned builds. They are not
signed, not notarized, not stapled, and should not be described as signed,
notarized, or Gatekeeper-ready. The release workflow declares this with
`MACOS_RELEASE_SIGNING_MODE`, and every Tauri release upload step must use the
resolved macOS signing note. The unsigned macOS build must pass `--no-sign` so
the unsigned policy is explicit at the CLI boundary.

The current unsigned lane must not consume Apple signing secrets. If a release
needs signed or notarized macOS artifacts, run the workflow manually with
`macos_signing_mode` set to `signed-notarized`. Tag-triggered releases stay
unsigned unless this explicit workflow_dispatch input is selected.

## Signed Lane Requirements

A signed/notarized lane must fail closed when required secrets or verification
steps are missing. The GitHub workflow currently maps these secrets into the
Apple credentials used by Tauri:

- `APPLE_CERTIFICATE_BASE64`, exported as `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_ID`, exported as `APPLE_API_KEY`
- `APPLE_API_ISSUER`
- `APPLE_API_PRIVATE_KEY_P8`, written to `$RUNNER_TEMP/apple-notary-api-key.p8`
  with `chmod 600`, then exported as `APPLE_API_KEY_PATH`

The workflow uses the App Store Connect API key family for notarization. A
future Apple ID based lane would need to wire and verify `APPLE_ID`,
`APPLE_PASSWORD`, and `APPLE_TEAM_ID` separately instead of mixing both auth
families. `APPLE_PROVIDER_SHORT_NAME` may be needed when an account has multiple
provider teams.

`APPLE_SIGNING_IDENTITY` may be configured when the certificate identity must be
selected explicitly. `bundle.macOS.signingIdentity` and
`bundle.macOS.providerShortName` in `src-tauri/tauri.conf.json` should only be
set when the release lane also verifies the produced artifact.

## Required Artifact Checks

After the macOS build creates `Typefree.app`, the signed lane must verify:

```bash
codesign --verify --deep --strict --verbose=2 path/to/Typefree.app
spctl --assess --type execute --verbose=4 path/to/Typefree.app
xcrun stapler validate path/to/Typefree.app
node scripts/verify-macos-release-identity.js --require-bundle
```

`notarytool` submission can be handled by Tauri or by an explicit workflow step,
but the release must not publish the macOS artifacts as signed/notarized unless
the verification commands above pass on the macOS runner.
