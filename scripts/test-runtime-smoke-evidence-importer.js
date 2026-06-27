#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const importerScript = path.join(repoRoot, "scripts/import-runtime-smoke-evidence.js");
const importerSource = fs.readFileSync(importerScript, "utf8");

const platformNodeValues = {
  windows: "win32",
  macos: "darwin",
  linux: "linux",
};

const platformBackends = {
  windows: "windows-wasapi",
  macos: "coreaudio",
  linux: "pipewire",
};

const summaryKinds = [
  "runtime-probe",
  "native-recording",
  "dictation-pipeline",
  "cloud-preflight",
  "cloud-transcription",
];

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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function writePlatformBundle(root, platform, options = {}) {
  const bundleName = options.bundleName || `runtime-smoke-evidence-${platform}-2026-06-25T18-00-00-000Z`;
  const bundleDir = path.join(root, bundleName);
  fs.mkdirSync(bundleDir, { recursive: true });
  const nodePlatform = platformNodeValues[platform];
  const backend = platformBackends[platform];

  const summaries = {
    "runtime-probe": writeJson(
      path.join(bundleDir, "runtime-probe.summary.json"),
      smokeSummary(
        "runtimeProbeResult",
        smokeResult([
          passedCheck("runtime"),
          passedCheck("native-recording", {
            backend,
            platform: nodePlatform,
            supported: true,
          }),
          passedCheck("foreground"),
          passedCheck("vocabulary"),
          passedCheck("privacy"),
        ])
      )
    ),
    "native-recording": writeJson(
      path.join(bundleDir, "native-recording.summary.json"),
      smokeSummary(
        "nativeRecordingSmokeResult",
        smokeResult([
          passedCheck("native-recording-capabilities", {
            backend,
            platform: nodePlatform,
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
      path.join(bundleDir, "dictation-pipeline.summary.json"),
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
      path.join(bundleDir, "cloud-preflight.summary.json"),
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
      path.join(bundleDir, "cloud-transcription.summary.json"),
      smokeSummary(
        "cloudTranscriptionSmokeResult",
        smokeResult(
          options.fixtureOnly
            ? [
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
              ]
            : [
                passedCheck("cloud-transcription-provider", {
                  provider: "volcengine",
                }),
                passedCheck("cloud-transcription-credentials", {
                  missingCredentialKeys: [],
                  presentCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
                  requiredCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
                }),
                passedCheck("cloud-transcription-recording-capabilities", {
                  backend,
                  platform: nodePlatform,
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
              ]
        )
      )
    ),
  };

  const manifest = {
    collectedAt: "2026-06-25T18:00:00.000Z",
    goalReadinessArgs: summaryKinds.flatMap((kind) => [`--${platform}-${kind}`, `${kind}.summary.json`]),
    platform,
    summaries: Object.fromEntries(summaryKinds.map((kind) => [kind, `${kind}.summary.json`])),
    summarySetDir: ".",
    verifyCommand: "node scripts/verify-runtime-smoke-summaries.js --require-cloud-microphone",
    ...options.manifestOverrides,
  };
  const manifestPath = writeJson(path.join(bundleDir, `runtime-smoke-set.${platform}.manifest.json`), manifest);
  return { bundleDir, manifestPath, summaries };
}

function runImporter(args) {
  return spawnSync(process.execPath, [importerScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function extractImportResult(stdout) {
  const match = stdout.match(/^TYPEFREE_RUNTIME_SMOKE_IMPORT_RESULT\s+(.+)$/m);
  assert.ok(match, stdout);
  return JSON.parse(match[1]);
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

test("importer is exposed but import command stays outside default verify gates", () => {
  assert.equal(
    packageJson.scripts["import:runtime-smoke-evidence"],
    "node scripts/import-runtime-smoke-evidence.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-importer"],
    "node scripts/test-runtime-smoke-evidence-importer.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-importer/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run import:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run import:runtime-smoke-evidence/);
});

test("importer validates and copies a portable evidence bundle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const manifestDir = path.join(dir, "integration");
  const bundle = writePlatformBundle(sourceRoot, "macos");
  fs.writeFileSync(path.join(bundle.bundleDir, "extra-debug.log"), "should not be imported");
  const result = runImporter(["--source", bundle.bundleDir, "--manifest-dir", manifestDir]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /runtime smoke summaries passed for macos/);
  const imported = extractImportResult(result.stdout);
  assert.equal(imported.platform, "macos");
  assert.equal(imported.status, "passed");
  assert.equal(imported.imports.length, 1);
  assert.equal(path.dirname(imported.destination), manifestDir);
  assert.equal(fs.existsSync(imported.manifest), true);
  assert.equal(fs.existsSync(path.join(imported.destination, "runtime-probe.summary.json")), true);
  assert.equal(fs.existsSync(path.join(imported.destination, "extra-debug.log")), false);
});

test("importer batch imports one-level returned platform bundles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "returned");
  const manifestDir = path.join(dir, "integration");
  writePlatformBundle(sourceRoot, "macos");
  writePlatformBundle(sourceRoot, "linux");
  fs.mkdirSync(path.join(sourceRoot, "notes"), { recursive: true });

  const result = runImporter(["--source", sourceRoot, "--manifest-dir", manifestDir]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /runtime smoke summaries passed for macos/);
  assert.match(result.stdout, /runtime smoke summaries passed for linux/);
  const imported = extractImportResult(result.stdout);
  assert.equal(imported.status, "passed");
  assert.equal(imported.platform, null);
  assert.deepEqual(
    imported.imports.map((item) => item.platform),
    ["macos", "linux"]
  );
  assert.equal(listEvidenceDirs(manifestDir).length, 2);
});

test("importer platform filter imports only matching child bundles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "returned");
  const manifestDir = path.join(dir, "integration");
  writePlatformBundle(sourceRoot, "macos");
  writePlatformBundle(sourceRoot, "linux");

  const result = runImporter(["--source", sourceRoot, "--platform", "linux", "--manifest-dir", manifestDir]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const imported = extractImportResult(result.stdout);
  assert.deepEqual(
    imported.imports.map((item) => item.platform),
    ["linux"]
  );
  assert.deepEqual(listEvidenceDirs(manifestDir), ["runtime-smoke-evidence-linux-2026-06-25T18-00-00-000Z"]);
});

test("importer rejects duplicate platform bundles in a batch source", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "returned");
  const manifestDir = path.join(dir, "integration");
  writePlatformBundle(sourceRoot, "macos", {
    bundleName: "runtime-smoke-evidence-macos-2026-06-25T18-00-00-000Z",
  });
  writePlatformBundle(sourceRoot, "macos", {
    bundleName: "runtime-smoke-evidence-macos-2026-06-25T19-00-00-000Z",
  });

  const result = runImporter(["--source", sourceRoot, "--manifest-dir", manifestDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate runtime evidence platform/);
  assert.deepEqual(listEvidenceDirs(manifestDir), []);
});

test("importer preflights batch destination conflicts before copying other platforms", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const returnedRoot = path.join(dir, "returned");
  const manifestDir = path.join(dir, "integration");
  const existing = writePlatformBundle(sourceRoot, "macos");
  const first = runImporter(["--source", existing.bundleDir, "--manifest-dir", manifestDir]);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  writePlatformBundle(returnedRoot, "macos");
  writePlatformBundle(returnedRoot, "linux");
  const result = runImporter(["--source", returnedRoot, "--manifest-dir", manifestDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /destination already exists/);
  assert.deepEqual(listEvidenceDirs(manifestDir), ["runtime-smoke-evidence-macos-2026-06-25T18-00-00-000Z"]);
});

test("importer accepts a manifest path and renames non-standard bundle directories", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const manifestDir = path.join(dir, "integration");
  const bundle = writePlatformBundle(sourceRoot, "linux", {
    bundleName: "linux-bundle-from-runner",
  });
  const result = runImporter(["--source", bundle.manifestPath, "--manifest-dir", manifestDir, "--platform", "linux"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const imported = extractImportResult(result.stdout);
  assert.equal(path.basename(imported.destination).startsWith("runtime-smoke-evidence-linux-imported-"), true);
  assert.equal(fs.existsSync(imported.manifest), true);
});

test("importer refuses duplicate destinations unless replace is explicit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const manifestDir = path.join(dir, "integration");
  const bundle = writePlatformBundle(sourceRoot, "macos");

  const first = runImporter(["--source", bundle.bundleDir, "--manifest-dir", manifestDir]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const second = runImporter(["--source", bundle.bundleDir, "--manifest-dir", manifestDir]);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /destination already exists/);

  const replaced = runImporter(["--source", bundle.bundleDir, "--manifest-dir", manifestDir, "--replace"]);
  assert.equal(replaced.status, 0, replaced.stderr || replaced.stdout);
});

test("importer replace failures preserve the existing destination", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const badRoot = path.join(dir, "bad");
  const manifestDir = path.join(dir, "integration");
  const valid = writePlatformBundle(sourceRoot, "macos");
  const first = runImporter(["--source", valid.bundleDir, "--manifest-dir", manifestDir]);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const bad = writePlatformBundle(badRoot, "macos", {
    fixtureOnly: true,
  });
  const replaced = runImporter(["--source", bad.bundleDir, "--manifest-dir", manifestDir, "--replace"]);
  assert.notEqual(replaced.status, 0);
  assert.match(replaced.stderr, /runtime summary verification failed/);
  assert.deepEqual(listEvidenceDirs(manifestDir), ["runtime-smoke-evidence-macos-2026-06-25T18-00-00-000Z"]);
  assert.equal(
    fs.existsSync(
      path.join(
        manifestDir,
        "runtime-smoke-evidence-macos-2026-06-25T18-00-00-000Z",
        "runtime-smoke-set.macos.manifest.json"
      )
    ),
    true
  );
});

test("importer rejects fixture-only cloud evidence and leaves manifest dir clean", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const manifestDir = path.join(dir, "integration");
  const bundle = writePlatformBundle(sourceRoot, "linux", {
    fixtureOnly: true,
  });
  const result = runImporter(["--source", bundle.bundleDir, "--manifest-dir", manifestDir]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime summary verification failed/);
  assert.deepEqual(listEvidenceDirs(manifestDir), []);
});

test("importer rejects prefix-like non-directory children", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "returned");
  const manifestDir = path.join(dir, "integration");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "runtime-smoke-evidence-macos-not-a-dir"), "nope");

  const result = runImporter(["--source", sourceRoot, "--manifest-dir", manifestDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime evidence bundle must be a directory/);
  assert.deepEqual(listEvidenceDirs(manifestDir), []);
});

test("importer rejects child directory and manifest filename platform mismatches", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "returned");
  const tempRoot = path.join(dir, "temp");
  const manifestDir = path.join(dir, "integration");
  const linux = writePlatformBundle(tempRoot, "linux");
  const mismatched = path.join(sourceRoot, "runtime-smoke-evidence-macos-2026-06-25T18-00-00-000Z");
  fs.mkdirSync(mismatched, { recursive: true });
  fs.copyFileSync(linux.manifestPath, path.join(mismatched, "runtime-smoke-set.linux.manifest.json"));

  const result = runImporter(["--source", sourceRoot, "--manifest-dir", manifestDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /directory platform and manifest filename must match/);
  assert.deepEqual(listEvidenceDirs(manifestDir), []);
});

test("importer rejects manifest paths that escape the source bundle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const manifestDir = path.join(dir, "integration");
  const bundle = writePlatformBundle(sourceRoot, "macos", {
    manifestOverrides: {
      summarySetDir: "..",
    },
  });
  const result = runImporter(["--source", bundle.bundleDir, "--manifest-dir", manifestDir]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /path must stay inside the runtime evidence bundle/);
  assert.deepEqual(listEvidenceDirs(manifestDir), []);
});

test("importer rejects source directories with multiple direct manifests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const manifestDir = path.join(dir, "integration");
  fs.mkdirSync(sourceRoot, { recursive: true });
  writePlatformBundle(sourceRoot, "macos", {
    bundleName: "macos-child",
  });
  writePlatformBundle(sourceRoot, "linux", {
    bundleName: "linux-child",
  });
  fs.copyFileSync(
    path.join(sourceRoot, "macos-child", "runtime-smoke-set.macos.manifest.json"),
    path.join(sourceRoot, "runtime-smoke-set.macos.manifest.json")
  );
  fs.copyFileSync(
    path.join(sourceRoot, "linux-child", "runtime-smoke-set.linux.manifest.json"),
    path.join(sourceRoot, "runtime-smoke-set.linux.manifest.json")
  );

  const result = runImporter(["--source", sourceRoot, "--manifest-dir", manifestDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one direct runtime-smoke-set/);
  assert.deepEqual(listEvidenceDirs(manifestDir), []);
});

test("importer rejects sensitive payload keys in manifests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const manifestDir = path.join(dir, "integration");
  const bundle = writePlatformBundle(sourceRoot, "macos", {
    manifestOverrides: {
      accessToken: "redacted-but-still-forbidden",
    },
  });
  const result = runImporter(["--source", bundle.bundleDir, "--manifest-dir", manifestDir]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest must not include secret payload key accessToken/);
  assert.deepEqual(listEvidenceDirs(manifestDir), []);
});

test("importer rejects manifests without a parseable collectedAt timestamp", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-smoke-import-"));
  const sourceRoot = path.join(dir, "source");
  const manifestDir = path.join(dir, "integration");
  const bundle = writePlatformBundle(sourceRoot, "linux", {
    manifestOverrides: {
      collectedAt: "not-a-date",
    },
  });
  const result = runImporter(["--source", bundle.bundleDir, "--manifest-dir", manifestDir]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest missing valid collectedAt timestamp/);
  assert.deepEqual(listEvidenceDirs(manifestDir), []);
});

test("importer source validates strict summaries and does not run Tauri", () => {
  for (const snippet of [
    "TYPEFREE_RUNTIME_SMOKE_IMPORT_RESULT",
    "verify-runtime-smoke-summaries.js",
    "--require-cloud-microphone",
    "discoverChildBundleManifests",
    "copyWhitelistedBundleFiles",
    "preflightImportEntries",
    "collectedAt",
    "resolveRelativeBundlePath",
    "assertManifestHasNoSensitivePayload",
    "destination already exists",
  ]) {
    assert.equal(importerSource.includes(snippet), true, `importer source must include ${snippet}`);
  }
  assert.doesNotMatch(importerSource, /run-tauri-dev-smoke|tauri dev|VITE_TYPEFREE|fetch\(|get_credential/);
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

console.log(`runtime smoke evidence importer tests passed (${tests.length})`);
