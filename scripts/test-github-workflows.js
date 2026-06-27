#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function extractJob(workflowText, jobName) {
  const lines = workflowText.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing job: ${jobName}`);

  const end = lines.findIndex((line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function assertIncludes(text, expected, context) {
  assert.ok(text.includes(expected), `${context} must include: ${expected}`);
}

function assertOrdered(text, before, after, context) {
  const beforeIndex = text.indexOf(before);
  const afterIndex = text.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${context} missing: ${before}`);
  assert.notEqual(afterIndex, -1, `${context} missing: ${after}`);
  assert.ok(beforeIndex < afterIndex, `${context} expected ${before} before ${after}`);
}

function assertRustPreflightMatrix(workflowText, workflowName, keyPrefixes) {
  const job = extractJob(workflowText, "rust-preflight");
  const context = `${workflowName} rust-preflight`;

  assertIncludes(job, "name: Rust preflight (${{ matrix.target }})", context);
  assertIncludes(job, "runs-on: ${{ matrix.platform }}", context);
  assertIncludes(job, "fail-fast: false", context);

  for (const target of [
    "x86_64-unknown-linux-gnu",
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
  ]) {
    assertIncludes(job, `target: ${target}`, context);
  }

  for (const keyPrefix of keyPrefixes) {
    assertIncludes(job, `key-prefix: ${keyPrefix}`, context);
  }

  assertIncludes(job, "uses: dtolnay/rust-toolchain@stable", context);
  assertIncludes(job, "targets: ${{ matrix.target }}", context);
  assertIncludes(job, "uses: ./.github/actions/cache-tauri-rust", context);
  assertIncludes(job, "key-prefix: ${{ matrix.key-prefix }}", context);
  assertIncludes(job, "if: contains(matrix.platform, 'ubuntu')", context);
  assertIncludes(job, "uses: ./.github/actions/setup-tauri-linux", context);
  assertIncludes(
    job,
    "run: cargo check --manifest-path src-tauri/Cargo.toml --target ${{ matrix.target }}",
    context
  );
  assertIncludes(job, "name: Run Tauri Rust clipboard image tests", context);
  assertIncludes(job, "if: matrix.target == 'x86_64-unknown-linux-gnu'", context);
  assertIncludes(
    job,
    "run: cargo test --manifest-path src-tauri/Cargo.toml clipboard_images --lib",
    context
  );
}

function assertReleaseTagGate(releaseWorkflow) {
  const prepare = extractJob(releaseWorkflow, "prepare-release");
  assertIncludes(prepare, "source_ref: ${{ steps.meta.outputs.source_ref }}", "prepare-release");
  assertIncludes(
    prepare,
    'echo "source_ref=${source_ref}" >> "${GITHUB_OUTPUT}"',
    "prepare-release"
  );

  const frontend = extractJob(releaseWorkflow, "frontend-verify");
  assertIncludes(frontend, "needs: prepare-release", "frontend-verify");
  assertIncludes(
    frontend,
    "ref: ${{ needs.prepare-release.outputs.source_ref }}",
    "frontend-verify"
  );

  const rust = extractJob(releaseWorkflow, "rust-preflight");
  assertIncludes(rust, "needs: prepare-release", "rust-preflight");
  assertIncludes(rust, "ref: ${{ needs.prepare-release.outputs.source_ref }}", "rust-preflight");

  const releaseConfig = extractJob(releaseWorkflow, "release-config-verify");
  assertIncludes(releaseConfig, "needs: prepare-release", "release-config-verify");
  assertIncludes(
    releaseConfig,
    "ref: ${{ needs.prepare-release.outputs.source_ref }}",
    "release-config-verify"
  );
  assertIncludes(
    releaseConfig,
    "run: npm run test:tauri-release-config && npm run test:macos-release-identity && npm run test:release-signing-policy && npm run test:github-workflows",
    "release-config-verify"
  );

  const ensureTag = extractJob(releaseWorkflow, "ensure-release-tag");
  assertIncludes(ensureTag, "- frontend-verify", "ensure-release-tag needs");
  assertIncludes(ensureTag, "- rust-preflight", "ensure-release-tag needs");
  assertIncludes(ensureTag, "- release-config-verify", "ensure-release-tag needs");
  assertIncludes(
    ensureTag,
    "ref: ${{ needs.prepare-release.outputs.source_ref }}",
    "ensure-release-tag"
  );
  assertIncludes(ensureTag, 'git push origin "${tag_name}"', "ensure-release-tag");

  const build = extractJob(releaseWorkflow, "build");
  assertIncludes(build, "- ensure-release-tag", "build needs");
  assertIncludes(build, "ref: ${{ needs.prepare-release.outputs.tag_name }}", "build checkout");

  assertOrdered(releaseWorkflow, "  rust-preflight:", "  ensure-release-tag:", "release jobs");
  assertOrdered(
    releaseWorkflow,
    "  release-config-verify:",
    "  ensure-release-tag:",
    "release jobs"
  );
  assertOrdered(releaseWorkflow, "  ensure-release-tag:", "  build:", "release jobs");
}

function assertMacosBundleIdentityGate(releaseWorkflow) {
  const build = extractJob(releaseWorkflow, "build");
  assertIncludes(build, "name: Build Tauri app (macOS unsigned)", "release build");
  assertIncludes(build, "name: Build Tauri app (macOS signed/notarized)", "release build");
  assertIncludes(build, "name: Verify macOS bundle identity", "release build");
  assertIncludes(build, "name: Verify macOS signing and notarization", "release build");
  assertIncludes(
    build,
    "node scripts/verify-macos-release-identity.js --require-bundle",
    "release build"
  );
  assertOrdered(
    build,
    "name: Build Tauri app (macOS unsigned)",
    "name: Verify macOS bundle identity",
    "release build"
  );
  assertOrdered(
    build,
    "name: Build Tauri app (macOS signed/notarized)",
    "name: Verify macOS bundle identity",
    "release build"
  );
  assertOrdered(
    build,
    "name: Verify macOS bundle identity",
    "name: Verify macOS signing and notarization",
    "release build"
  );
}

function assertCompositeActionUsage(workflowText, workflowName) {
  assertIncludes(workflowText, "uses: ./.github/actions/cache-tauri-rust", workflowName);
  assertIncludes(workflowText, "uses: ./.github/actions/setup-tauri-linux", workflowName);
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

const ciWorkflow = readRepoFile(".github/workflows/ci.yml");
const releaseWorkflow = readRepoFile(".github/workflows/release.yml");
const cacheAction = readRepoFile(".github/actions/cache-tauri-rust/action.yml");
const linuxAction = readRepoFile(".github/actions/setup-tauri-linux/action.yml");

test("keeps CI Rust preflight on Linux and macOS targets", () => {
  assertRustPreflightMatrix(ciWorkflow, "CI", [
    "ci-linux-rust",
    "ci-macos-aarch64-rust",
    "ci-macos-x64-rust",
  ]);
});

test("keeps release Rust preflight before tag creation", () => {
  assertRustPreflightMatrix(releaseWorkflow, "Release", [
    "release-preflight-linux-rust",
    "release-preflight-macos-aarch64-rust",
    "release-preflight-macos-x64-rust",
  ]);
  assertReleaseTagGate(releaseWorkflow);
  assertMacosBundleIdentityGate(releaseWorkflow);
});

test("keeps workflow shared setup in composite actions", () => {
  assertCompositeActionUsage(ciWorkflow, "CI workflow");
  assertCompositeActionUsage(releaseWorkflow, "Release workflow");
  assertIncludes(cacheAction, "uses: actions/cache@v4", "cache action");
  assertIncludes(cacheAction, "src-tauri/target", "cache action");
  assertIncludes(linuxAction, "libwebkit2gtk-4.1-dev", "linux setup action");
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

console.log(`github workflow tests passed (${tests.length})`);
