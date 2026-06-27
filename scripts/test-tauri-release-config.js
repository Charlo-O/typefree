#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const legacyIdentifier = "com.typefree.app";

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function readJson(relativePath) {
  return JSON.parse(readRepoFile(relativePath));
}

function assertIncludes(text, expected, context) {
  assert.ok(text.includes(expected), `${context} must include: ${expected}`);
}

function assertFileExists(relativePath) {
  assert.ok(fs.existsSync(path.join(repoRoot, relativePath)), `${relativePath} must exist`);
}

function cargoPackageVersion(cargoToml) {
  const match = cargoToml.match(/^\[package\][\s\S]*?^version = "([^"]+)"/m);
  assert.ok(match, "Cargo.toml package version must be declared");
  return match[1];
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = readRepoFile("src-tauri/Cargo.toml");
const appDataMigration = readRepoFile("src-tauri/src/app_data_migration.rs");
const infoPlist = readRepoFile("src-tauri/Info.plist");

test("keeps the Tauri bundle identifier release-safe", () => {
  assert.match(
    tauriConfig.identifier,
    /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/,
    "identifier should be reverse-DNS lowercase"
  );
  assert.notEqual(
    tauriConfig.identifier,
    legacyIdentifier,
    "identifier should move away from the legacy .app suffix"
  );
  assert.ok(
    !tauriConfig.identifier.endsWith(".app"),
    "identifier must not end with .app because macOS app bundles also use that extension"
  );
});

test("keeps legacy app-data migration tied to the retired identifier", () => {
  assertIncludes(
    appDataMigration,
    `const LEGACY_APP_IDENTIFIER: &str = "${legacyIdentifier}";`,
    "app data migration"
  );
  assertIncludes(
    appDataMigration,
    "copy_missing_entries_from_legacy_dir(&legacy_dir, &current_dir)",
    "app data migration"
  );
  assertIncludes(
    appDataMigration,
    "copy_missing_entries_from_legacy_dir(&legacy_local_dir, &current_local_dir)",
    "app data migration"
  );
});

test("keeps release metadata and bundle inputs aligned", () => {
  assert.equal(
    tauriConfig.version,
    packageJson.version,
    "tauri.conf.json version must match package.json"
  );
  assert.equal(
    cargoPackageVersion(cargoToml),
    packageJson.version,
    "Cargo.toml version must match package.json"
  );
  assert.equal(
    packageJson.scripts["tauri:build"],
    "tauri build",
    "tauri:build should be the release build command"
  );
  assert.equal(
    tauriConfig.build.beforeBuildCommand,
    "npm run build",
    "Tauri build should compile frontend first"
  );
  assert.equal(tauriConfig.build.frontendDist, "../src/dist", "Tauri should bundle the Vite dist");
  assert.equal(tauriConfig.bundle.active, true, "Tauri bundle must stay active");
  assert.equal(
    tauriConfig.bundle.targets,
    "all",
    "Tauri release should build all configured bundle targets"
  );
  assert.equal(
    tauriConfig.bundle.macOS.infoPlist,
    "Info.plist",
    "macOS bundle should include Info.plist"
  );
  assert.ok(
    !infoPlist.includes("CFBundleIdentifier"),
    "Info.plist should not override the Tauri identifier"
  );

  for (const iconPath of tauriConfig.bundle.icon) {
    assertFileExists(path.join("src-tauri", iconPath));
  }
  assertFileExists("src-tauri/Info.plist");
});

test("keeps release config checks in the Tauri verification gate", () => {
  assertIncludes(
    packageJson.scripts["verify:tauri"],
    "npm run test:tauri-release-config",
    "verify:tauri"
  );
  assertIncludes(
    packageJson.scripts["verify:tauri"],
    "npm run test:tauri-app-data-migration",
    "verify:tauri"
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

console.log(`tauri release config tests passed (${tests.length})`);
