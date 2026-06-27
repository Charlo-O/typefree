#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const packageJson = JSON.parse(read("package.json"));
const runner = read("scripts/run-tauri-dev-smoke.js");
const evidenceCollector = read("scripts/collect-runtime-smoke-evidence.js");
const evidencePackager = read("scripts/pack-runtime-smoke-evidence.js");
const evidenceImporter = read("scripts/import-runtime-smoke-evidence.js");
const evidenceHandoff = read("scripts/generate-runtime-smoke-handoff.js");
const evidenceHandoffBundleVerifier = read("scripts/verify-runtime-smoke-handoff-bundle.js");
const smokeSummaryVerifier = read("scripts/verify-runtime-smoke-summaries.js");
const goalCoverage = read("scripts/test-goal-coverage.js");
const agents = read("AGENTS.md");
const runtimeSmokeMatrix = read("docs/runtime-smoke-matrix.md");
const controlPanel = read("src/components/ControlPanel.tsx");
const developerSection = read("src/features/settings/ui/DeveloperSection.tsx");
const credentialsCommand = read("src-tauri/src/commands/credentials.rs");
const tauriLib = read("src-tauri/src/lib.rs");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assertIncludes(text, snippet, context) {
  assert.equal(text.includes(snippet), true, `${context} must include ${snippet}`);
}

function passedCheck(id, meta = {}) {
  return {
    id,
    status: "passed",
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

function smokeSummary(resultKey, result) {
  return {
    success: true,
    state: {
      viteReady: true,
      viteLocalUrl: true,
      devCommand: true,
      appRunning: true,
      [resultKey]: result,
    },
  };
}

function smokeResult(checks) {
  return {
    checks,
    failed: 0,
    status: "passed",
  };
}

function writeJson(dir, name, value) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

function makeVerifierFixtureSummaries(cloudChecks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-summary-"));
  const commonArgs = [
    "--platform",
    "windows",
    "--runtime-probe",
    writeJson(
      dir,
      "runtime.json",
      smokeSummary(
        "runtimeProbeResult",
        smokeResult([
          passedCheck("runtime"),
          passedCheck("native-recording", {
            backend: "windows-wasapi",
            platform: "win32",
            supported: true,
          }),
          passedCheck("foreground"),
          passedCheck("vocabulary"),
          passedCheck("privacy"),
        ])
      )
    ),
    "--native-recording",
    writeJson(
      dir,
      "native.json",
      smokeSummary(
        "nativeRecordingSmokeResult",
        smokeResult([
          passedCheck("native-recording-capabilities", {
            backend: "windows-wasapi",
            platform: "win32",
            supported: true,
          }),
          passedCheck("native-recording-start"),
          passedCheck("native-recording-active"),
          passedCheck("native-recording-capture", {
            audioBytes: 128,
            mimeType: "audio/wav",
            wav: true,
          }),
        ])
      )
    ),
    "--dictation-pipeline",
    writeJson(
      dir,
      "pipeline.json",
      smokeSummary(
        "dictationPipelineSmokeResult",
        smokeResult([
          passedCheck("dictation-pipeline-input"),
          passedCheck("dictation-pipeline-steps", {
            steps: [
              { name: "normalize" },
              { name: "dedupe" },
              { name: "ui" },
              { name: "insert" },
              { name: "clipboard-history" },
              { name: "db-history" },
            ],
          }),
          passedCheck("dictation-pipeline-insert", {
            clipboardRestored: true,
            clipboardRoundTrip: true,
            insertStatus: "completed",
          }),
          passedCheck("dictation-pipeline-history", {
            dbHistoryStatus: "completed",
            savedHistoryId: 1,
          }),
          passedCheck("dictation-pipeline-session", {
            hasPersistedSession: true,
          }),
        ])
      )
    ),
    "--cloud-preflight",
    writeJson(
      dir,
      "preflight.json",
      smokeSummary(
        "cloudCredentialPreflightResult",
        smokeResult([
          passedCheck("cloud-credential-provider"),
          passedCheck("cloud-credential-preflight", {
            missingCredentialKeys: [],
            presenceOnly: true,
            presentCredentialKeys: ["OPENAI_API_KEY"],
            providerRequestStarted: false,
            recordingStarted: false,
            requiredCredentialKeys: ["OPENAI_API_KEY"],
          }),
        ])
      )
    ),
    "--cloud-transcription",
    writeJson(
      dir,
      "cloud.json",
      smokeSummary("cloudTranscriptionSmokeResult", smokeResult(cloudChecks))
    ),
  ];

  return { commonArgs, dir };
}

function runSmokeSummaryVerifier(args, env = {}) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/verify-runtime-smoke-summaries.js"), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function sliceBetween(text, startSnippet, endSnippet, context) {
  const start = text.indexOf(startSnippet);
  assert.notEqual(start, -1, `${context} must include ${startSnippet}`);
  const end = text.indexOf(endSnippet, start + startSnippet.length);
  assert.notEqual(end, -1, `${context} must include ${endSnippet}`);
  return text.slice(start, end);
}

function loadRunnerHelpers(env = {}) {
  const helperSource = runner.slice(0, runner.indexOf("async function main()"));
  const sandbox = {
    require,
    __dirname: path.join(repoRoot, "scripts"),
    process: { ...process, env: { ...process.env, ...env }, platform: "win32" },
    console,
  };

  vm.runInNewContext(
    `${helperSource}\nglobalThis.__helpers = { optionValue, parseArgs, quoteWindowsCmdArg, windowsCmdLine };`,
    sandbox
  );

  return sandbox.__helpers;
}

test("tauri dev smoke runner is exposed but not part of default verify gates", () => {
  assert.equal(packageJson.scripts["smoke:tauri-dev"], "node scripts/run-tauri-dev-smoke.js");
  assert.equal(
    packageJson.scripts["smoke:runtime-probe"],
    "node scripts/run-tauri-dev-smoke.js --runtime-probe"
  );
  assert.equal(
    packageJson.scripts["smoke:native-recording"],
    "node scripts/run-tauri-dev-smoke.js --native-recording-smoke"
  );
  assert.equal(
    packageJson.scripts["smoke:dictation-pipeline"],
    "node scripts/run-tauri-dev-smoke.js --dictation-pipeline-smoke"
  );
  assert.equal(
    packageJson.scripts["smoke:cloud-transcription"],
    "node scripts/run-tauri-dev-smoke.js --cloud-transcription-smoke"
  );
  assert.equal(
    packageJson.scripts["smoke:cloud-credential-preflight"],
    "node scripts/run-tauri-dev-smoke.js --cloud-credential-preflight"
  );
  assert.equal(
    packageJson.scripts["verify:runtime-smoke-summaries"],
    "node scripts/verify-runtime-smoke-summaries.js"
  );
  assert.equal(
    packageJson.scripts["collect:runtime-smoke-evidence"],
    "node scripts/collect-runtime-smoke-evidence.js"
  );
  assert.equal(
    packageJson.scripts["pack:runtime-smoke-evidence"],
    "node scripts/pack-runtime-smoke-evidence.js"
  );
  assert.equal(
    packageJson.scripts["import:runtime-smoke-evidence"],
    "node scripts/import-runtime-smoke-evidence.js"
  );
  assert.equal(
    packageJson.scripts["handoff:runtime-smoke-evidence"],
    "node scripts/generate-runtime-smoke-handoff.js"
  );
  assert.equal(
    packageJson.scripts["verify:runtime-smoke-handoff-bundle"],
    "node scripts/verify-runtime-smoke-handoff-bundle.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-evidence"],
    "node scripts/test-runtime-smoke-evidence-collector.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-packager"],
    "node scripts/test-runtime-smoke-evidence-packager.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-importer"],
    "node scripts/test-runtime-smoke-evidence-importer.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-handoff"],
    "node scripts/test-runtime-smoke-handoff.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-handoff-bundle"],
    "node scripts/test-runtime-smoke-handoff-bundle.js"
  );
  assert.equal(
    packageJson.scripts["test:tauri-dev-smoke-contract"],
    "node scripts/test-tauri-dev-smoke-contract.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-evidence/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-packager/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-importer/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-handoff/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-handoff-bundle/);
  assert.match(packageJson.scripts["verify:tauri"], /npm run test:tauri-dev-smoke-contract/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run smoke:tauri-dev/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run smoke:tauri-dev/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run smoke:runtime-probe/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run smoke:runtime-probe/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run smoke:native-recording/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run smoke:native-recording/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run smoke:dictation-pipeline/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run smoke:dictation-pipeline/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run smoke:cloud-transcription/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run smoke:cloud-transcription/);
  assert.doesNotMatch(
    packageJson.scripts["verify:tauri"],
    /npm run smoke:cloud-credential-preflight/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:frontend"],
    /npm run smoke:cloud-credential-preflight/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:tauri"],
    /npm run verify:runtime-smoke-summaries/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:frontend"],
    /npm run verify:runtime-smoke-summaries/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:frontend"],
    /npm run collect:runtime-smoke-evidence/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:frontend"],
    /npm run pack:runtime-smoke-evidence/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:frontend"],
    /npm run import:runtime-smoke-evidence/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:frontend"],
    /npm run handoff:runtime-smoke-evidence/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:frontend"],
    /npm run verify:runtime-smoke-handoff-bundle/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:tauri"],
    /npm run collect:runtime-smoke-evidence/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:tauri"],
    /npm run pack:runtime-smoke-evidence/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:tauri"],
    /npm run import:runtime-smoke-evidence/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:tauri"],
    /npm run handoff:runtime-smoke-evidence/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:tauri"],
    /npm run verify:runtime-smoke-handoff-bundle/
  );
});

test("runner launches the real Tauri dev command and waits for runtime readiness", () => {
  assert.match(runner, /devCommandForOptions/);
  assert.match(runner, /"npm run tauri:dev"/);
  assert.match(runner, /spawn\(devCommand\.command, devCommand\.args/);
  assertIncludes(runner, "/^\\d+$/.test(arg)", "runner argument parser");
  assert.match(runner, /Running BeforeDevCommand/);
  assert.match(runner, /Running DevCommand/);
  assert.match(runner, /VITE/);
  assert.match(runner, /ready in/);
  assertIncludes(runner, "Local:\\s+http:\\/\\/localhost:5174\\/", "runner readiness");
  assertIncludes(runner, "Finished\\s+`dev` profile", "runner readiness");
  assertIncludes(runner, "target[\\\\/]debug[\\\\/]typefree", "runner readiness");
  assert.match(
    runner,
    /viteReady && state\.viteLocalUrl && state\.devCommand && state\.appRunning/
  );
});

test("runner can wait for the Developer runtime probe sentinel", () => {
  assert.match(runner, /TYPEFREE_RUNTIME_PROBE_RESULT/);
  assert.match(runner, /VITE_TYPEFREE_RUNTIME_PROBE_AUTORUN/);
  assert.match(runner, /tauri-smoke-\$\{stamp\}\.conf\.json/);
  assert.match(runner, /\?panel=true&runtimeProbe=1/);
  assert.match(runner, /const smokeArgs = \["npx", "tauri", "dev", "--config"/);
  assert.match(runner, /args: \["\/d", "\/c", windowsCmdLine\(smokeArgs\)\]/);
  assert.match(runner, /parseRuntimeProbeResult/);
  assert.match(runner, /runtimeProbeResult/);
  assert.match(runner, /options\.runtimeProbe/);
  assert.match(runner, /runtime probe reported failed checks/);
  assert.match(runner, /runtime-probe:\$\{state\.runtimeProbeResult\?\.status/);
});

test("runner can wait for the native recording smoke sentinel", () => {
  assert.match(runner, /TYPEFREE_NATIVE_RECORDING_SMOKE_RESULT/);
  assert.match(runner, /VITE_TYPEFREE_NATIVE_RECORDING_SMOKE_AUTORUN/);
  assert.match(runner, /\?panel=true&nativeRecordingSmoke=1/);
  assert.match(runner, /parseNativeRecordingSmokeResult/);
  assert.match(runner, /nativeRecordingSmokeResult/);
  assert.match(runner, /options\.nativeRecordingSmoke/);
  assert.match(runner, /native recording smoke reported failed checks/);
  assert.match(runner, /native-recording-smoke:\$\{state\.nativeRecordingSmokeResult\?\.status/);
});

test("runner can wait for the dictation pipeline smoke sentinel", () => {
  assert.match(runner, /TYPEFREE_DICTATION_PIPELINE_SMOKE_RESULT/);
  assert.match(runner, /VITE_TYPEFREE_DICTATION_PIPELINE_SMOKE_AUTORUN/);
  assert.match(runner, /\?panel=true&dictationPipelineSmoke=1/);
  assert.match(runner, /parseDictationPipelineSmokeResult/);
  assert.match(runner, /dictationPipelineSmokeResult/);
  assert.match(runner, /options\.dictationPipelineSmoke/);
  assert.match(runner, /dictation pipeline smoke reported failed checks/);
  assert.match(
    runner,
    /dictation-pipeline-smoke:\$\{state\.dictationPipelineSmokeResult\?\.status/
  );
});

test("runner can wait for the cloud transcription smoke sentinel", () => {
  assert.match(runner, /TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_RESULT/);
  assert.match(runner, /VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_AUTORUN/);
  assert.match(runner, /panel: "true"/);
  assert.match(runner, /cloudTranscriptionSmoke: "1"/);
  assert.match(runner, /cloudTranscriptionSmokeProvider/);
  assert.match(runner, /cloudTranscriptionSmokeModel/);
  assert.match(runner, /cloudTranscriptionSmokeLanguage/);
  assert.match(runner, /--cloud-speech-fixture/);
  assert.match(runner, /--cloud-speaker-fixture/);
  assert.match(runner, /npm_config_cloud_speech_fixture/);
  assert.match(runner, /npm_config_cloud_speaker_fixture/);
  assert.match(runner, /writeWindowsSpeechFixture/);
  assert.match(runner, /SpeechAudioFormatInfo\(16000/);
  assert.match(runner, /cloudTranscriptionFixturePath/);
  assert.match(runner, /cloudTranscriptionPlaybackPath/);
  assert.match(runner, /npm_config_cloud_provider/);
  assert.match(runner, /npm_config_cloud_model/);
  assert.match(runner, /npm_config_cloud_language/);
  assert.match(runner, /parseCloudTranscriptionSmokeResult/);
  assert.match(runner, /cloudTranscriptionSmokeResult/);
  assert.match(runner, /options\.cloudTranscriptionSmoke/);
  assert.match(runner, /cloud transcription smoke reported failed checks/);
  assert.match(controlPanel, /VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_AUTORUN/);
  assert.match(controlPanel, /params\.has\("cloudTranscriptionSmoke"\)/);
  assert.match(controlPanel, /cloudTranscriptionSmokeAutorun/);
  assert.match(developerSection, /credentialKeysForCloudTranscriptionProvider/);
  assert.match(developerSection, /platform\.secrets\.status/);
  assert.match(developerSection, /cloud-transcription-credentials/);
  assert.match(developerSection, /cloudTranscriptionFixturePath/);
  assert.match(developerSection, /cloudTranscriptionPlaybackPath/);
  assert.match(developerSection, /loadCloudTranscriptionFixtureAudio/);
  assert.match(developerSection, /playCloudTranscriptionPlaybackAudio/);
  assert.match(developerSection, /cloud-transcription-speech-fixture/);
  assert.match(developerSection, /cloud-transcription-speaker-playback/);
  assert.match(developerSection, /audioSource: "speech-fixture"/);
  assert.match(developerSection, /audioSource: "speaker-playback"/);
  assert.match(developerSection, /audioSource: fixturePath \? "speech-fixture" : "native-recording"/);
  assert.match(developerSection, /recordingStarted: false/);
  assert.match(developerSection, /function formatError/);
  assert.match(developerSection, /JSON\.stringify\(error\)/);
  assert.match(developerSection, /formatErrorMeta\(error\)/);
  assert.match(credentialsCommand, /pub struct CredentialStatus/);
  assert.match(credentialsCommand, /pub fn get_credential_status/);
  assert.match(tauriLib, /credentials::get_credential_status/);
  assert.match(
    runner,
    /cloud-transcription-smoke:\$\{state\.cloudTranscriptionSmokeResult\?\.status/
  );
});

test("runner can wait for the cloud credential preflight sentinel without recording or STT", () => {
  assert.match(runner, /TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_RESULT/);
  assert.match(runner, /VITE_TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_AUTORUN/);
  assert.match(runner, /--cloud-credential-preflight/);
  assert.match(runner, /cloudCredentialPreflight: "1"/);
  assert.match(runner, /parseCloudCredentialPreflightResult/);
  assert.match(runner, /cloudCredentialPreflightResult/);
  assert.match(runner, /options\.cloudCredentialPreflight/);
  assert.match(runner, /npm_config_timeout_ms/);
  assert.match(runner, /cloud credential preflight reported failed checks/);
  assert.match(
    runner,
    /cloud-credential-preflight:\$\{state\.cloudCredentialPreflightResult\?\.status/
  );
  assert.match(controlPanel, /VITE_TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_AUTORUN/);
  assert.match(controlPanel, /params\.has\("cloudCredentialPreflight"\)/);
  assert.match(controlPanel, /cloudCredentialPreflightAutorun/);
  assert.match(developerSection, /handleRunCloudCredentialPreflight/);
  assert.match(developerSection, /TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_RESULT/);
  assert.match(developerSection, /cloud-credential-preflight/);
  assert.match(developerSection, /presenceOnly: true/);
  assert.match(developerSection, /recordingStarted: false/);
  assert.match(developerSection, /providerRequestStarted: false/);

  const preflightHandler = sliceBetween(
    developerSection,
    "const handleRunCloudCredentialPreflight",
    "const handleRunCloudTranscriptionSmoke",
    "DeveloperSection cloud credential preflight handler"
  );
  assert.doesNotMatch(preflightHandler, /startNative\(/);
  assert.doesNotMatch(preflightHandler, /stopNative\(/);
  assert.doesNotMatch(preflightHandler, /cancelNative\(/);
  assert.doesNotMatch(preflightHandler, /transcribeAudio/);
  assert.doesNotMatch(preflightHandler, /waitForSmokeDuration/);

  const statusFunction = sliceBetween(
    credentialsCommand,
    "pub fn get_credential_status_value",
    "#[tauri::command]\npub fn get_credential",
    "credential status function"
  );
  assert.match(statusFunction, /platform_has_credential/);
  assert.doesNotMatch(statusFunction, /get_credential_value/);
  assert.doesNotMatch(statusFunction, /read_legacy_env_key/);
  assert.doesNotMatch(statusFunction, /platform_set_credential/);
  assert.doesNotMatch(statusFunction, /remove_legacy_env_key/);
  assert.match(credentialsCommand, /fn platform_has_credential/);
});

test("runner quotes Windows runtime-probe config paths without shell splitting", () => {
  const { quoteWindowsCmdArg, windowsCmdLine } = loadRunnerHelpers();
  const unsafePath = "C:\\Users\\Name With Space\\probe&config%run.json";

  assert.equal(
    quoteWindowsCmdArg(unsafePath),
    '"C:\\Users\\Name With Space\\probe&config^%run.json"'
  );
  assert.equal(
    windowsCmdLine(["npx", "tauri", "dev", "--config", unsafePath]),
    'npx tauri dev --config "C:\\Users\\Name With Space\\probe&config^%run.json"'
  );
});

test("runner treats npm boolean cloud provider config as absent and uses bare provider fallback", () => {
  const { optionValue, parseArgs } = loadRunnerHelpers({
    npm_config_cloud_provider: "true",
    npm_config_cloud_speech_fixture: "true",
  });

  assert.equal(optionValue("true"), "");
  assert.equal(optionValue("volcengine"), "volcengine");

  const parsed = parseArgs(["--cloud-transcription-smoke", "volcengine"]);
  assert.equal(parsed.cloudTranscriptionSmoke, true);
  assert.equal(parsed.cloudSpeechFixture, true);
  assert.equal(parsed.cloudTranscriptionProvider, "volcengine");
});

test("runner writes bounded smoke evidence and cleans up process trees", () => {
  assert.match(runner, /\.codex-run-logs/);
  assert.match(runner, /tauri-dev-smoke-\$\{stamp\}\.out\.log/);
  assert.match(runner, /tauri-dev-smoke-\$\{stamp\}\.err\.log/);
  assert.match(runner, /tauri-dev-smoke-\$\{stamp\}\.summary\.json/);
  assert.match(runner, /writeSummary\(logPaths\.summary/);
  assert.match(runner, /taskkill/);
  assert.match(runner, /\/T/);
  assert.match(runner, /\/F/);
  assert.match(runner, /process\.kill\(-pid, "SIGTERM"\)/);
  assert.match(runner, /process\.kill\(-pid, "SIGKILL"\)/);
  assert.match(runner, /watchdogTimer = setTimeout/);
  assert.match(runner, /clearTimeout\(watchdogTimer\)/);
  assert.match(runner, /timeout after \$\{options\.timeoutMs\}ms/);
  assert.match(runner, /tailLines\(stdout\)/);
  assert.match(runner, /tailLines\(stderr\)/);
});

test("runtime smoke summary verifier checks external evidence payloads", () => {
  for (const snippet of [
    "PLATFORM_NODE_VALUES",
    "runtimeProbeResult",
    "nativeRecordingSmokeResult",
    "dictationPipelineSmokeResult",
    "cloudCredentialPreflightResult",
    "cloudTranscriptionSmokeResult",
    "cloud-transcription-result",
    "transcriptLength",
    "recordingStarted",
    "providerRequestStarted",
    "assertCloudSummaryHasNoSensitivePayload",
    "assertCloudMicrophoneEvidence",
    "envFlag",
    "npm_config_require_cloud_microphone",
    "--require-cloud-microphone",
    "cloud-transcription-recording-capabilities",
    "cloud-transcription-recording-capture",
    "native-recording",
    "Positional fallback",
    "allow-missing-cloud-transcription",
  ]) {
    assertIncludes(smokeSummaryVerifier, snippet, "runtime smoke summary verifier");
  }
});

test("runtime smoke summary verifier distinguishes fixture from microphone evidence", () => {
  const fixtureCloudChecks = [
    passedCheck("cloud-transcription-provider", {
      provider: "volcengine",
    }),
    passedCheck("cloud-transcription-credentials", {
      missingCredentialKeys: [],
      presentCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
      requiredCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
    }),
    passedCheck("cloud-transcription-speech-fixture", {
      audioBytes: 128,
      audioSource: "speech-fixture",
      recordingStarted: false,
      wav: true,
    }),
    passedCheck("cloud-transcription-result", {
      audioBytes: 128,
      audioSource: "speech-fixture",
      provider: "volcengine",
      transcriptLength: 12,
    }),
  ];

  const fixture = makeVerifierFixtureSummaries(fixtureCloudChecks);
  const fixtureDefault = runSmokeSummaryVerifier(fixture.commonArgs);
  assert.equal(fixtureDefault.status, 0, fixtureDefault.stderr || fixtureDefault.stdout);

  const fixtureStrict = runSmokeSummaryVerifier(fixture.commonArgs, {
    npm_config_require_cloud_microphone: "true",
  });
  assert.notEqual(fixtureStrict.status, 0, "strict microphone mode must reject speech fixture evidence");
  assert.match(fixtureStrict.stderr, /cloud-transcription\.microphone/);

  const microphone = makeVerifierFixtureSummaries([
    passedCheck("cloud-transcription-provider", {
      provider: "volcengine",
    }),
    passedCheck("cloud-transcription-credentials", {
      missingCredentialKeys: [],
      presentCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
      requiredCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
    }),
    passedCheck("cloud-transcription-recording-capabilities", {
      backend: "windows-wasapi",
      platform: "win32",
      supported: true,
    }),
    passedCheck("cloud-transcription-recording-start"),
    passedCheck("cloud-transcription-recording-capture", {
      audioBytes: 128,
      mimeType: "audio/wav",
      wav: true,
    }),
    passedCheck("cloud-transcription-result", {
      audioBytes: 128,
      audioSource: "native-recording",
      provider: "volcengine",
      transcriptLength: 12,
    }),
  ]);
  const microphoneStrict = runSmokeSummaryVerifier(microphone.commonArgs, {
    npm_config_require_cloud_microphone: "true",
  });
  assert.equal(microphoneStrict.status, 0, microphoneStrict.stderr || microphoneStrict.stdout);
});

test("runtime smoke contract is represented in goal coverage and assistant docs", () => {
  assertIncludes(goalCoverage, "smoke:tauri-dev", "goal coverage");
  assertIncludes(goalCoverage, "smoke:runtime-probe", "goal coverage");
  assertIncludes(goalCoverage, "smoke:native-recording", "goal coverage");
  assertIncludes(goalCoverage, "smoke:dictation-pipeline", "goal coverage");
  assertIncludes(goalCoverage, "smoke:cloud-transcription", "goal coverage");
  assertIncludes(goalCoverage, "smoke:cloud-credential-preflight", "goal coverage");
  assertIncludes(goalCoverage, "collect:runtime-smoke-evidence", "goal coverage");
  assertIncludes(goalCoverage, "pack:runtime-smoke-evidence", "goal coverage");
  assertIncludes(goalCoverage, "import:runtime-smoke-evidence", "goal coverage");
  assertIncludes(goalCoverage, "handoff:runtime-smoke-evidence", "goal coverage");
  assertIncludes(goalCoverage, "verify:runtime-smoke-handoff-bundle", "goal coverage");
  assertIncludes(goalCoverage, "test:tauri-dev-smoke-contract", "goal coverage");
  assertIncludes(agents, "npm run smoke:tauri-dev", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run smoke:runtime-probe", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run smoke:native-recording", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run smoke:dictation-pipeline", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run smoke:cloud-transcription", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run smoke:cloud-credential-preflight", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run collect:runtime-smoke-evidence", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run pack:runtime-smoke-evidence", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run import:runtime-smoke-evidence", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run handoff:runtime-smoke-evidence", "AGENTS.md testing checklist");
  assertIncludes(agents, "npm run verify:runtime-smoke-handoff-bundle", "AGENTS.md testing checklist");
  assertIncludes(agents, "TypeFree repo root", "AGENTS.md testing checklist");
  assertIncludes(agents, "handoff bundle directory", "AGENTS.md testing checklist");
});

test("runtime evidence collector reuses smoke runner and single-platform verifier", () => {
  for (const snippet of [
    "run-tauri-dev-smoke.js",
    "--runtime-probe",
    "--native-recording-smoke",
    "--dictation-pipeline-smoke",
    "--cloud-credential-preflight",
    "--cloud-transcription-smoke",
    "verify-runtime-smoke-summaries.js",
    "--require-cloud-microphone",
    "copyStableSummaries",
    "runtime-smoke-set.${options.platform}.manifest.json",
  ]) {
    assertIncludes(evidenceCollector, snippet, "runtime smoke evidence collector");
  }
});

test("runtime evidence packager validates existing summaries without running Tauri", () => {
  for (const snippet of [
    "verify-runtime-smoke-summaries.js",
    "--require-cloud-microphone",
    "packedFromExistingSummaries",
    "portableSummaryPaths",
    "runtime-smoke-set.${options.platform}.manifest.json",
    "TYPEFREE_RUNTIME_SMOKE_PACK_RESULT",
  ]) {
    assertIncludes(evidencePackager, snippet, "runtime smoke evidence packager");
  }
  assert.doesNotMatch(evidencePackager, /run-tauri-dev-smoke|tauri dev|VITE_TYPEFREE/);
});

test("runtime evidence importer validates returned bundles without running Tauri", () => {
  for (const snippet of [
    "verify-runtime-smoke-summaries.js",
    "--require-cloud-microphone",
    "TYPEFREE_RUNTIME_SMOKE_IMPORT_RESULT",
    "discoverChildBundleManifests",
    "copyWhitelistedBundleFiles",
    "preflightImportEntries",
    "resolveRelativeBundlePath",
    "assertManifestHasNoSensitivePayload",
    "destination already exists",
  ]) {
    assertIncludes(evidenceImporter, snippet, "runtime smoke evidence importer");
  }
  assert.doesNotMatch(evidenceImporter, /run-tauri-dev-smoke|tauri dev|VITE_TYPEFREE|fetch\(|get_credential/);
});

test("runtime evidence handoff generates external collector commands without running Tauri", () => {
  for (const snippet of [
    "collect:runtime-smoke-evidence",
    "verify:goal-readiness",
    "--require-cloud-microphone",
    "--output <file>",
    "--bundle-dir <dir>",
    "writeBundle",
    "importCommandFileContent",
    "import-returned-evidence.ps1",
    "import-returned-evidence.sh",
    "runtime-smoke-handoff.manifest.json",
    "typefree-runtime-smoke-handoff-bundle",
    "handoff bundle written:",
    "writeOutput",
    "handoff written:",
    "TYPEFREE_RUNTIME_SMOKE_HANDOFF",
    "Find-TypeFreeRepoRoot",
    "find_typefree_repo_root",
    "Unable to locate TypeFree repo root",
  ]) {
    assertIncludes(evidenceHandoff, snippet, "runtime smoke evidence handoff");
  }
  assert.doesNotMatch(
    evidenceHandoff,
    /node:child_process|spawnSync|execSync|execFile|exec\(|run-tauri-dev-smoke|tauri dev|fetch\(|get_credential|API_KEY|ACCESS_TOKEN|cloud-speech-fixture|allow-missing-cloud/
  );
});

test("runtime evidence handoff bundle verifier checks structure without running Tauri", () => {
  for (const snippet of [
    "TYPEFREE_RUNTIME_SMOKE_HANDOFF_BUNDLE_VERIFY",
    "runtime-smoke-handoff.manifest.json",
    "typefree-runtime-smoke-handoff-bundle",
    "assertNoUnexpectedScripts",
    "assertJsonHasNoSensitivePayload",
    "importCommandFileContent",
    "path must stay inside the handoff bundle",
    "npm run collect:runtime-smoke-evidence",
    "npm run import:runtime-smoke-evidence",
    "npm run verify:goal-readiness -- --manifest-dir",
  ]) {
    assertIncludes(evidenceHandoffBundleVerifier, snippet, "runtime smoke handoff bundle verifier");
  }
  assert.doesNotMatch(
    evidenceHandoffBundleVerifier,
    /node:child_process|spawnSync|execSync|execFile|exec\(|run-tauri-dev-smoke|tauri dev|fetch\(|get_credential|API_KEY|ACCESS_TOKEN/
  );
});

test("external runtime smoke matrix names platform-live evidence requirements", () => {
  for (const platform of ["Windows", "macOS", "Linux"]) {
    assertIncludes(runtimeSmokeMatrix, platform, "runtime smoke matrix platforms");
  }

  for (const command of [
    "npm run smoke:runtime-probe",
    "npm run smoke:native-recording",
    "npm run smoke:dictation-pipeline",
    "npm run smoke:cloud-credential-preflight -- --cloud-provider <provider>",
    "npm run smoke:cloud-transcription -- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang>",
    "npm run handoff:runtime-smoke-evidence -- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang> --cloud-smoke-ms <ms>",
    "npm run verify:runtime-smoke-handoff-bundle -- --bundle-dir <dir>",
    "npm run import:runtime-smoke-evidence -- --source <runtime-smoke-evidence-platform-dir-or-manifest> --manifest-dir <dir>",
    "npm run verify:runtime-smoke-summaries -- --platform <platform>",
    "handoff bundle directory",
    "TypeFree repo root",
  ]) {
    assertIncludes(runtimeSmokeMatrix, command, "runtime smoke matrix commands");
  }

  for (const evidence of [
    ".codex-run-logs/*.summary.json",
    "runtimeProbeResult.status",
    "nativeRecordingSmokeResult.status",
    "dictationPipelineSmokeResult.status",
    "cloudCredentialPreflightResult.status",
    "recordingStarted",
    "providerRequestStarted",
    "cloudTranscriptionSmokeResult.status",
    "transcriptLength",
    "Transcript text is absent",
    "Credential values are absent",
    "not prove native microphone recording",
    "--require-cloud-microphone",
    "audioSource: \"native-recording\"",
  ]) {
    assertIncludes(runtimeSmokeMatrix, evidence, "runtime smoke matrix evidence");
  }
});

let failures = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exit(1);
}

console.log(`tauri dev smoke contract tests passed (${tests.length})`);
