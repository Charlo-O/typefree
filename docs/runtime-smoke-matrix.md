# Runtime Smoke Matrix

This matrix is the external evidence checklist for the TypeFree goal completion
audit. It is intentionally separate from the default verify gates because these
checks depend on OS permissions, microphone hardware, stored provider
credentials, network reachability, and foreground-app behavior.

## Required Platforms

Run the platform-live smoke set on:

- Windows
- macOS
- Linux

Each run should preserve the generated `.codex-run-logs/*.summary.json` path in
the release or goal audit notes.

## Single-Platform Evidence Collector

When handing the remaining platform work to another machine or operator,
generate the exact command set first:

```powershell
npm run handoff:runtime-smoke-evidence -- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang> --cloud-smoke-ms <ms>
```

The handoff generator does not run Tauri, read credentials, start recording, or
write runtime evidence. It prints the per-platform
`collect:runtime-smoke-evidence` commands plus the final
`verify:goal-readiness -- --manifest-dir <dir>` command. Add
`--output <file.md>` or `--format json --output <file.json>` when you need a
transferable handoff file for another machine. Add `--bundle-dir <dir>` when
you want Markdown, JSON, a bundle manifest, per-platform collector scripts, and
import helper scripts plus final readiness scripts in one directory. Use it to
keep macOS/Linux evidence collection aligned with the strict
`--require-cloud-microphone` final gate.

Bundle scripts locate the TypeFree repo root from the current directory or from
the handoff script path before invoking `npm` or `node`. This keeps collector,
import helper, and final readiness scripts usable when an operator launches them
from the repo root or from the handoff bundle directory.

Before transferring or running a generated command bundle, validate its
structure and safety with:

```powershell
npm run verify:runtime-smoke-handoff-bundle -- --bundle-dir <dir>
```

The bundle verifier only reads the generated handoff files. It does not run
Tauri, read credentials, start recording, call providers, or write runtime
evidence. It rejects path escapes, unknown executable scripts, fixture/allow
missing cloud shortcuts, secret/transcript payload keys, and final readiness
commands that bypass `verify:goal-readiness -- --manifest-dir`. It also checks
that `import-returned-evidence.ps1` and `import-returned-evidence.sh` call
`node scripts/import-runtime-smoke-evidence.js` with `--source` and the bundle's
manifest directory. The helper scripts call the Node importer directly so npm
argument forwarding differences cannot drop option names on Windows. They also
fail closed if the TypeFree repo root cannot be found from the current directory
or handoff script path. The verifier compares generated collect/import/final
helper wrappers against the expected repo-root prelude, but it does not execute
live collector scripts or the final readiness scripts.

On Windows npm versions that forward option values but drop option names, the
handoff generator also accepts positional provider/model/language/duration,
platform names, and output file values.

For a platform handoff, prefer the collector over manually running the five
commands below:

```powershell
npm run collect:runtime-smoke-evidence -- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang> --cloud-smoke-ms <ms>
```

The collector runs the base runtime checks, the cloud credential preflight, and
the cloud transcription smoke in order. It then validates the summary set with
`--require-cloud-microphone`, copies the timestamped summaries into a stable
`runtime-smoke-evidence-<platform>-<timestamp>/` bundle, and writes
`runtime-smoke-set.<platform>.manifest.json`.
If the final copy or manifest write fails, the unfinished bundle directory is
removed so the manifest directory only contains usable evidence bundles.

The manifest can be passed directly to the final `npm run verify:goal-readiness`
command on the integration machine. It also contains `goalReadinessArgs` for
manual fallback. The manifest stores portable summary file names relative to the
bundle; transcript text and credential values remain absent from the summaries
and manifest. The collector does not run in default verification because it
depends on OS permissions, microphone hardware, credentials, and network
reachability.

When a platform bundle is returned to the integration machine, import it instead
of copying by hand:

```powershell
npm run import:runtime-smoke-evidence -- --source <runtime-smoke-evidence-platform-dir-or-manifest> --manifest-dir <dir>
```

The importer validates the source bundle with
`verify-runtime-smoke-summaries --require-cloud-microphone`, rejects manifest
path escapes and secret/transcript payload keys, requires a parseable manifest
`collectedAt` timestamp for final readiness discovery, copies only the manifest
plus the five resolved summary files into the manifest directory, and validates
the copied bundle again. It does not run Tauri, read credentials, record audio,
or call providers.
If `<runtime-smoke-evidence-platform-dir-or-manifest>` is a directory that
contains one-level `runtime-smoke-evidence-<platform>-<timestamp>/` child
directories, the importer validates and imports all matching platform bundles in
one pass. Add `--platform <platform>` to import only one returned platform from
that directory.
Batch discovery is intentionally shallow: unrelated sibling directories are
ignored, but any `runtime-smoke-evidence-*` child must be an ordinary directory
with exactly one matching `runtime-smoke-set.<platform>.manifest.json`. The
child directory platform, manifest filename platform, and manifest `platform`
must agree, and duplicate platforms in one returned source fail closed. Batch
imports preflight destination conflicts before copying anything; pass
`--replace` only when replacing an existing bundle is intended, and the importer
verifies a temporary copy before swapping so existing evidence is preserved on
failure.

On Windows, add `--cloud-speaker-fixture` when the microphone needs deterministic
speech input. On any platform, `--cloud-playback-path <wav>` can play an
existing WAV while native recording captures microphone input.

If the five summary files already exist, package them into the same portable
manifest without rerunning Tauri:

```powershell
npm run pack:runtime-smoke-evidence -- --platform <platform> --runtime-probe <summary.json> --native-recording <summary.json> --dictation-pipeline <summary.json> --cloud-preflight <summary.json> --cloud-transcription <summary.json>
```

The packer validates the copied bundle with
`verify-runtime-smoke-summaries --require-cloud-microphone` before writing
`runtime-smoke-set.<platform>.manifest.json`. It does not run in default
verification because it consumes external evidence artifacts.

## Base Runtime Checks

Run these on each platform:

```powershell
npm run smoke:runtime-probe
npm run smoke:native-recording
npm run smoke:dictation-pipeline
```

Expected evidence:

- `success` is `true`.
- `runtimeProbeResult.status` is `passed` for `smoke:runtime-probe`.
- `nativeRecordingSmokeResult.status` is `passed` and captured audio is a WAV
  payload for `smoke:native-recording`.
- `dictationPipelineSmokeResult.status` is `passed` and the summary records the
  clipboard/history/timeline stages for `smoke:dictation-pipeline`.

## Cloud Provider Checks

Start with a credential-only preflight:

```powershell
npm run smoke:cloud-credential-preflight -- --cloud-provider <provider>
```

Expected evidence:

- `success` is `true`.
- `cloudCredentialPreflightResult.status` is `passed`.
- `recordingStarted` is `false`.
- `providerRequestStarted` is `false`.
- Required credential keys are reported as present without secret values.

Then run a live provider smoke with real audio input:

```powershell
npm run smoke:cloud-transcription -- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang>
```

Expected evidence:

- `success` is `true`.
- `cloudTranscriptionSmokeResult.status` is `passed`.
- `transcriptLength` is greater than `0`.
- For microphone evidence, `cloud-transcription-recording-capabilities`,
  `cloud-transcription-recording-start`, and
  `cloud-transcription-recording-capture` are `passed`.
- For microphone evidence, `cloud-transcription-result.meta.audioSource` is
  `native-recording`.
- The summary records provider/model/language.
- Transcript text is absent from the summary.
- Credential values are absent from the summary.

When microphone speech is unavailable but provider-path proof is still needed,
use an explicit WAV fixture:

```powershell
npm run smoke:cloud-transcription -- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang> --cloud-fixture-path <wav>
```

On Windows only, a deterministic SAPI fixture may be generated with:

```powershell
npm run smoke:cloud-transcription -- --cloud-provider <provider> --cloud-speech-fixture
```

Fixture evidence proves provider dispatch and credential handling, but it does
not prove native microphone recording.

To automate microphone-path evidence on Windows, generate and play the same kind
of SAPI speech through the default speaker while the native recorder captures
microphone input:

```powershell
npm run smoke:cloud-transcription -- --cloud-provider <provider> --cloud-speaker-fixture --cloud-smoke-ms <ms>
```

This still uses `native-recording` as the provider input and can satisfy
`--require-cloud-microphone` when the summary includes the recording checks and
a non-empty transcript. It depends on the physical microphone actually hearing
the speaker output.

## Validate Summary Set

After collecting the summary files for a platform, validate the set with:

```powershell
npm run verify:runtime-smoke-summaries -- --platform <platform> --runtime-probe <summary.json> --native-recording <summary.json> --dictation-pipeline <summary.json> --cloud-preflight <summary.json> --cloud-transcription <summary.json>
```

Use `windows`, `macos`, or `linux` for `<platform>`. The verifier checks the
Tauri app-running signal, native recorder capability/capture metadata,
dictation pipeline clipboard/history/session evidence, cloud credential
presence-only preflight metadata, cloud transcription `transcriptLength`, and
the absence of transcript or credential-value payload keys in the cloud summary.
Add `--require-cloud-microphone` when the evidence is meant to close the full
native-recording -> provider transcription requirement. That mode rejects
speech-fixture summaries and requires the cloud transcription summary to include
passed native recording capability/start/capture checks plus
`audioSource: "native-recording"`.

On Windows npm versions that forward option values but drop option names, the
verifier also accepts the positional fallback. Boolean options such as
`--require-cloud-microphone` are also read from npm's `npm_config_*`
environment:

```powershell
npm run verify:runtime-smoke-summaries -- <platform> <runtime-probe-summary.json> <native-recording-summary.json> <dictation-pipeline-summary.json> <cloud-preflight-summary.json> <cloud-transcription-summary.json>
```

When cloud provider evidence is intentionally deferred for a platform, pass
`--allow-missing-cloud-preflight` or `--allow-missing-cloud-transcription` and
record that exception in the audit notes. A full goal-completion evidence set
should validate without those allowances and with `--require-cloud-microphone`
for at least one credentialed provider on each platform where microphone cloud
transcription is claimed complete.

## Final Goal Readiness Gate

After collecting the required Windows platform summary set, run:

```powershell
npm run verify:goal-readiness -- --windows-manifest <runtime-smoke-set.windows.manifest.json>
```

If the platform bundles live under one directory, the final gate can discover
them automatically:

```powershell
npm run verify:goal-readiness -- --manifest-dir <directory-containing-runtime-smoke-evidence-bundles>
```

`--manifest-dir` scans one level of `runtime-smoke-evidence-<platform>-*/`
directories, picks the latest manifest for each platform by manifest
`collectedAt`, and uses the manifest path as a fallback only for platforms that
were not explicitly provided. If a chosen latest manifest is invalid, the final
gate fails closed instead of silently falling back to older evidence.

The manifest paths are preferred because they keep the five-summary bundle
portable. The final gate resolves summary paths relative to each manifest,
rejects manifest paths that escape the bundle, rejects transcript or credential
payload keys in the manifest, and still delegates the actual runtime proof to
`verify-runtime-smoke-summaries --require-cloud-microphone`.

The current goal requires Windows live runtime evidence. macOS and Linux runtime
evidence remain supported and are validated with the same strict checks when
provided, but their absence does not block the current goal readiness gate.

On Windows npm versions that drop option names, the readiness verifier accepts
either a single manifest directory path positionally, or the same manifest paths
positionally in this order: required Windows, then optional macOS, then optional
Linux.

You can also pass explicit summary paths:

```powershell
npm run verify:goal-readiness -- --windows-runtime-probe <summary.json> --windows-native-recording <summary.json> --windows-dictation-pipeline <summary.json> --windows-cloud-preflight <summary.json> --windows-cloud-transcription <summary.json> --macos-runtime-probe <summary.json> --macos-native-recording <summary.json> --macos-dictation-pipeline <summary.json> --macos-cloud-preflight <summary.json> --macos-cloud-transcription <summary.json> --linux-runtime-probe <summary.json> --linux-native-recording <summary.json> --linux-dictation-pipeline <summary.json> --linux-cloud-preflight <summary.json> --linux-cloud-transcription <summary.json>
```

This command fails closed when required Windows summary evidence is missing, when
the local goal coverage contract is not wired into verification, when any
provided optional platform evidence is malformed, or when cloud transcription
evidence is fixture-only instead of `native-recording`. Do not combine a
platform manifest with explicit summary paths for that same platform. When
required platform evidence is missing, the failure output includes a
`handoff:runtime-smoke-evidence` command template scoped to the missing platform,
including `--bundle-dir`, plus the matching `verify:runtime-smoke-handoff-bundle`
command. Validate that generated bundle before transferring it or running the
collector scripts. After the external platform returns a bundle or a directory
containing multiple returned bundles,
use `import:runtime-smoke-evidence` directly, or run the bundle's
`import-returned-evidence.ps1`/`.sh <returned-bundle-or-directory>` helper, to
validate and copy it into the manifest directory. The readiness command still
exits non-zero until the required runtime evidence bundle is imported.
`npm run test:runtime-smoke-handoff-bundle` includes an e2e contract that
executes the generated import helper against portable returned bundles and
checks that the manifest directory receives all expected platform manifests even
when the helper is launched from the handoff bundle directory.

On Windows npm versions that drop option names, the readiness verifier also
accepts summary paths positionally in this order: required Windows
runtime/native/pipeline/preflight/cloud, then optional macOS, then optional
Linux.
