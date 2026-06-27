#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const generatorScript = path.join(repoRoot, "scripts/generate-runtime-smoke-handoff.js");
const verifierScript = path.join(repoRoot, "scripts/verify-runtime-smoke-handoff-bundle.js");
const generatorSource = fs.readFileSync(generatorScript, "utf8");
const verifierSource = fs.readFileSync(verifierScript, "utf8");

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

function scrubbedEnv() {
  const env = { ...process.env };
  for (const name of [
    "TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_PROVIDER",
    "TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MODEL",
    "TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_LANGUAGE",
    "TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MS",
    "TYPEFREE_RUNTIME_SMOKE_HANDOFF_FORMAT",
    "TYPEFREE_RUNTIME_SMOKE_HANDOFF_BUNDLE_DIR",
    "TYPEFREE_RUNTIME_SMOKE_HANDOFF_OUTPUT",
    "TYPEFREE_RUNTIME_SMOKE_MANIFEST_DIR",
    "npm_config_cloud_provider",
    "npm_config_cloud_model",
    "npm_config_cloud_language",
    "npm_config_cloud_smoke_ms",
  ]) {
    delete env[name];
  }
  return env;
}

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: scrubbedEnv(),
  });
}

function runVerifier(args) {
  return runNode(verifierScript, args);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function powershellCommandFileContent(command) {
  return [
    "Set-StrictMode -Version Latest",
    "$ErrorActionPreference = 'Stop'",
    ...powershellRepoRootPrelude(),
    command,
    "",
  ].join("\n");
}

function shellCommandFileContent(command) {
  return ["#!/usr/bin/env sh", "set -eu", ...shellRepoRootPrelude(), command, ""].join("\n");
}

function powershellRepoRootPrelude() {
  return [
    "function Test-TypeFreeRepoRoot([string]$Path) {",
    "  return $Path -and (Test-Path -LiteralPath (Join-Path $Path 'package.json')) -and (Test-Path -LiteralPath (Join-Path $Path 'scripts/import-runtime-smoke-evidence.js')) -and (Test-Path -LiteralPath (Join-Path $Path 'scripts/verify-goal-readiness.js'))",
    "}",
    "function Find-TypeFreeRepoRoot([string]$StartPath) {",
    "  $candidate = $StartPath",
    "  while ($candidate) {",
    "    if (Test-TypeFreeRepoRoot $candidate) { return $candidate }",
    "    $parent = Split-Path -Parent $candidate",
    "    if (-not $parent -or $parent -eq $candidate) { break }",
    "    $candidate = $parent",
    "  }",
    "  return $null",
    "}",
    "$scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }",
    "$repoRoot = Find-TypeFreeRepoRoot (Get-Location).Path",
    "if (-not $repoRoot) { $repoRoot = Find-TypeFreeRepoRoot (Split-Path -Parent $scriptPath) }",
    "if (-not $repoRoot) { throw 'Unable to locate TypeFree repo root from the current directory or handoff script path.' }",
    "Set-Location -LiteralPath $repoRoot",
  ];
}

function shellRepoRootPrelude() {
  return [
    "is_typefree_repo_root() {",
    '  [ -f "$1/package.json" ] && [ -f "$1/scripts/import-runtime-smoke-evidence.js" ] && [ -f "$1/scripts/verify-goal-readiness.js" ]',
    "}",
    "find_typefree_repo_root() {",
    '  candidate="$1"',
    '  while [ -n "$candidate" ]; do',
    '    if is_typefree_repo_root "$candidate"; then',
    '      printf "%s\\n" "$candidate"',
    "      return 0",
    "    fi",
    '    parent=$(dirname "$candidate")',
    '    if [ "$parent" = "$candidate" ]; then',
    "      break",
    "    fi",
    '    candidate="$parent"',
    "  done",
    "  return 1",
    "}",
    'script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)',
    'repo_root=$(find_typefree_repo_root "$(pwd -P)" || true)',
    'if [ -z "$repo_root" ]; then',
    '  repo_root=$(find_typefree_repo_root "$script_dir" || true)',
    "fi",
    'if [ -z "$repo_root" ]; then',
    '  echo "Unable to locate TypeFree repo root from the current directory or handoff script path." >&2',
    "  exit 2",
    "fi",
    'cd "$repo_root"',
  ];
}

function commandFileName(platform) {
  return platform === "windows" ? "collect-windows.ps1" : `collect-${platform}.sh`;
}

function commandShell(platform) {
  return platform === "windows" ? "powershell" : "sh";
}

function commandFileContent(command, shell) {
  return shell === "powershell"
    ? powershellCommandFileContent(command)
    : shellCommandFileContent(command);
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

function writeRuntimeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function writePlatformEvidenceBundle(root, platform) {
  const bundleDir = path.join(root, `runtime-smoke-evidence-${platform}-2026-06-25T18-00-00-000Z`);
  fs.mkdirSync(bundleDir, { recursive: true });
  const nodePlatform = platformNodeValues[platform];
  const backend = platformBackends[platform];

  writeRuntimeJson(
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
  );
  writeRuntimeJson(
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
  );
  writeRuntimeJson(
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
  );
  writeRuntimeJson(
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
  );
  writeRuntimeJson(
    path.join(bundleDir, "cloud-transcription.summary.json"),
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
      ])
    )
  );

  const manifest = {
    collectedAt: "2026-06-25T18:00:00.000Z",
    goalReadinessArgs: summaryKinds.flatMap((kind) => [
      `--${platform}-${kind}`,
      `${kind}.summary.json`,
    ]),
    platform,
    summaries: Object.fromEntries(summaryKinds.map((kind) => [kind, `${kind}.summary.json`])),
    summarySetDir: ".",
    verifyCommand: "node scripts/verify-runtime-smoke-summaries.js --require-cloud-microphone",
  };
  writeRuntimeJson(path.join(bundleDir, `runtime-smoke-set.${platform}.manifest.json`), manifest);
  return bundleDir;
}

function runImportHelper(bundleDir, sourceDir, cwd = repoRoot) {
  if (process.platform === "win32") {
    return spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(bundleDir, "import-returned-evidence.ps1"),
        sourceDir,
      ],
      {
        cwd,
        encoding: "utf8",
        env: scrubbedEnv(),
      }
    );
  }

  return spawnSync("sh", [path.join(bundleDir, "import-returned-evidence.sh"), sourceDir], {
    cwd,
    encoding: "utf8",
    env: scrubbedEnv(),
  });
}

function generateBundle(platforms = "macos,linux") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-handoff-bundle-"));
  const bundleDir = path.join(dir, "handoff-bundle");
  const result = runNode(generatorScript, [
    "--platform",
    platforms,
    "--cloud-provider",
    "volcengine",
    "--cloud-model",
    "seedasr",
    "--cloud-language",
    "zh",
    "--cloud-smoke-ms",
    "6500",
    "--bundle-dir",
    bundleDir,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return bundleDir;
}

function generateBundleWithArgs(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-handoff-bundle-"));
  const bundleDir = path.join(dir, "handoff-bundle");
  return generateBundleAt(bundleDir, args);
}

function generateBundleAt(bundleDir, args = []) {
  const result = runNode(generatorScript, [...args, "--bundle-dir", bundleDir]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return bundleDir;
}

function extractVerifierSentinel(stdout) {
  const match = stdout.match(/^TYPEFREE_RUNTIME_SMOKE_HANDOFF_BUNDLE_VERIFY\s+(.+)$/m);
  assert.ok(match, stdout);
  return JSON.parse(match[1]);
}

function mutateCollectCommand(bundleDir, platform, transform) {
  const handoffPath = path.join(bundleDir, "runtime-smoke-handoff.json");
  const handoff = readJson(handoffPath);
  const item = handoff.platforms.find((candidate) => candidate.platform === platform);
  assert.ok(item, `missing platform ${platform}`);
  item.collectCommand = transform(item.collectCommand);
  writeJson(handoffPath, handoff);
  fs.writeFileSync(
    path.join(bundleDir, commandFileName(platform)),
    commandFileContent(item.collectCommand, commandShell(platform))
  );
}

function mutateFinalCommand(bundleDir, command) {
  const handoffPath = path.join(bundleDir, "runtime-smoke-handoff.json");
  const handoff = readJson(handoffPath);
  handoff.finalReadinessCommand = command;
  writeJson(handoffPath, handoff);
  fs.writeFileSync(
    path.join(bundleDir, "verify-goal-readiness.ps1"),
    powershellCommandFileContent(command)
  );
  fs.writeFileSync(
    path.join(bundleDir, "verify-goal-readiness.sh"),
    shellCommandFileContent(command)
  );
}

function mutateImportHelper(bundleDir, fileName, content) {
  fs.writeFileSync(path.join(bundleDir, fileName), content);
}

test("handoff bundle verifier is exposed and lightweight", () => {
  assert.equal(
    packageJson.scripts["verify:runtime-smoke-handoff-bundle"],
    "node scripts/verify-runtime-smoke-handoff-bundle.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-handoff-bundle"],
    "node scripts/test-runtime-smoke-handoff-bundle.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-handoff-bundle/);
  assert.doesNotMatch(
    packageJson.scripts["verify:frontend"],
    /npm run verify:runtime-smoke-handoff-bundle/
  );
  assert.doesNotMatch(
    packageJson.scripts["verify:tauri"],
    /npm run verify:runtime-smoke-handoff-bundle/
  );
});

test("verifier accepts a generated macos/linux command bundle", () => {
  const bundleDir = generateBundle();
  const result = runVerifier(["--bundle-dir", bundleDir]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /runtime smoke handoff bundle passed \(macos, linux\)/);
  const sentinel = extractVerifierSentinel(result.stdout);
  assert.equal(sentinel.bundleDir, bundleDir);
  assert.deepEqual(sentinel.platforms, ["macos", "linux"]);

  const manifestPath = path.join(bundleDir, "runtime-smoke-handoff.manifest.json");
  assert.equal(fs.existsSync(manifestPath), true);
  const manifest = readJson(manifestPath);
  assert.equal(manifest.kind, "typefree-runtime-smoke-handoff-bundle");
  assert.equal(manifest.schemaVersion, 3);
  assert.deepEqual(manifest.platforms, ["macos", "linux"]);
  for (const value of [
    manifest.files.importPowershell,
    manifest.files.importShell,
    manifest.files.markdown,
    manifest.files.json,
    manifest.files.manifest,
    manifest.files.verifyPowershell,
    manifest.files.verifyShell,
    ...Object.values(manifest.files.platformCommands),
  ]) {
    assert.equal(path.isAbsolute(value), false, `${value} must be relative`);
    assert.doesNotMatch(value, /\.\./);
  }

  const positionalResult = runVerifier([bundleDir]);
  assert.equal(positionalResult.status, 0, positionalResult.stderr || positionalResult.stdout);
});

test("verifier rejects markdown that omits import helper entrypoints", () => {
  const bundleDir = generateBundle("linux");
  const markdownPath = path.join(bundleDir, "runtime-smoke-handoff.md");
  const markdown = fs
    .readFileSync(markdownPath, "utf8")
    .replace(/import-returned-evidence\.ps1/g, "manual-import.ps1")
    .replace(/import-returned-evidence\.sh/g, "manual-import.sh");
  fs.writeFileSync(markdownPath, markdown);

  const result = runVerifier(["--bundle-dir", bundleDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /handoff markdown/);
});

test("verifier accepts shell-specific quoting for special handoff values", () => {
  const manifestDir = "incoming $HOME 'space'";
  const provider = "volc$engine 'x'";
  const bundleDir = generateBundleWithArgs([
    "--platform",
    "windows,macos",
    "--cloud-provider",
    provider,
    "--manifest-dir",
    manifestDir,
  ]);

  const result = runVerifier(["--bundle-dir", bundleDir]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const windowsCollect = fs.readFileSync(path.join(bundleDir, "collect-windows.ps1"), "utf8");
  const macosCollect = fs.readFileSync(path.join(bundleDir, "collect-macos.sh"), "utf8");
  const importPowershell = fs.readFileSync(
    path.join(bundleDir, "import-returned-evidence.ps1"),
    "utf8"
  );
  const importShell = fs.readFileSync(path.join(bundleDir, "import-returned-evidence.sh"), "utf8");
  const verifyPowershell = fs.readFileSync(
    path.join(bundleDir, "verify-goal-readiness.ps1"),
    "utf8"
  );
  const verifyShell = fs.readFileSync(path.join(bundleDir, "verify-goal-readiness.sh"), "utf8");

  assert.match(windowsCollect, /--cloud-provider 'volc\$engine ''x'''/);
  assert.match(macosCollect, /--cloud-provider 'volc\$engine '"'"'x'"'"''/);
  assert.match(importPowershell, /--manifest-dir 'incoming \$HOME ''space'''/);
  assert.match(importShell, /--manifest-dir 'incoming \$HOME '"'"'space'"'"''/);
  assert.match(verifyPowershell, /--manifest-dir 'incoming \$HOME ''space'''/);
  assert.match(verifyShell, /--manifest-dir 'incoming \$HOME '"'"'space'"'"''/);
});

test("generated scripts locate repo root from cwd before script path", () => {
  const bundleDir = generateBundle("windows,macos");
  const windowsCollect = fs.readFileSync(path.join(bundleDir, "collect-windows.ps1"), "utf8");
  const macosCollect = fs.readFileSync(path.join(bundleDir, "collect-macos.sh"), "utf8");
  const importPowershell = fs.readFileSync(
    path.join(bundleDir, "import-returned-evidence.ps1"),
    "utf8"
  );
  const importShell = fs.readFileSync(path.join(bundleDir, "import-returned-evidence.sh"), "utf8");

  for (const content of [windowsCollect, importPowershell]) {
    assert.match(content, /Find-TypeFreeRepoRoot \(Get-Location\)\.Path/);
    assert.match(content, /Find-TypeFreeRepoRoot \(Split-Path -Parent \$scriptPath\)/);
    assert.match(
      content,
      /Unable to locate TypeFree repo root from the current directory or handoff script path/
    );
  }
  for (const content of [macosCollect, importShell]) {
    assert.match(content, /repo_root=\$\(find_typefree_repo_root "\$\(pwd -P\)" \|\| true\)/);
    assert.match(content, /repo_root=\$\(find_typefree_repo_root "\$script_dir" \|\| true\)/);
    assert.match(
      content,
      /Unable to locate TypeFree repo root from the current directory or handoff script path/
    );
  }
});

test("generated import helper can import returned bundles into the readiness manifest directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-handoff-helper-"));
  const repoRunLogsDir = path.join(repoRoot, ".codex-run-logs");
  fs.mkdirSync(repoRunLogsDir, { recursive: true });
  const repoTempRoot = fs.mkdtempSync(path.join(repoRunLogsDir, "test-handoff-helper-"));
  const returnedRoot = path.join(dir, "returned bundles");
  const manifestDir = path.join(dir, "integration $HOME space");
  try {
    for (const platform of ["windows", "macos", "linux"]) {
      writePlatformEvidenceBundle(returnedRoot, platform);
    }
    const bundleDir = generateBundleAt(path.join(repoTempRoot, "handoff-bundle"), [
      "--platform",
      "windows,macos,linux",
      "--cloud-provider",
      "volcengine",
      "--manifest-dir",
      manifestDir,
    ]);

    const importResult = runImportHelper(bundleDir, returnedRoot, bundleDir);
    assert.equal(importResult.status, 0, importResult.stderr || importResult.stdout);
    assert.match(importResult.stdout, /runtime smoke evidence imported \(windows, macos, linux\)/);
    for (const platform of ["windows", "macos", "linux"]) {
      assert.equal(
        fs.existsSync(
          path.join(
            manifestDir,
            `runtime-smoke-evidence-${platform}-2026-06-25T18-00-00-000Z`,
            `runtime-smoke-set.${platform}.manifest.json`
          )
        ),
        true,
        `${platform} manifest must be imported`
      );
    }
  } finally {
    fs.rmSync(repoTempRoot, { force: true, recursive: true });
  }
});

test("verifier rejects a missing bundle manifest", () => {
  const bundleDir = generateBundle();
  fs.unlinkSync(path.join(bundleDir, "runtime-smoke-handoff.manifest.json"));
  const result = runVerifier(["--bundle-dir", bundleDir]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /handoff bundle manifest/);
});

test("verifier rejects manifest paths that escape the bundle", () => {
  const bundleDir = generateBundle();
  const manifestPath = path.join(bundleDir, "runtime-smoke-handoff.manifest.json");
  const manifest = readJson(manifestPath);
  manifest.files.markdown = "../runtime-smoke-handoff.md";
  writeJson(manifestPath, manifest);

  const result = runVerifier(["--bundle-dir", bundleDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /path must stay inside the handoff bundle/);
});

test("verifier rejects unexpected executable scripts", () => {
  const bundleDir = generateBundle("macos");
  fs.writeFileSync(path.join(bundleDir, "collect-linux.sh"), "#!/usr/bin/env sh\nset -eu\n");

  const result = runVerifier(["--bundle-dir", bundleDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected script collect-linux\.sh/);
});

test("verifier rejects fixture shortcuts even when json and script agree", () => {
  const bundleDir = generateBundle("macos");
  mutateCollectCommand(bundleDir, "macos", (command) => `${command} --cloud-speech-fixture`);

  const result = runVerifier(["--bundle-dir", bundleDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden snippet cloud-speech-fixture|command file content/);
});

test("verifier rejects secret payload keys in bundle json", () => {
  const bundleDir = generateBundle("linux");
  const manifestPath = path.join(bundleDir, "runtime-smoke-handoff.manifest.json");
  const manifest = readJson(manifestPath);
  manifest.accessToken = "redacted-but-still-forbidden";
  writeJson(manifestPath, manifest);

  const result = runVerifier(["--bundle-dir", bundleDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden secret key accessToken/);
});

test("verifier rejects final commands that skip the goal readiness gate", () => {
  const bundleDir = generateBundle("linux");
  mutateFinalCommand(
    bundleDir,
    "npm run verify:runtime-smoke-summaries -- --manifest-dir .codex-run-logs"
  );

  const result = runVerifier(["--bundle-dir", bundleDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /finalReadinessCommand/);
});

test("verifier rejects import helpers that skip the importer", () => {
  const bundleDir = generateBundle("linux");
  mutateImportHelper(
    bundleDir,
    "import-returned-evidence.sh",
    shellCommandFileContent("npm run verify:goal-readiness -- --manifest-dir .codex-run-logs")
  );

  const result = runVerifier(["--bundle-dir", bundleDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /import-returned-evidence\.sh/);
});

test("verifier rejects bundles without the strict microphone requirement", () => {
  const bundleDir = generateBundle("linux");
  const handoffPath = path.join(bundleDir, "runtime-smoke-handoff.json");
  const handoff = readJson(handoffPath);
  handoff.strictRequirement = "The final gate delegates to the summary verifier.";
  writeJson(handoffPath, handoff);

  const result = runVerifier(["--bundle-dir", bundleDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /strictRequirement/);
});

test("handoff generator and verifier sources stay pure", () => {
  for (const snippet of [
    "runtime-smoke-handoff.manifest.json",
    "bundleRelativePath",
    "schemaVersion",
    "schemaVersion: 3",
    "typefree-runtime-smoke-handoff-bundle",
    "importCommandFileContent",
    "quotePowerShellArg",
    "quoteShArg",
    "import-returned-evidence.ps1",
    "import-returned-evidence.sh",
    "Find-TypeFreeRepoRoot",
    "find_typefree_repo_root",
    "Unable to locate TypeFree repo root",
  ]) {
    assert.equal(
      generatorSource.includes(snippet),
      true,
      `generator source must include ${snippet}`
    );
  }
  for (const snippet of [
    "TYPEFREE_RUNTIME_SMOKE_HANDOFF_BUNDLE_VERIFY",
    "assertNoUnexpectedScripts",
    "assertJsonHasNoSensitivePayload",
    "importCommandFileContent",
    "path must stay inside the handoff bundle",
    "Find-TypeFreeRepoRoot",
    "find_typefree_repo_root",
    "Unable to locate TypeFree repo root",
    '["cloud", "speech", "fixture"].join("-")',
    '["allow", "missing", "cloud"].join("-")',
  ]) {
    assert.equal(verifierSource.includes(snippet), true, `verifier source must include ${snippet}`);
  }
  for (const source of [generatorSource, verifierSource]) {
    assert.doesNotMatch(
      source,
      /node:child_process|spawnSync|execSync|execFile|exec\(|run-tauri-dev-smoke|tauri dev|fetch\(|get_credential|API_KEY|ACCESS_TOKEN/
    );
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

console.log(`runtime smoke handoff bundle tests passed (${tests.length})`);
