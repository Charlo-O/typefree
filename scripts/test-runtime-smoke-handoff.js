#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const handoffScript = path.join(repoRoot, "scripts/generate-runtime-smoke-handoff.js");
const handoffSource = fs.readFileSync(handoffScript, "utf8");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function runHandoff(args) {
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

  return spawnSync(process.execPath, [handoffScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

function extractSentinel(stdout) {
  const match = stdout.match(/^TYPEFREE_RUNTIME_SMOKE_HANDOFF\s+(.+)$/m);
  assert.ok(match, stdout);
  return JSON.parse(match[1]);
}

test("handoff generator is exposed and part of lightweight frontend verification", () => {
  assert.equal(
    packageJson.scripts["handoff:runtime-smoke-evidence"],
    "node scripts/generate-runtime-smoke-handoff.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-handoff"],
    "node scripts/test-runtime-smoke-handoff.js"
  );
  assert.equal(
    packageJson.scripts["verify:runtime-smoke-handoff-bundle"],
    "node scripts/verify-runtime-smoke-handoff-bundle.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-handoff-bundle"],
    "node scripts/test-runtime-smoke-handoff-bundle.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-handoff/);
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-handoff-bundle/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run handoff:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run verify:runtime-smoke-handoff-bundle/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run handoff:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run verify:runtime-smoke-handoff-bundle/);
});

test("handoff defaults to all platforms and preserves strict final readiness", () => {
  const result = runHandoff([
    "--cloud-provider",
    "volcengine",
    "--cloud-model",
    "seedasr",
    "--cloud-language",
    "zh",
    "--cloud-smoke-ms",
    "6500",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const handoff = extractSentinel(result.stdout);

  assert.deepEqual(
    handoff.platforms.map((item) => item.platform),
    ["windows", "macos", "linux"]
  );
  for (const platform of ["windows", "macos", "linux"]) {
    assert.match(result.stdout, new RegExp(`--platform ${platform}`));
    assert.match(result.stdout, /collect:runtime-smoke-evidence/);
    assert.match(result.stdout, /--cloud-provider volcengine/);
    assert.match(result.stdout, /--cloud-model seedasr/);
    assert.match(result.stdout, /--cloud-language zh/);
    assert.match(result.stdout, /--cloud-smoke-ms 6500/);
  }
  assert.match(result.stdout, /verify:goal-readiness/);
  assert.match(result.stdout, /--manifest-dir \.codex-run-logs/);
  assert.match(result.stdout, /--require-cloud-microphone/);
  assert.doesNotMatch(result.stdout, /cloud-speech-fixture|allow-missing-cloud/);
});

test("handoff can target a single platform in json form", () => {
  const result = runHandoff([
    "--platform",
    "macos",
    "--cloud-provider",
    "volcengine",
    "--format",
    "json",
    "--manifest-dir",
    "incoming-evidence",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const handoff = extractSentinel(result.stdout);

  assert.deepEqual(
    handoff.platforms.map((item) => item.platform),
    ["macos"]
  );
  assert.equal(handoff.finalReadinessCommand, "npm run verify:goal-readiness -- --manifest-dir incoming-evidence");
  assert.match(handoff.platforms[0].collectCommand, /--platform macos/);
  assert.doesNotMatch(handoff.platforms[0].collectCommand, /--platform windows|--platform linux/);
});

test("handoff accepts positional provider values from npm forwarding", () => {
  const result = runHandoff(["volcengine", "seedasr", "zh", "6500"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const handoff = extractSentinel(result.stdout);

  assert.deepEqual(
    handoff.platforms.map((item) => item.platform),
    ["windows", "macos", "linux"]
  );
  for (const item of handoff.platforms) {
    assert.match(item.collectCommand, /--cloud-provider volcengine/);
    assert.match(item.collectCommand, /--cloud-model seedasr/);
    assert.match(item.collectCommand, /--cloud-language zh/);
    assert.match(item.collectCommand, /--cloud-smoke-ms 6500/);
  }
});

test("handoff accepts positional platform and output values from npm forwarding", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-handoff-"));
  const output = path.join(dir, "handoff.md");
  const result = runHandoff(["volcengine", "seedasr", "zh", "6500", "macos linux", output]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const handoff = extractSentinel(result.stdout);
  assert.deepEqual(
    handoff.platforms.map((item) => item.platform),
    ["macos", "linux"]
  );
  assert.equal(fs.existsSync(output), true);
  const content = fs.readFileSync(output, "utf8");
  assert.match(content, /--platform macos/);
  assert.match(content, /--platform linux/);
  assert.doesNotMatch(content, /--platform windows/);
});

test("handoff can write a transferable markdown file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-handoff-"));
  const output = path.join(dir, "handoff.md");
  const result = runHandoff([
    "--platform",
    "macos,linux",
    "--cloud-provider",
    "volcengine",
    "--cloud-model",
    "seedasr",
    "--cloud-language",
    "zh",
    "--cloud-smoke-ms",
    "6500",
    "--output",
    output,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /handoff written:/);
  assert.doesNotMatch(result.stdout, /^# Runtime Smoke Evidence Handoff/m);

  const content = fs.readFileSync(output, "utf8");
  assert.match(content, /^# Runtime Smoke Evidence Handoff/m);
  assert.match(content, /--platform macos/);
  assert.match(content, /--platform linux/);
  assert.doesNotMatch(content, /--platform windows/);
  assert.match(content, /verify:goal-readiness/);
  assert.match(content, /--require-cloud-microphone/);
});

test("handoff can write a transferable json file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-handoff-"));
  const output = path.join(dir, "handoff.json");
  const result = runHandoff([
    "--platform",
    "linux",
    "--cloud-provider",
    "volcengine",
    "--format",
    "json",
    "--output",
    output,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const handoff = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(
    handoff.platforms.map((item) => item.platform),
    ["linux"]
  );
  assert.match(handoff.platforms[0].collectCommand, /collect:runtime-smoke-evidence/);
  assert.match(handoff.strictRequirement, /--require-cloud-microphone/);
});

test("handoff can write a transferable command bundle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-handoff-bundle-"));
  const bundleDir = path.join(dir, "handoff-bundle");
  const result = runHandoff([
    "--platform",
    "macos,linux",
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
  assert.match(result.stdout, /handoff bundle written:/);
  assert.doesNotMatch(result.stdout, /^# Runtime Smoke Evidence Handoff/m);

  const handoff = extractSentinel(result.stdout);
  assert.equal(handoff.bundleDir, bundleDir);
  assert.deepEqual(
    handoff.platforms.map((item) => item.platform),
    ["macos", "linux"]
  );

  for (const relativePath of [
    "import-returned-evidence.ps1",
    "import-returned-evidence.sh",
    "runtime-smoke-handoff.md",
    "runtime-smoke-handoff.json",
    "runtime-smoke-handoff.manifest.json",
    "collect-macos.sh",
    "collect-linux.sh",
    "verify-goal-readiness.ps1",
    "verify-goal-readiness.sh",
  ]) {
    assert.equal(fs.existsSync(path.join(bundleDir, relativePath)), true, `${relativePath} must exist`);
  }

  const macosCommand = fs.readFileSync(path.join(bundleDir, "collect-macos.sh"), "utf8");
  const linuxCommand = fs.readFileSync(path.join(bundleDir, "collect-linux.sh"), "utf8");
  const importPowershell = fs.readFileSync(path.join(bundleDir, "import-returned-evidence.ps1"), "utf8");
  const importShell = fs.readFileSync(path.join(bundleDir, "import-returned-evidence.sh"), "utf8");
  const verifyCommand = fs.readFileSync(path.join(bundleDir, "verify-goal-readiness.sh"), "utf8");
  assert.match(macosCommand, /collect:runtime-smoke-evidence -- --platform macos/);
  assert.match(linuxCommand, /collect:runtime-smoke-evidence -- --platform linux/);
  assert.match(importPowershell, /node scripts\/import-runtime-smoke-evidence\.js --source \$args\[0\] --manifest-dir \.codex-run-logs/);
  assert.match(importShell, /node scripts\/import-runtime-smoke-evidence\.js --source "\$1" --manifest-dir \.codex-run-logs/);
  assert.match(verifyCommand, /verify:goal-readiness -- --manifest-dir \.codex-run-logs/);
  assert.equal(fs.existsSync(path.join(bundleDir, "collect-windows.ps1")), false);

  const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "runtime-smoke-handoff.manifest.json"), "utf8"));
  assert.equal(manifest.kind, "typefree-runtime-smoke-handoff-bundle");
  assert.equal(manifest.schemaVersion, 3);
  assert.deepEqual(manifest.platforms, ["macos", "linux"]);
  assert.equal(manifest.files.importPowershell, "import-returned-evidence.ps1");
  assert.equal(manifest.files.importShell, "import-returned-evidence.sh");
  assert.equal(manifest.files.platformCommands.macos, "collect-macos.sh");
  assert.equal(manifest.files.platformCommands.linux, "collect-linux.sh");
});

test("handoff accepts positional bundle dir values from npm forwarding", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-handoff-"));
  const bundleDir = path.join(dir, "handoff-bundle");
  const result = runHandoff(["volcengine", "seedasr", "zh", "6500", "macos linux", bundleDir]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const handoff = extractSentinel(result.stdout);
  assert.equal(handoff.bundleDir, bundleDir);
  assert.equal(handoff.manifestDir, ".codex-run-logs");
  assert.equal(fs.existsSync(path.join(bundleDir, "runtime-smoke-handoff.md")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "runtime-smoke-handoff.manifest.json")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "collect-macos.sh")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "collect-linux.sh")), true);
});

test("handoff fails closed without an explicit provider", () => {
  const result = runHandoff(["--platform", "linux"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing --cloud-provider/);
});

test("handoff source stays a pure command generator", () => {
  for (const snippet of [
    "TYPEFREE_RUNTIME_SMOKE_HANDOFF",
    "collect:runtime-smoke-evidence",
    "verify:goal-readiness",
    "--require-cloud-microphone",
    "--bundle-dir <dir>",
    "writeBundle",
    "bundleRelativePath",
    "runtime-smoke-handoff.manifest.json",
    "typefree-runtime-smoke-handoff-bundle",
    "handoff bundle written:",
    "writeOutput",
    "handoff written:",
    "looksLikeBundleDir",
    "Import each produced runtime-smoke-evidence",
    "import:runtime-smoke-evidence",
    "importCommandFileContent",
    "quotePowerShellArg",
    "quoteShArg",
    "import-returned-evidence.ps1",
    "import-returned-evidence.sh",
  ]) {
    assert.equal(handoffSource.includes(snippet), true, `handoff source must include ${snippet}`);
  }
  assert.doesNotMatch(
    handoffSource,
    /node:child_process|spawnSync|execSync|execFile|exec\(|run-tauri-dev-smoke|tauri dev|fetch\(|get_credential|API_KEY|ACCESS_TOKEN|cloud-speech-fixture|allow-missing-cloud/
  );
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

console.log(`runtime smoke handoff tests passed (${tests.length})`);
