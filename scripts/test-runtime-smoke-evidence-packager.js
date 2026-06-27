#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const packerScript = path.join(repoRoot, "scripts/pack-runtime-smoke-evidence.js");
const packerSource = fs.readFileSync(packerScript, "utf8");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function passedCheck(id, meta = {}) {
  return {
    id,
    status: "passed",
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

function smokeResult(checks) {
  return {
    checks,
    failed: 0,
    status: "passed",
  };
}

function smokeSummary(resultKey, result) {
  return {
    success: true,
    state: {
      appRunning: true,
      devCommand: true,
      viteLocalUrl: true,
      viteReady: true,
      [resultKey]: result,
    },
  };
}

function writeJson(dir, name, value) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

function writeWindowsSummaries(dir) {
  return {
    "runtime-probe": writeJson(
      dir,
      "windows-runtime.json",
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
    "native-recording": writeJson(
      dir,
      "windows-native.json",
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
    "dictation-pipeline": writeJson(
      dir,
      "windows-pipeline.json",
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
    "cloud-preflight": writeJson(
      dir,
      "windows-preflight.json",
      smokeSummary(
        "cloudCredentialPreflightResult",
        smokeResult([
          passedCheck("cloud-credential-provider"),
          passedCheck("cloud-credential-preflight", {
            missingCredentialKeys: [],
            presenceOnly: true,
            presentCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
            providerRequestStarted: false,
            recordingStarted: false,
            requiredCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
          }),
        ])
      )
    ),
    "cloud-transcription": writeJson(
      dir,
      "windows-cloud.json",
      smokeSummary(
        "cloudTranscriptionSmokeResult",
        smokeResult([
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
        ])
      )
    ),
  };
}

function packerArgs(summaries, extra = []) {
  return [
    "--platform",
    "windows",
    "--runtime-probe",
    summaries["runtime-probe"],
    "--native-recording",
    summaries["native-recording"],
    "--dictation-pipeline",
    summaries["dictation-pipeline"],
    "--cloud-preflight",
    summaries["cloud-preflight"],
    "--cloud-transcription",
    summaries["cloud-transcription"],
    ...extra,
  ];
}

function runPacker(args) {
  return spawnSync(process.execPath, [packerScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function extractManifest(stdout) {
  const match = stdout.match(/^manifest:\s*(.+?\.manifest\.json)\s*$/m);
  assert.ok(match, stdout);
  return match[1];
}

function listEvidenceDirs(logDir) {
  if (!fs.existsSync(logDir)) {
    return [];
  }
  return fs
    .readdirSync(logDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("runtime-smoke-evidence-"))
    .map((entry) => entry.name);
}

test("packer is exposed but not part of long-running default gates", () => {
  assert.equal(
    packageJson.scripts["pack:runtime-smoke-evidence"],
    "node scripts/pack-runtime-smoke-evidence.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-packager"],
    "node scripts/test-runtime-smoke-evidence-packager.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-packager/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run pack:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run pack:runtime-smoke-evidence/);
});

test("packer dry run prints strict verifier and manifest sentinel", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-pack-"));
  const summaries = writeWindowsSummaries(dir);
  const result = runPacker(packerArgs(summaries, ["--dry-run"]));

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /verify-runtime-smoke-summaries\.js/);
  assert.match(result.stdout, /--require-cloud-microphone/);
  assert.match(result.stdout, /TYPEFREE_RUNTIME_SMOKE_PACK_RESULT/);
  assert.match(result.stdout, /"status":"dry-run"/);
});

test("packer validates, copies, and writes portable manifest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-pack-"));
  const logDir = path.join(dir, "logs");
  const summaries = writeWindowsSummaries(dir);
  const result = runPacker(packerArgs(summaries, ["--log-dir", logDir]));

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /runtime smoke summaries passed for windows/);
  assert.match(result.stdout, /TYPEFREE_RUNTIME_SMOKE_PACK_RESULT/);

  const manifestPath = extractManifest(result.stdout);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.platform, "windows");
  assert.equal(manifest.packedFromExistingSummaries, true);
  assert.equal(manifest.summarySetDir, ".");
  for (const kind of [
    "runtime-probe",
    "native-recording",
    "dictation-pipeline",
    "cloud-preflight",
    "cloud-transcription",
  ]) {
    assert.equal(manifest.summaries[kind], `${kind}.summary.json`);
    assert.equal(fs.existsSync(path.join(path.dirname(manifestPath), manifest.summaries[kind])), true);
  }
});

test("packer refuses fixture-only cloud evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-pack-"));
  const logDir = path.join(dir, "logs");
  const summaries = writeWindowsSummaries(dir);
  const fixtureCloud = JSON.parse(fs.readFileSync(summaries["cloud-transcription"], "utf8"));
  fixtureCloud.state.cloudTranscriptionSmokeResult.checks = fixtureCloud.state.cloudTranscriptionSmokeResult.checks
    .filter((check) => !check.id.startsWith("cloud-transcription-recording-"))
    .map((check) =>
      check.id === "cloud-transcription-result"
        ? {
            ...check,
            meta: {
              ...check.meta,
              audioSource: "speech-fixture",
            },
          }
        : check
    );
  fixtureCloud.state.cloudTranscriptionSmokeResult.checks.push(
    passedCheck("cloud-transcription-speech-fixture", {
      audioBytes: 128,
      audioSource: "speech-fixture",
      recordingStarted: false,
      wav: true,
    })
  );
  fs.writeFileSync(summaries["cloud-transcription"], JSON.stringify(fixtureCloud, null, 2));

  const result = runPacker(packerArgs(summaries, ["--log-dir", logDir]));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime summary verification failed/);
  assert.deepEqual(listEvidenceDirs(logDir), []);
});

test("packer source stays a manifest packer and does not run Tauri", () => {
  for (const snippet of [
    "cleanupUnfinishedEvidenceDir",
    "packedFromExistingSummaries",
    "portableSummaryPaths",
    "summarySetDir: \".\"",
    "TYPEFREE_RUNTIME_SMOKE_PACK_RESULT",
    "--require-cloud-microphone",
    "verify-runtime-smoke-summaries.js",
  ]) {
    assert.equal(packerSource.includes(snippet), true, `packer source must include ${snippet}`);
  }
  assert.doesNotMatch(packerSource, /run-tauri-dev-smoke|tauri dev|VITE_TYPEFREE/);
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

console.log(`runtime smoke evidence packager tests passed (${tests.length})`);
