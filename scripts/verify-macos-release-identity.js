#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const requireBundle = process.argv.includes("--require-bundle");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function readJson(relativePath) {
  return JSON.parse(readRepoFile(relativePath));
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

function extractJob(workflowText, jobName) {
  const lines = workflowText.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing job: ${jobName}`);

  const end = lines.findIndex((line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function plistStringValue(plistText, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = plistText.match(new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]*)</string>`));
  return match?.[1] || null;
}

function findMacosBundleInfoPlists(root) {
  if (!fs.existsSync(root)) return [];

  const results = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
        continue;
      }

      const normalized = child.split(path.sep).join("/");
      if (entry.isFile() && normalized.endsWith(".app/Contents/Info.plist")) {
        results.push(child);
      }
    }
  }

  return results.sort();
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const sourceInfoPlist = readRepoFile("src-tauri/Info.plist");
const releaseWorkflow = readRepoFile(".github/workflows/release.yml");
const macosSmokeDoc = readRepoFile("docs/release/macos-upgrade-smoke.md");

test("keeps macOS bundle identity source controlled by Tauri config", () => {
  assert.equal(tauriConfig.identifier, "com.typefree.desktop");
  assert.ok(!tauriConfig.identifier.endsWith(".app"));
  assert.equal(tauriConfig.bundle.macOS.infoPlist, "Info.plist");
  assert.ok(
    !sourceInfoPlist.includes("CFBundleIdentifier"),
    "source Info.plist must not override Tauri's generated CFBundleIdentifier"
  );
});

test("keeps the release workflow checking generated macOS bundles", () => {
  const buildJob = extractJob(releaseWorkflow, "build");
  assertIncludes(buildJob, "name: Build Tauri app (macOS unsigned)", "release build job");
  assertIncludes(buildJob, "name: Build Tauri app (macOS signed/notarized)", "release build job");
  assertIncludes(buildJob, "name: Verify macOS bundle identity", "release build job");
  assertIncludes(
    buildJob,
    "node scripts/verify-macos-release-identity.js --require-bundle",
    "release build job"
  );
  assertOrdered(
    buildJob,
    "name: Build Tauri app (macOS unsigned)",
    "name: Verify macOS bundle identity",
    "release build job"
  );
  assertOrdered(
    buildJob,
    "name: Build Tauri app (macOS signed/notarized)",
    "name: Verify macOS bundle identity",
    "release build job"
  );
});

test("keeps manual macOS upgrade smoke coverage explicit", () => {
  for (const expected of [
    "com.typefree.app",
    "com.typefree.desktop",
    "CFBundleIdentifier",
    "Application Support",
    "localStorage",
    "Accessibility",
    "Microphone",
    "LaunchAgents",
  ]) {
    assertIncludes(macosSmokeDoc, expected, "macOS upgrade smoke doc");
  }
});

if (requireBundle) {
  test("generated macOS app bundle identity matches release config", () => {
    const infoPlists = findMacosBundleInfoPlists(path.join(repoRoot, "src-tauri", "target"));
    assert.ok(infoPlists.length > 0, "expected at least one generated .app/Contents/Info.plist");

    for (const infoPlist of infoPlists) {
      const plistText = fs.readFileSync(infoPlist, "utf8");
      assert.equal(
        plistStringValue(plistText, "CFBundleIdentifier"),
        tauriConfig.identifier,
        `${infoPlist} CFBundleIdentifier`
      );
      assert.equal(
        plistStringValue(plistText, "CFBundleShortVersionString"),
        packageJson.version,
        `${infoPlist} CFBundleShortVersionString`
      );
      assert.equal(
        plistStringValue(plistText, "CFBundleName"),
        tauriConfig.productName,
        `${infoPlist} CFBundleName`
      );
    }
  });
}

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

console.log(`macOS release identity tests passed (${tests.length})`);
