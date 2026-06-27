#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const collectorScript = path.join(repoRoot, "scripts/collect-runtime-smoke-evidence.js");
const collectorSource = fs.readFileSync(collectorScript, "utf8");
const runtimeSmokeMatrix = fs.readFileSync(path.join(repoRoot, "docs/runtime-smoke-matrix.md"), "utf8");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function runCollector(args) {
  return spawnSync(process.execPath, [collectorScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function assertIncludes(text, snippet, context) {
  assert.equal(text.includes(snippet), true, `${context} must include ${snippet}`);
}

test("collector is exposed as an explicit external evidence command", () => {
  assert.equal(
    packageJson.scripts["collect:runtime-smoke-evidence"],
    "node scripts/collect-runtime-smoke-evidence.js"
  );
  assert.equal(
    packageJson.scripts["test:runtime-smoke-evidence"],
    "node scripts/test-runtime-smoke-evidence-collector.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run collect:runtime-smoke-evidence/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run collect:runtime-smoke-evidence/);
});

test("collector dry run prints the five smoke commands and strict verifier", () => {
  const result = runCollector([
    "--dry-run",
    "--platform",
    "windows",
    "--cloud-provider",
    "volcengine",
    "--cloud-model",
    "seedasr",
    "--cloud-language",
    "zh",
    "--cloud-smoke-ms",
    "6500",
    "--cloud-speaker-fixture",
    "--timeout-ms",
    "123456",
    "--ready-grace-ms",
    "111",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const flag of [
    "--runtime-probe",
    "--native-recording-smoke",
    "--dictation-pipeline-smoke",
    "--cloud-credential-preflight",
    "--cloud-transcription-smoke",
  ]) {
    assertIncludes(result.stdout, flag, "collector dry-run output");
  }
  for (const snippet of [
    "--cloud-provider volcengine",
    "--cloud-model seedasr",
    "--cloud-language zh",
    "--cloud-smoke-ms 6500",
    "--cloud-speaker-fixture",
    "verify-runtime-smoke-summaries.js",
    "--require-cloud-microphone",
    "--windows-runtime-probe",
    "TYPEFREE_RUNTIME_SMOKE_EVIDENCE_RESULT",
  ]) {
    assertIncludes(result.stdout, snippet, "collector dry-run output");
  }
});

test("collector fails closed without an explicit provider", () => {
  const result = runCollector(["--dry-run", "--platform", "windows"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing --cloud-provider/);
});

test("collector rejects platform mismatches for live runs", () => {
  const platformByNode = {
    darwin: "macos",
    linux: "linux",
    win32: "windows",
  };
  const current = platformByNode[process.platform] || "linux";
  const other = ["windows", "macos", "linux"].find((platform) => platform !== current);
  const result = runCollector(["--platform", other, "--cloud-provider", "volcengine"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Platform mismatch/);
});

test("collector rejects Windows speaker fixtures for non-Windows evidence", () => {
  const result = runCollector([
    "--dry-run",
    "--platform",
    "macos",
    "--cloud-provider",
    "volcengine",
    "--cloud-speaker-fixture",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only valid for Windows/);
});

test("collector source writes a stable evidence bundle without sensitive payloads", () => {
  for (const snippet of [
    "runtime-smoke-evidence-${platform}-${stamp}",
    "runtime-smoke-set.${options.platform}.manifest.json",
    "cleanupUnfinishedEvidenceDir",
    "copyStableSummaries",
    "portableSummaryPaths",
    "sourceSummaries",
    "summarySourcePaths",
    "summarySetDir: \".\"",
    "goalReadinessArgs",
    "TYPEFREE_RUNTIME_SMOKE_EVIDENCE_RESULT",
    "verify-runtime-smoke-summaries.js",
    "--require-cloud-microphone",
    "--cloud-playback-path",
    "--cloud-speaker-fixture",
  ]) {
    assertIncludes(collectorSource, snippet, "collector source");
  }
  assert.doesNotMatch(collectorSource, /getCredential|get_credential|transcriptText|processedText/);
});

test("runtime smoke matrix documents collector handoff", () => {
  for (const snippet of [
    "collect:runtime-smoke-evidence",
    "runtime-smoke-set.<platform>.manifest.json",
    "goalReadinessArgs",
    "--cloud-playback-path",
    "does not run in default verification",
  ]) {
    assertIncludes(runtimeSmokeMatrix, snippet, "runtime smoke matrix");
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

console.log(`runtime smoke evidence collector tests passed (${tests.length})`);
