#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function readJson(relativePath) {
  return JSON.parse(readRepoFile(relativePath));
}

function extractJob(workflowText, jobName) {
  const lines = workflowText.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing job: ${jobName}`);

  const end = lines.findIndex((line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function extractStep(jobText, stepName) {
  const lines = jobText.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.notEqual(start, -1, `missing step: ${stepName}`);

  const end = lines.findIndex((line, index) => index > start && /^ {6}- name: /.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function assertIncludes(text, expected, context) {
  assert.ok(text.includes(expected), `${context} must include: ${expected}`);
}

function assertNotIncludes(text, forbidden, context) {
  assert.ok(!text.includes(forbidden), `${context} must not include: ${forbidden}`);
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

const releaseWorkflow = readRepoFile(".github/workflows/release.yml");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const signingPolicyDoc = readRepoFile("docs/release/macos-signing-policy.md");
const signedArtifactVerifier = readRepoFile("scripts/verify-macos-signed-artifacts.sh");
const buildJob = extractJob(releaseWorkflow, "build");

test("keeps macOS signing mode explicit and defaulting to unsigned", () => {
  assertIncludes(releaseWorkflow, "macos_signing_mode:", "workflow_dispatch inputs");
  assertIncludes(releaseWorkflow, 'default: "unsigned"', "workflow_dispatch inputs");
  assertIncludes(releaseWorkflow, "- signed-notarized", "workflow_dispatch inputs");
  assertIncludes(
    releaseWorkflow,
    "MACOS_RELEASE_SIGNING_MODE: ${{ github.event.inputs.macos_signing_mode || 'unsigned' }}",
    "release workflow"
  );
  assertIncludes(
    releaseWorkflow,
    "macos_signing_mode: ${{ steps.meta.outputs.macos_signing_mode }}",
    "prepare-release outputs"
  );
  assertIncludes(
    releaseWorkflow,
    "macos_release_note: ${{ steps.meta.outputs.macos_release_note }}",
    "prepare-release outputs"
  );
  assertIncludes(releaseWorkflow, "signed-notarized) ;;", "prepare-release signing mode guard");
  assertIncludes(
    releaseWorkflow,
    "Tag-triggered releases must use unsigned macOS artifacts",
    "tag-triggered release guard"
  );
});

test("keeps the current macOS release lane explicitly unsigned", () => {
  assert.equal(tauriConfig.bundle.macOS.signingIdentity, null);
  assert.equal(tauriConfig.bundle.macOS.providerShortName, null);

  const macosBuild = extractStep(buildJob, "Build Tauri app (macOS unsigned)");
  assertIncludes(macosBuild, "macos_signing_mode == 'unsigned'", "macOS unsigned build");
  assertIncludes(macosBuild, "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}", "macOS unsigned build");
  assertIncludes(
    macosBuild,
    "${{ needs.prepare-release.outputs.macos_release_note }}",
    "macOS unsigned build"
  );
  assertIncludes(
    macosBuild,
    "args: --target ${{ matrix.target }} --no-sign",
    "macOS unsigned build"
  );
  assertNotIncludes(macosBuild, "APPLE_", "macOS unsigned build");
});

test("keeps signed-notarized macOS builds fail-closed", () => {
  const secretPreflight = extractStep(buildJob, "Verify macOS signing secrets");
  assertIncludes(secretPreflight, "macos_signing_mode == 'signed-notarized'", "signing preflight");
  for (const name of [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_ISSUER",
    "APPLE_API_PRIVATE_KEY_P8",
  ]) {
    assertIncludes(secretPreflight, name, "signing preflight");
  }
  assertIncludes(secretPreflight, "Missing required macOS signing secret(s)", "signing preflight");
  assertIncludes(secretPreflight, "apple-notary-api-key.p8", "signing preflight");
  assertIncludes(secretPreflight, "chmod 600", "signing preflight");
  assertIncludes(secretPreflight, '[[ ! -s "${api_key_path}" ]]', "signing preflight");
  assertIncludes(
    secretPreflight,
    'echo "APPLE_API_KEY_PATH=${api_key_path}" >> "${GITHUB_ENV}"',
    "signing preflight"
  );

  const signedBuild = extractStep(buildJob, "Build Tauri app (macOS signed/notarized)");
  assertIncludes(signedBuild, "macos_signing_mode == 'signed-notarized'", "signed macOS build");
  assertIncludes(
    signedBuild,
    "APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE_BASE64 }}",
    "signed macOS build"
  );
  assertIncludes(
    signedBuild,
    "APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}",
    "signed macOS build"
  );
  assertIncludes(
    signedBuild,
    "APPLE_API_KEY: ${{ secrets.APPLE_API_KEY_ID }}",
    "signed macOS build"
  );
  assertIncludes(
    signedBuild,
    "APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}",
    "signed macOS build"
  );
  assertNotIncludes(signedBuild, "secrets.APPLE_API_KEY_PATH", "signed macOS build");
  assertNotIncludes(signedBuild, "--no-sign", "signed macOS build");
  assertNotIncludes(signedBuild, "--skip-stapling", "signed macOS build");

  const verifySigning = extractStep(buildJob, "Verify macOS signing and notarization");
  assertIncludes(verifySigning, "macos_signing_mode == 'signed-notarized'", "signing verification");
  assertIncludes(
    verifySigning,
    "bash scripts/verify-macos-signed-artifacts.sh",
    "signing verification"
  );

  for (const expected of [
    "codesign --verify --deep --strict --verbose=2",
    "spctl --assess --type execute --verbose=4",
    "xcrun stapler validate",
    "spctl --assess --type open --context context:primary-signature --verbose=4",
  ]) {
    assertIncludes(signedArtifactVerifier, expected, "signed artifact verifier");
  }
});

test("keeps Apple signing secrets out of non-macOS builds", () => {
  const desktopBuild = extractStep(buildJob, "Build Tauri app (Linux/Windows)");
  assertIncludes(desktopBuild, "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}", "Linux/Windows build");
  assertIncludes(
    desktopBuild,
    "${{ needs.prepare-release.outputs.macos_release_note }}",
    "Linux/Windows build"
  );
  assertNotIncludes(desktopBuild, "APPLE_", "Linux/Windows build");
  assertNotIncludes(desktopBuild, "signed when available", "Linux/Windows build");
});

test("keeps every release upload body tied to the resolved macOS signing note", () => {
  const noteUses =
    releaseWorkflow.match(/\$\{\{ needs\.prepare-release\.outputs\.macos_release_note \}\}/g) || [];
  assert.equal(
    noteUses.length,
    3,
    "all tauri-action release bodies must use the resolved macOS signing note"
  );
});

test("keeps the tag-before-build release gate enforcing signing policy", () => {
  const releaseConfig = extractJob(releaseWorkflow, "release-config-verify");
  assertIncludes(releaseConfig, "npm run test:release-signing-policy", "release-config-verify");
});

test("documents unsigned status and future signed/notarized requirements", () => {
  for (const expected of [
    "Current policy: unsigned",
    "not notarized",
    "MACOS_RELEASE_SIGNING_MODE",
    "macos_signing_mode",
    "signed-notarized",
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "APPLE_API_KEY",
    "APPLE_API_ISSUER",
    "APPLE_API_KEY_PATH",
    "APPLE_API_PRIVATE_KEY_P8",
    "APPLE_PROVIDER_SHORT_NAME",
    "$RUNNER_TEMP",
    "codesign --verify",
    "spctl --assess",
    "xcrun stapler validate",
  ]) {
    assertIncludes(signingPolicyDoc, expected, "macOS signing policy doc");
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

console.log(`release signing policy tests passed (${tests.length})`);
