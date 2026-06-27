const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(read("package.json"));

function fullPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(fullPath(relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(fullPath(relativePath));
}

function assertPath(relativePath) {
  assert.equal(exists(relativePath), true, `${relativePath} must exist`);
}

function assertMissing(relativePath) {
  assert.equal(exists(relativePath), false, `${relativePath} should not exist`);
}

function assertSource(relativePath, pattern, label = String(pattern)) {
  assert.match(read(relativePath), pattern, `${relativePath}: ${label}`);
}

function assertIncludes(relativePath, snippet) {
  assert.equal(read(relativePath).includes(snippet), true, `${relativePath}: ${snippet}`);
}

function assertScript(name) {
  assert.equal(typeof packageJson.scripts[name], "string", `missing npm script ${name}`);
}

function assertNoElectronPackageRuntime() {
  const packageSections = [
    ["dependencies", packageJson.dependencies || {}],
    ["devDependencies", packageJson.devDependencies || {}],
    ["optionalDependencies", packageJson.optionalDependencies || {}],
  ];
  const electronPackagePattern =
    /^(electron|electron-builder|electron-packager|electron-updater|@electron\/)/;

  assert.equal(packageJson.main, undefined, "package.json must not expose an Electron main entry");

  for (const [sectionName, dependencies] of packageSections) {
    const offenders = Object.keys(dependencies).filter((name) => electronPackagePattern.test(name));
    assert.deepEqual(offenders, [], `package.json ${sectionName} must not include Electron packages`);
  }

  const electronScriptPattern = /\belectron(?:-builder|-packager|-forge)?\b/i;
  for (const [scriptName, command] of Object.entries(packageJson.scripts || {})) {
    assert.doesNotMatch(scriptName, electronScriptPattern, `npm script ${scriptName} must stay Tauri-first`);
    assert.doesNotMatch(command, electronScriptPattern, `npm script ${scriptName} must not run Electron`);
  }
}

function assertVerifyIncludes(scriptName) {
  const pattern = new RegExp(`npm run ${scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  assert.match(
    packageJson.scripts["verify:frontend"],
    pattern,
    `verify:frontend must run ${scriptName}`
  );
}

function assertVerifyTauriIncludes(scriptName) {
  const pattern = new RegExp(`npm run ${scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  assert.match(packageJson.scripts["verify:tauri"], pattern, `verify:tauri must run ${scriptName}`);
}

const tests = [
  [
    "runtime boundary stays Tauri-first with legacy Electron isolated",
    () => {
      assertPath("src-tauri");
      assertPath("legacy-electron");
      for (const removedRootFile of [
        "main.js",
        "preload.js",
        "setup.js",
        "electron-builder.json",
        "cleanup.js",
      ]) {
        assertMissing(removedRootFile);
      }
      assertNoElectronPackageRuntime();
      assertScript("test:frontend-boundaries");
      assertScript("test:github-workflows");
      assertScript("smoke:tauri-dev");
      assertScript("smoke:runtime-probe");
      assertScript("smoke:native-recording");
      assertScript("smoke:dictation-pipeline");
      assertScript("smoke:cloud-transcription");
      assertScript("smoke:cloud-credential-preflight");
      assertScript("collect:runtime-smoke-evidence");
      assertScript("pack:runtime-smoke-evidence");
      assertScript("import:runtime-smoke-evidence");
      assertScript("handoff:runtime-smoke-evidence");
      assertScript("verify:runtime-smoke-handoff-bundle");
      assertScript("test:runtime-smoke-evidence");
      assertScript("test:runtime-smoke-packager");
      assertScript("test:runtime-smoke-importer");
      assertScript("test:runtime-smoke-handoff");
      assertScript("test:runtime-smoke-handoff-bundle");
      assertScript("test:tauri-dev-smoke-contract");
      assertVerifyIncludes("test:runtime-smoke-evidence");
      assertVerifyIncludes("test:runtime-smoke-packager");
      assertVerifyIncludes("test:runtime-smoke-importer");
      assertVerifyIncludes("test:runtime-smoke-handoff");
      assertVerifyIncludes("test:runtime-smoke-handoff-bundle");
      assertVerifyTauriIncludes("test:tauri-dev-smoke-contract");
      assertSource("scripts/test-frontend-boundaries.js", /electronAPI/);
      assertSource("scripts/run-tauri-dev-smoke.js", /"npm run tauri:dev"/);
      assertSource("scripts/run-tauri-dev-smoke.js", /TYPEFREE_RUNTIME_PROBE_RESULT/);
      assertSource("scripts/run-tauri-dev-smoke.js", /TYPEFREE_NATIVE_RECORDING_SMOKE_RESULT/);
      assertSource("scripts/run-tauri-dev-smoke.js", /TYPEFREE_DICTATION_PIPELINE_SMOKE_RESULT/);
      assertSource("scripts/run-tauri-dev-smoke.js", /TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_RESULT/);
      assertSource("scripts/run-tauri-dev-smoke.js", /TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_RESULT/);
      assertSource("scripts/collect-runtime-smoke-evidence.js", /--require-cloud-microphone/);
      assertSource("scripts/collect-runtime-smoke-evidence.js", /runtime-smoke-set\.\$\{options\.platform\}\.manifest\.json/);
      assertSource("scripts/pack-runtime-smoke-evidence.js", /--require-cloud-microphone/);
      assertSource("scripts/pack-runtime-smoke-evidence.js", /packedFromExistingSummaries/);
      assertSource("scripts/import-runtime-smoke-evidence.js", /TYPEFREE_RUNTIME_SMOKE_IMPORT_RESULT/);
      assertSource("scripts/import-runtime-smoke-evidence.js", /--require-cloud-microphone/);
      assertSource("scripts/import-runtime-smoke-evidence.js", /verify-runtime-smoke-summaries\.js/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /TYPEFREE_RUNTIME_SMOKE_HANDOFF/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /--require-cloud-microphone/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /--output <file>/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /--bundle-dir <dir>/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /writeOutput/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /writeBundle/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /bundleRelativePath/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /runtime-smoke-handoff\.manifest\.json/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /handoff written:/);
      assertSource("scripts/generate-runtime-smoke-handoff.js", /handoff bundle written:/);
      assertSource("scripts/verify-runtime-smoke-handoff-bundle.js", /TYPEFREE_RUNTIME_SMOKE_HANDOFF_BUNDLE_VERIFY/);
      assertSource("scripts/verify-runtime-smoke-handoff-bundle.js", /assertNoUnexpectedScripts/);
      assertSource("scripts/verify-runtime-smoke-handoff-bundle.js", /assertJsonHasNoSensitivePayload/);
      assertSource(
        "scripts/run-tauri-dev-smoke.js",
        /spawn\(devCommand\.command, devCommand\.args/
      );
      assertSource("scripts/run-tauri-dev-smoke.js", /tauri-dev-smoke-\$\{stamp\}\.summary\.json/);
      assertSource(".github/workflows/ci.yml", /npm run verify:frontend/);
      assertSource(".github/workflows/release.yml", /npm run verify:frontend/);
      assertIncludes("README.md", "Tauri v2");
      assertIncludes("README.md", "`src/` + `src-tauri/`");
      assertIncludes("README.md", "`legacy-electron/`");
      assertIncludes("README.md", "`src/shared/platform`");
      assertIncludes("README.md", "Electron main/preload");
    },
  ],
  [
    "platform bridge owns desktop capabilities",
    () => {
      for (const relativePath of [
        "src/shared/platform/index.ts",
        "src/shared/platform/commandCore.ts",
        "src/shared/platform/legacyDesktopApi.ts",
        "src/shared/platform/platformBootstrap.ts",
        "src/shared/platform/platformCommands.ts",
        "src/shared/platform/rendererPlatformInit.ts",
        "src/shared/platform/tauriPlatform.ts",
        "src/shared/platform/tauriCommands.ts",
        "src/shared/platform/types.ts",
      ]) {
        assertPath(relativePath);
      }
      assertSource("src/main.tsx", /import "\.\/shared\/platform\/rendererPlatformInit"/);
      assertSource("src/shared/platform/platformBootstrap.ts", /tauriAPI = legacyDesktopAPI/);
      assertSource("src/shared/platform/types.ts", /export type PlatformBridge = \{/);
      for (const capability of [
        "runtime",
        "window",
        "clipboard",
        "settings",
        "secrets",
        "permissions",
        "logging",
        "debug",
        "transcription",
        "history",
        "recording",
        "models",
        "updater",
        "hotkeys",
        "reasoning",
        "events",
        "app",
      ]) {
        assertSource(
          "src/shared/platform/types.ts",
          new RegExp(`${capability}: \\{`),
          `PlatformBridge must expose ${capability}`
        );
        assertSource(
          "src/shared/platform/tauriPlatform.ts",
          new RegExp(`${capability}: \\{`),
          `tauriPlatform must implement ${capability}`
        );
      }
      assertSource(
        "src/shared/platform/tauriPlatform.ts",
        /export const tauriPlatform: PlatformBridge = \{/
      );
      assertScript("test:platform");
      assertVerifyIncludes("test:platform");
    },
  ],
  [
    "dictation has an explicit session state machine",
    () => {
      assertPath("src/features/dictation/state/dictationSessionMachine.ts");
      assertSource(
        "src/features/dictation/state/dictationSessionMachine.ts",
        /idle[\s\S]*recording[\s\S]*transcribing[\s\S]*postprocessing[\s\S]*inserting[\s\S]*completed[\s\S]*failed/
      );
      assertScript("test:state");
      assertVerifyIncludes("test:state");
    },
  ],
  [
    "session id crosses renderer, backend, and transcription contracts",
    () => {
      assertSource(
        "src/features/dictation/state/dictationSessionMachine.ts",
        /createDictationSessionId/
      );
      assertSource("src/features/dictation/hooks/useAudioRecording.ts", /sessionId/);
      assertSource("src/features/dictation/audio/audioManager.ts", /getSessionId/);
      assertSource("src/shared/platform/transcriptionCommands.ts", /sessionId:\s*sessionId \|\| null/);
      assertSource("src-tauri/src/commands/dictation.rs", /session_id/);
      assertSource("src-tauri/src/commands/transcription.rs", /session_id:\s*Option<String>/);
      assertSource("src-tauri/src/transcription/batch_service.rs", /normalize_batch_session_id/);
      assertSource("src-tauri/src/transcription/domain.rs", /session_id/);
    },
  ],
  [
    "API credentials route through per-platform credential storage",
    () => {
      assertPath("src-tauri/src/commands/credentials.rs");
      assertSource("src-tauri/src/commands/credentials.rs", /target_os = "macos"/);
      assertSource("src-tauri/src/commands/credentials.rs", /Command::new\("security"\)/);
      assertSource("src-tauri/src/commands/credentials.rs", /target_os = "windows"/);
      assertSource("src-tauri/src/commands/credentials.rs", /CryptProtectData/);
      assertSource("src-tauri/src/commands/credentials.rs", /target_os = "linux"/);
      assertSource("src-tauri/src/commands/credentials.rs", /Command::new\("secret-tool"\)/);
      assertSource("src-tauri/src/commands/credentials.rs", /VOLCENGINE_APP_ID/);
      assertSource("src-tauri/src/commands/credentials.rs", /VOLCENGINE_ACCESS_TOKEN/);
      assertSource("src-tauri/src/commands/credentials.rs", /platform_has_credential/);
      assertSource(
        "src-tauri/src/commands/credentials.rs",
        /validate_credential_key\("VOLCENGINE_RESOURCE_ID"\)/
      );
      assertSource("src/shared/platform/settingsCommands.ts", /getCredential/);
      assertSource("src/shared/platform/settingsCommands.ts", /getCredentialStatus/);
      assertSource("src/shared/platform/settingsCommands.ts", /setCredential/);
      assertSource("src/shared/platform/settingsCommands.ts", /deleteCredential/);
      assertSource("src-tauri/src/lib.rs", /credentials::get_credential/);
      assertSource("src-tauri/src/lib.rs", /credentials::get_credential_status/);
      assertSource("src-tauri/src/lib.rs", /credentials::set_credential/);
      assertSource("src-tauri/src/lib.rs", /credentials::delete_credential/);
      assertScript("test:tauri-credentials");
      assertVerifyTauriIncludes("test:tauri-credentials");
    },
  ],
  [
    "Tauri commands expose typed error envelopes",
    () => {
      assertPath("src-tauri/src/commands/command_error.rs");
      assertSource("src-tauri/src/commands/command_error.rs", /pub enum CommandErrorKind/);
      for (const variant of [
        "Permission",
        "Network",
        "Configuration",
        "Cancelled",
        "Timeout",
        "Internal",
      ]) {
        assertSource("src-tauri/src/commands/command_error.rs", new RegExp(`\\b${variant}\\b`));
      }
      assertScript("test:tauri-command-errors");
      assertScript("test:tauri-command-boundaries");
      assertVerifyTauriIncludes("test:tauri-command-errors");
      assertVerifyTauriIncludes("test:tauri-command-boundaries");
    },
  ],
  [
    "transcription backend is split into command, service, domain, and provider layers",
    () => {
      for (const relativePath of [
        "src-tauri/src/commands/transcription.rs",
        "src-tauri/src/transcription/batch_service.rs",
        "src-tauri/src/transcription/domain.rs",
        "src-tauri/src/transcription/providers.rs",
        "src-tauri/src/transcription/providers/assemblyai.rs",
        "src-tauri/src/transcription/providers/openai.rs",
        "src-tauri/src/transcription/providers/groq.rs",
        "src-tauri/src/transcription/providers/zai.rs",
        "src-tauri/src/transcription/providers/volcengine.rs",
      ]) {
        assertPath(relativePath);
      }
      assertSource("src-tauri/src/commands/transcription.rs", /batch_service::transcribe_audio/);
      assertSource("src-tauri/src/lib.rs", /transcription_commands::transcribe_audio/);
      assertSource("src-tauri/src/lib.rs", /transcription_commands::get_transcription_providers/);
    },
  ],
  [
    "providers share a trait and unified transcript event bridge",
    () => {
      assertSource("src-tauri/src/transcription/domain.rs", /trait TranscriptionProvider/);
      assertSource("src-tauri/src/transcription/domain.rs", /struct TranscriptEvent/);
      assertSource(
        "src-tauri/src/transcription/domain.rs",
        /TRANSCRIPT_EVENT_NAME: &str = "transcript-event"/
      );
      assertScript("test:transcript-events");
      assertScript("test:tauri-provider-contracts");
      assertVerifyIncludes("test:transcript-events");
      assertVerifyTauriIncludes("test:tauri-provider-contracts");
    },
  ],
  [
    "post-processing pipeline is explicit across transcription, reasoning, insert, and history",
    () => {
      assertPath("src/features/dictation/pipeline/transcriptionPipeline.ts");
      assertPath("src/features/dictation/pipeline/completionPipeline.ts");
      assertPath("src-tauri/src/commands/postprocessing.rs");
      assertSource(
        "src/features/dictation/pipeline/transcriptionPipeline.ts",
        /normalize[\s\S]*vocabulary[\s\S]*reasoning/
      );
      assertSource(
        "src/features/dictation/pipeline/completionPipeline.ts",
        /insert[\s\S]*clipboard-history[\s\S]*db-history/
      );
      assertSource("src-tauri/src/commands/postprocessing.rs", /postprocess_transcription/);
      assertSource(
        "src/features/settings/ui/DeveloperSection.tsx",
        /handleRunDictationPipelineSmoke/
      );
      assertSource(
        "src/features/settings/ui/DeveloperSection.tsx",
        /runDictationCompletionPipeline/
      );
      assertSource(
        "src/features/settings/ui/DeveloperSection.tsx",
        /TYPEFREE_DICTATION_PIPELINE_SMOKE_RESULT/
      );
      assertSource("scripts/run-tauri-dev-smoke.js", /--dictation-pipeline-smoke/);
      assertScript("test:pipeline");
      assertScript("smoke:dictation-pipeline");
      assertVerifyIncludes("test:pipeline");
    },
  ],
  [
    "SQLite history model has sessions, outputs, FTS, migrations, and timeline storage",
    () => {
      assertSource("src-tauri/src/commands/database.rs", /const SCHEMA_VERSION: i32 = 4/);
      for (const table of [
        "schema_migrations",
        "transcription_sessions",
        "transcription_outputs",
        "transcriptions_fts",
        "dictation_timeline_sessions",
        "dictation_timeline_events",
      ]) {
        assertSource("src-tauri/src/commands/database.rs", new RegExp(table));
      }
      assertScript("test:tauri-database");
      assertVerifyTauriIncludes("test:tauri-database");
      assertSource("src-tauri/src/lib.rs", /database::db_save_transcription_record/);
      assertSource("src-tauri/src/lib.rs", /database::db_get_transcription_session/);
      assertSource("src-tauri/src/lib.rs", /database::db_save_dictation_timeline_events/);
    },
  ],
  [
    "clipboard image history stores file paths plus metadata",
    () => {
      assertPath("src-tauri/src/clipboard_images.rs");
      assertSource("src-tauri/src/clipboard_images.rs", /clipboard-images/);
      assertSource("src/types/clipboard.ts", /blobPath/);
      assertSource("src/types/clipboard.ts", /thumbPath/);
      assertSource("src/features/clipboardCenter/clipboardItems.ts", /resolveClipboardImageSrc/);
      assertSource("src/features/clipboardCenter/clipboardItems.ts", /clipboardImagePasteSource/);
      assertScript("test:clipboard");
      assertScript("test:tauri-clipboard-images");
      assertVerifyIncludes("test:clipboard");
      assertVerifyTauriIncludes("test:tauri-clipboard-images");
    },
  ],
  [
    "settings page is schema-driven",
    () => {
      assertPath("src/features/settings/schema/settingsSchema.ts");
      assertSource(
        "src/features/settings/schema/settingsSchema.ts",
        /export const SETTINGS_SCHEMA = \{/
      );
      assertSource("src/features/settings/schema/settingsSchema.ts", /syncToBackend/);
      assertSource("src/features/settings/schema/settingsSchema.ts", /normalizeAppSettingValue/);
      assertSource(
        "src/features/settings/schema/settingsSchema.ts",
        /createAppSettingsExportPayload/
      );
      assertSource(
        "src/features/settings/schema/settingsSchema.ts",
        /importAppSettingsExportPayload/
      );
      assertSource("src/features/settings/schema/settingsSchema.ts", /searchSettingsSchema/);
      assertScript("test:settings");
      assertVerifyIncludes("test:settings");
    },
  ],
  [
    "frontend modules are feature sliced",
    () => {
      for (const relativePath of [
        "src/features/dictation",
        "src/features/settings",
        "src/features/clipboardCenter",
        "src/features/promptStudio",
        "src/features/vocabulary",
        "src/features/privacy",
      ]) {
        assertPath(relativePath);
      }
      assertScript("test:frontend-boundaries");
      assertVerifyIncludes("test:frontend-boundaries");
    },
  ],
  [
    "critical frontend source is guarded as TypeScript",
    () => {
      assertPath("tsconfig.json");
      assertScript("typecheck");
      assertSource("scripts/test-frontend-boundaries.js", /src source files should be TypeScript/);
      assertSource("scripts/test-frontend-boundaries.js", /assertNoJsxOrJsSources/);
    },
  ],
  [
    "dictation profiles persist scene-specific settings without secrets",
    () => {
      assertPath("src/features/settings/dictationProfiles.ts");
      assertSource("src/features/settings/dictationProfiles.ts", /DictationProfileSettings/);
      assertSource("src/features/settings/dictationProfiles.ts", /promptVersionId/);
      assertSource("src/features/settings/dictationProfiles.ts", /vocabularyProfileId/);
      assertSource("src/features/settings/dictationProfiles.ts", /dictationKey/);
      assertScript("test:dictation-profiles");
      assertVerifyIncludes("test:dictation-profiles");
    },
  ],
  [
    "Prompt Studio supports versioning, samples, scored runs, comparison, and rollback",
    () => {
      for (const relativePath of [
        "src/features/promptStudio/promptVersions.ts",
        "src/features/promptStudio/promptTestSamples.ts",
        "src/features/promptStudio/promptTestRuns.ts",
        "src/features/promptStudio/ui/PromptStudio.tsx",
      ]) {
        assertPath(relativePath);
      }
      assertSource("src/features/promptStudio/ui/PromptStudio.tsx", /savePromptVersion/);
      assertSource("src/features/promptStudio/ui/PromptStudio.tsx", /savePromptTestSample/);
      assertSource("src/features/promptStudio/ui/PromptStudio.tsx", /savePromptTestRun/);
      assertSource("src/features/promptStudio/ui/PromptStudio.tsx", /comparePromptVersions/);
      assertSource("src/features/promptStudio/ui/PromptStudio.tsx", /source: "rollback"/);
      assertScript("test:prompt-studio");
      assertVerifyIncludes("test:prompt-studio");
    },
  ],
  [
    "vocabulary layers cover hotwords, snippets, context packs, profiles, and applications",
    () => {
      assertPath("src/features/vocabulary/vocabularyLayers.ts");
      assertPath("src-tauri/src/commands/vocabulary.rs");
      assertSource(
        "src/features/vocabulary/vocabularyLayers.ts",
        /VocabularyLayerScope = "global" \| "profile" \| "application" \| "contextPack"/
      );
      assertSource("src-tauri/src/commands/vocabulary.rs", /active_profile_id/);
      assertSource("src-tauri/src/commands/vocabulary.rs", /active_application_id/);
      assertSource("src-tauri/src/commands/vocabulary.rs", /context_packs/);
      assertScript("test:vocabulary-layers");
      assertVerifyIncludes("test:vocabulary-layers");
    },
  ],
  [
    "native recording has a cross-platform backend contract",
    () => {
      assertPath("src-tauri/src/commands/recording.rs");
      assertSource("src-tauri/src/commands/recording.rs", /trait AudioRecorder:\s*Sync/);
      assertSource("src-tauri/src/commands/recording.rs", /mod macos/);
      assertSource("src-tauri/src/commands/recording.rs", /mod windows_recorder/);
      assertSource("src-tauri/src/commands/recording.rs", /mod linux_recorder/);
      assertSource("src-tauri/src/commands/recording.rs", /Windows WASAPI/);
      assertSource("src-tauri/src/commands/recording.rs", /PipeWire/);
      assertSource("src-tauri/src/commands/recording.rs", /PulseAudio/);
      assertSource("src-tauri/src/lib.rs", /recording::start_native_recording/);
      assertSource("src-tauri/src/lib.rs", /recording::get_native_recording_capabilities/);
      assertSource(
        "src/features/settings/ui/DeveloperSection.tsx",
        /handleRunNativeRecordingSmoke/
      );
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /startNative\(\)/);
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /stopNative\(\)/);
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /isWavAudioData/);
      assertSource("scripts/run-tauri-dev-smoke.js", /--native-recording-smoke/);
      assertSource("scripts/run-tauri-dev-smoke.js", /TYPEFREE_NATIVE_RECORDING_SMOKE_RESULT/);
      assertScript("test:native-recording-contract");
      assertScript("smoke:native-recording");
      assertVerifyTauriIncludes("test:native-recording-contract");
    },
  ],
  [
    "cloud transcription live smoke is explicit and outside default verify",
    () => {
      assertScript("smoke:cloud-transcription");
      assertScript("smoke:cloud-credential-preflight");
      assertSource("scripts/run-tauri-dev-smoke.js", /--cloud-transcription-smoke/);
      assertSource("scripts/run-tauri-dev-smoke.js", /--cloud-credential-preflight/);
      assertSource("scripts/run-tauri-dev-smoke.js", /--cloud-speech-fixture/);
      assertSource("scripts/run-tauri-dev-smoke.js", /--cloud-speaker-fixture/);
      assertSource("scripts/run-tauri-dev-smoke.js", /SpeechAudioFormatInfo\(16000/);
      assertSource("scripts/run-tauri-dev-smoke.js", /TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_RESULT/);
      assertSource(
        "scripts/run-tauri-dev-smoke.js",
        /TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_RESULT/
      );
      assertSource(
        "src/features/settings/ui/DeveloperSection.tsx",
        /handleRunCloudTranscriptionSmoke/
      );
      assertSource(
        "src/features/settings/ui/DeveloperSection.tsx",
        /handleRunCloudCredentialPreflight/
      );
      assertSource(
        "src/features/settings/ui/DeveloperSection.tsx",
        /platform\.transcription\.transcribeAudio/
      );
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /platform\.secrets\.status/);
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /cloud-transcription-speech-fixture/);
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /cloud-transcription-speaker-playback/);
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /audioSource: "speech-fixture"/);
      assertSource(
        "src/features/settings/ui/DeveloperSection.tsx",
        /audioSource: fixturePath \? "speech-fixture" : "native-recording"/
      );
      assertSource(
        "src/features/settings/ui/DeveloperSection.tsx",
        /cloud-transcription-credentials/
      );
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /cloud-credential-preflight/);
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /providerRequestStarted: false/);
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /cloud-transcription-smoke/);
      assert.doesNotMatch(
        packageJson.scripts["verify:frontend"],
        /npm run smoke:cloud-transcription/
      );
      assert.doesNotMatch(
        packageJson.scripts["verify:tauri"],
        /npm run smoke:cloud-transcription/
      );
      assert.doesNotMatch(
        packageJson.scripts["verify:frontend"],
        /npm run smoke:cloud-credential-preflight/
      );
      assert.doesNotMatch(
        packageJson.scripts["verify:tauri"],
        /npm run smoke:cloud-credential-preflight/
      );
    },
  ],
  [
    "audio quality path includes VAD, trimming, noise gate, resampling, and max duration",
    () => {
      assertPath("src-tauri/src/commands/audio_quality.rs");
      assertSource("src-tauri/src/commands/audio_quality.rs", /VoiceActivity/);
      assertSource("src-tauri/src/commands/audio_quality.rs", /apply_noise_gate/);
      assertSource("src-tauri/src/commands/audio_quality.rs", /prepare_native_recording/);
      assertSource(
        "scripts/test-audio-quality-contract.js",
        /prepareAudioForTranscription decodes, VAD trims, gates, resamples/
      );
      assertSource("scripts/test-audio-quality-contract.js", /maxDurationSeconds/);
      assertScript("test:audio-quality");
      assertScript("test:tauri-audio-quality");
      assertVerifyIncludes("test:audio-quality");
      assertVerifyTauriIncludes("test:tauri-audio-quality");
    },
  ],
  [
    "privacy mode covers app blacklist, retention, clipboard/history skips, and log redaction",
    () => {
      assertPath("src/features/privacy/privacySettings.ts");
      assertPath("src-tauri/src/commands/privacy.rs");
      assertPath("src-tauri/src/commands/logging.rs");
      assertSource("src/features/privacy/privacySettings.ts", /PRIVACY_APPLICATION_BLACKLIST_KEY/);
      assertSource("src-tauri/src/commands/privacy.rs", /should_skip_transcription_history/);
      assertSource("src-tauri/src/commands/privacy.rs", /should_skip_clipboard_capture/);
      assertSource("src-tauri/src/commands/privacy.rs", /history_retention_days/);
      assertSource("src-tauri/src/commands/logging.rs", /redact_log_value/);
      assertScript("test:privacy-diagnostics");
      assertScript("test:log-redaction");
      assertScript("test:tauri-log-redaction");
      assertVerifyIncludes("test:privacy-diagnostics");
      assertVerifyIncludes("test:log-redaction");
      assertVerifyTauriIncludes("test:tauri-log-redaction");
    },
  ],
  [
    "dictation timeline persists session events and feeds developer diagnostics",
    () => {
      assertPath("src/features/dictation/timeline/sessionTimeline.ts");
      assertSource(
        "src/features/dictation/timeline/sessionTimeline.ts",
        /flushDictationTimelinePersistence/
      );
      assertSource(
        "src/features/dictation/timeline/sessionTimeline.ts",
        /saveDictationTimelineEvents/
      );
      assertSource("src-tauri/src/commands/database.rs", /dictation_timeline_sessions/);
      assertSource("src-tauri/src/commands/dictation.rs", /emit_backend_state_with_timeline/);
      assertSource("src/features/settings/ui/DeveloperSection.tsx", /getDictationTimelineSessions/);
      assertScript("test:dictation-timeline");
      assertScript("test:runtime-smoke");
      assertVerifyIncludes("test:dictation-timeline");
      assertVerifyIncludes("test:runtime-smoke");
    },
  ],
  [
    "goal coverage contract is wired into frontend verification",
    () => {
      assertScript("test:goal-coverage");
      assertVerifyIncludes("test:goal-coverage");
    },
  ],
];

for (const [name, test] of tests) {
  try {
    test();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

console.log(`goal coverage contract tests passed (${tests.length})`);
