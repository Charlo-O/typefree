#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const readinessScript = path.join(repoRoot, "scripts/verify-goal-readiness.js");
const readinessSource = fs.readFileSync(readinessScript, "utf8");

const platformNodeValues = {
  windows: "win32",
  macos: "darwin",
  linux: "linux",
};

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

function platformBackend(platform) {
  return {
    linux: "pipewire",
    macos: "coreaudio",
    windows: "windows-wasapi",
  }[platform];
}

function cloudChecks(kind = "microphone") {
  const base = [
    passedCheck("cloud-transcription-provider", {
      provider: "volcengine",
    }),
    passedCheck("cloud-transcription-credentials", {
      missingCredentialKeys: [],
      presentCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
      requiredCredentialKeys: ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"],
    }),
  ];

  if (kind === "fixture") {
    return [
      ...base,
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
  }

  return [
    ...base,
    passedCheck("cloud-transcription-recording-capabilities", {
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
  ];
}

function writePlatformSummaries(dir, platform, options = {}) {
  const nodePlatform = platformNodeValues[platform];
  const backend = platformBackend(platform);
  const prefix = platform;

  return {
    "runtime-probe": writeJson(
      dir,
      `${prefix}-runtime.json`,
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
      dir,
      `${prefix}-native.json`,
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
      dir,
      `${prefix}-pipeline.json`,
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
      `${prefix}-preflight.json`,
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
      `${prefix}-cloud.json`,
      smokeSummary(
        "cloudTranscriptionSmokeResult",
        smokeResult(cloudChecks(options.cloudKind || "microphone"))
      )
    ),
  };
}

function readinessArgs(summarySets) {
  const args = [];
  for (const [platform, summaries] of Object.entries(summarySets)) {
    for (const [kind, filePath] of Object.entries(summaries)) {
      args.push(`--${platform}-${kind}`, filePath);
    }
  }
  return args;
}

function writePlatformManifest(dir, platform, summaries, overrides = {}, manifestDirName = `${platform}-manifest`) {
  const manifestDir = path.join(dir, manifestDirName);
  fs.mkdirSync(manifestDir, { recursive: true });
  const relativeSummaries = {};

  for (const [kind, filePath] of Object.entries(summaries)) {
    const destination = path.join(manifestDir, `${kind}.summary.json`);
    fs.copyFileSync(filePath, destination);
    relativeSummaries[kind] = path.basename(destination);
  }

  const manifestPath = path.join(manifestDir, `runtime-smoke-set.${platform}.manifest.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        platform,
        summaries: relativeSummaries,
        summarySetDir: ".",
        ...overrides,
      },
      null,
      2
    )
  );
  return manifestPath;
}

function readinessManifestArgs(summarySets, overrides = {}) {
  const args = [];
  for (const [platform, summaries] of Object.entries(summarySets)) {
    args.push(
      `--${platform}-manifest`,
      writePlatformManifest(path.dirname(Object.values(summaries)[0]), platform, summaries, overrides[platform])
    );
  }
  return args;
}

function readinessPositionalArgs(summarySets) {
  const args = [];
  for (const platform of Object.keys(platformNodeValues)) {
    if (!summarySets[platform]) {
      continue;
    }
    for (const kind of [
      "runtime-probe",
      "native-recording",
      "dictation-pipeline",
      "cloud-preflight",
      "cloud-transcription",
    ]) {
      args.push(summarySets[platform][kind]);
    }
  }
  return args;
}

function runReadiness(args) {
  return spawnSync(process.execPath, [readinessScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("goal readiness verifier is exposed but external gate is not in default verifies", () => {
  assert.equal(packageJson.scripts["verify:goal-readiness"], "node scripts/verify-goal-readiness.js");
  assert.equal(packageJson.scripts["test:goal-readiness"], "node scripts/test-goal-readiness.js");
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
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:goal-readiness/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-evidence/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-packager/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-importer/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-handoff/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-handoff-bundle/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run verify:goal-readiness/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run verify:goal-readiness/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run collect:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run collect:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run pack:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run pack:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run import:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run import:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run handoff:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run handoff:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run verify:runtime-smoke-handoff-bundle/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run verify:runtime-smoke-handoff-bundle/);
  assert.match(readinessSource, /scripts\/test-goal-coverage\.js/);
  assert.match(readinessSource, /goal coverage contract tests passed \(23\)/);
  assert.match(readinessSource, /test:runtime-smoke-evidence/);
  assert.match(readinessSource, /collect:runtime-smoke-evidence/);
  assert.match(readinessSource, /test:runtime-smoke-packager/);
  assert.match(readinessSource, /pack:runtime-smoke-evidence/);
  assert.match(readinessSource, /test:runtime-smoke-importer/);
  assert.match(readinessSource, /import:runtime-smoke-evidence/);
  assert.match(readinessSource, /test:runtime-smoke-handoff/);
  assert.match(readinessSource, /handoff:runtime-smoke-evidence/);
  assert.match(readinessSource, /test:runtime-smoke-handoff-bundle/);
  assert.match(readinessSource, /verify:runtime-smoke-handoff-bundle/);
  assert.match(readinessSource, /readinessFailureHint/);
  assert.match(readinessSource, /verify:runtime-smoke-handoff-bundle/);
  assert.match(readinessSource, /--bundle-dir/);
  assert.match(readinessSource, /--\$\{platform\}-manifest/);
  assert.match(readinessSource, /manifest-dir/);
  assert.match(readinessSource, /latestManifestForPlatform/);
  assert.match(readinessSource, /manifestSummaries/);
});

test("goal readiness fails closed when external summary evidence is missing", () => {
  const result = runReadiness([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /goal readiness failed/);
  assert.match(result.stderr, /windows: missing --windows-runtime-probe/);
  assert.doesNotMatch(result.stderr, /macos: missing --macos-runtime-probe/);
  assert.doesNotMatch(result.stderr, /linux: missing --linux-runtime-probe/);
  assert.match(result.stderr, /Next evidence step:/);
  assert.match(result.stderr, /Missing platform bundles: windows/);
  assert.match(result.stderr, /npm run handoff:runtime-smoke-evidence/);
  assert.match(result.stderr, /--platform windows/);
  assert.match(result.stderr, /--bundle-dir <handoff-bundle-dir>/);
  assert.match(result.stderr, /npm run verify:runtime-smoke-handoff-bundle -- --bundle-dir <handoff-bundle-dir>/);
  assert.match(result.stderr, /npm run import:runtime-smoke-evidence/);
  assert.match(result.stderr, /--source <runtime-smoke-evidence-platform-dir-or-manifest>/);
  assert.match(result.stderr, /import-returned-evidence\.ps1/);
  assert.match(result.stderr, /import-returned-evidence\.sh/);
});

test("goal readiness positional fallback can report partial external evidence gaps", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const windows = writePlatformSummaries(dir, "windows", {
    cloudKind: "fixture",
  });
  const result = runReadiness(readinessPositionalArgs({ windows }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /windows: runtime summary verification failed/);
  assert.doesNotMatch(result.stderr, /macos: missing --macos-runtime-probe/);
  assert.doesNotMatch(result.stderr, /linux: missing --linux-runtime-probe/);
});

test("goal readiness passes with required Windows evidence and validates optional platforms when present", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const summarySets = Object.fromEntries(
    Object.keys(platformNodeValues).map((platform) => [platform, writePlatformSummaries(dir, platform)])
  );

  const result = runReadiness(readinessArgs(summarySets));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /goal readiness passed for windows live evidence/);

  const positionalResult = runReadiness(readinessPositionalArgs(summarySets));
  assert.equal(positionalResult.status, 0, positionalResult.stderr || positionalResult.stdout);
});

test("goal readiness accepts portable collector manifests for required and optional platforms", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const summarySets = Object.fromEntries(
    Object.keys(platformNodeValues).map((platform) => [platform, writePlatformSummaries(dir, platform)])
  );

  const result = runReadiness(readinessManifestArgs(summarySets));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /goal readiness passed for windows live evidence/);

  const positionalResult = runReadiness(
    Object.keys(platformNodeValues).map((platform) =>
      writePlatformManifest(dir, platform, summarySets[platform])
    )
  );
  assert.equal(positionalResult.status, 0, positionalResult.stderr || positionalResult.stdout);
});

test("goal readiness accepts required Windows manifest without optional platform bundles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const windows = writePlatformSummaries(dir, "windows");
  const result = runReadiness([writePlatformManifest(dir, "windows", windows)]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /windows: missing --windows-runtime-probe/);
  assert.match(result.stdout, /goal readiness passed for windows live evidence/);
});

test("goal readiness discovers portable manifests from a manifest directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const summarySets = Object.fromEntries(
    Object.keys(platformNodeValues).map((platform) => [platform, writePlatformSummaries(dir, platform)])
  );
  for (const platform of Object.keys(platformNodeValues)) {
    writePlatformManifest(
      dir,
      platform,
      summarySets[platform],
      {
        collectedAt: "2026-06-25T18:00:00.000Z",
      },
      `runtime-smoke-evidence-${platform}-2026-06-25T18-00-00-000Z`
    );
  }

  const result = runReadiness(["--manifest-dir", dir]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /goal readiness passed for windows live evidence/);
});

test("goal readiness manifest directory passes with only the required Windows manifest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const windows = writePlatformSummaries(dir, "windows");
  writePlatformManifest(
    dir,
    "windows",
    windows,
    {
      collectedAt: "2026-06-25T18:00:00.000Z",
    },
    "runtime-smoke-evidence-windows-2026-06-25T18-00-00-000Z"
  );

  const result = runReadiness(["--manifest-dir", dir]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /windows: missing --windows-runtime-probe/);
  assert.match(result.stdout, /goal readiness passed for windows live evidence/);
});

test("goal readiness manifest directory chooses the newest platform manifest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const summarySets = Object.fromEntries(
    Object.keys(platformNodeValues).map((platform) => [platform, writePlatformSummaries(dir, platform)])
  );
  const oldDir = path.join(dir, "old");
  fs.mkdirSync(oldDir, { recursive: true });
  const oldWindows = writePlatformSummaries(oldDir, "windows", {
    cloudKind: "fixture",
  });

  writePlatformManifest(
    dir,
    "windows",
    oldWindows,
    {
      collectedAt: "2026-06-25T17:00:00.000Z",
    },
    "runtime-smoke-evidence-windows-2026-06-25T17-00-00-000Z"
  );
  writePlatformManifest(
    dir,
    "windows",
    summarySets.windows,
    {
      collectedAt: "2026-06-25T18:00:00.000Z",
    },
    "runtime-smoke-evidence-windows-2026-06-25T18-00-00-000Z"
  );
  writePlatformManifest(
    dir,
    "macos",
    summarySets.macos,
    {
      collectedAt: "2026-06-25T18:00:00.000Z",
    },
    "runtime-smoke-evidence-macos-2026-06-25T18-00-00-000Z"
  );
  writePlatformManifest(
    dir,
    "linux",
    summarySets.linux,
    {
      collectedAt: "2026-06-25T18:00:00.000Z",
    },
    "runtime-smoke-evidence-linux-2026-06-25T18-00-00-000Z"
  );

  const result = runReadiness(["--manifest-dir", dir]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("goal readiness explicit platform manifest overrides manifest directory discovery", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const summarySets = Object.fromEntries(
    Object.keys(platformNodeValues).map((platform) => [platform, writePlatformSummaries(dir, platform)])
  );
  const badDir = path.join(dir, "bad");
  fs.mkdirSync(badDir, { recursive: true });
  const badWindows = writePlatformSummaries(badDir, "windows", {
    cloudKind: "fixture",
  });
  writePlatformManifest(
    dir,
    "windows",
    badWindows,
    {
      collectedAt: "2026-06-25T19:00:00.000Z",
    },
    "runtime-smoke-evidence-windows-2026-06-25T19-00-00-000Z"
  );
  const explicitWindows = writePlatformManifest(dir, "windows", summarySets.windows);

  for (const platform of ["macos", "linux"]) {
    writePlatformManifest(
      dir,
      platform,
      summarySets[platform],
      {
        collectedAt: "2026-06-25T18:00:00.000Z",
      },
      `runtime-smoke-evidence-${platform}-2026-06-25T18-00-00-000Z`
    );
  }

  const result = runReadiness(["--manifest-dir", dir, "--windows-manifest", explicitWindows]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("goal readiness rejects manifest platform mismatches", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const summarySets = Object.fromEntries(
    Object.keys(platformNodeValues).map((platform) => [platform, writePlatformSummaries(dir, platform)])
  );

  const result = runReadiness(
    readinessManifestArgs(summarySets, {
      macos: {
        platform: "linux",
      },
    })
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /macos: manifest platform mismatch/);
});

test("goal readiness rejects manifests with missing summary keys", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const summarySets = Object.fromEntries(
    Object.keys(platformNodeValues).map((platform) => [platform, writePlatformSummaries(dir, platform)])
  );
  const badSummaries = { ...summarySets.linux };
  delete badSummaries["cloud-transcription"];
  const linuxManifest = writePlatformManifest(dir, "linux", badSummaries);

  const result = runReadiness([
    "--windows-manifest",
    writePlatformManifest(dir, "windows", summarySets.windows),
    "--macos-manifest",
    writePlatformManifest(dir, "macos", summarySets.macos),
    "--linux-manifest",
    linuxManifest,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /linux: manifest summaries\.cloud-transcription/);
});

test("goal readiness rejects manifest paths that escape the evidence bundle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const windows = writePlatformSummaries(dir, "windows");
  const manifest = writePlatformManifest(dir, "windows", windows, {
    summarySetDir: "..",
  });
  const result = runReadiness(["--windows-manifest", manifest]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /path must stay inside the runtime evidence bundle/);
});

test("goal readiness rejects sensitive payload keys in manifests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const windows = writePlatformSummaries(dir, "windows");
  const manifest = writePlatformManifest(dir, "windows", windows, {
    accessToken: "redacted-but-still-forbidden",
  });
  const result = runReadiness(["--windows-manifest", manifest]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest must not include secret payload key accessToken/);
});

test("goal readiness rejects mixing a manifest with explicit summaries for the same platform", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const windows = writePlatformSummaries(dir, "windows");
  const manifest = writePlatformManifest(dir, "windows", windows);
  const result = runReadiness([
    "--windows-manifest",
    manifest,
    "--windows-runtime-probe",
    windows["runtime-probe"],
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be combined/);
});

test("goal readiness rejects speech fixture cloud evidence for completion", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-goal-ready-"));
  const summarySets = Object.fromEntries(
    Object.keys(platformNodeValues).map((platform) => [
      platform,
      writePlatformSummaries(dir, platform, {
        cloudKind: platform === "windows" ? "fixture" : "microphone",
      }),
    ])
  );

  const result = runReadiness(readinessArgs(summarySets));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /windows: runtime summary verification failed/);
  assert.match(result.stderr, /cloud-transcription\.microphone/);
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

console.log(`goal readiness tests passed (${tests.length})`);
