#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const defaultManifestDir = path.join(repoRoot, ".codex-run-logs");
const platforms = ["windows", "macos", "linux"];
const summaryKinds = [
  "runtime-probe",
  "native-recording",
  "dictation-pipeline",
  "cloud-preflight",
  "cloud-transcription",
];
const evidenceDirPattern = /^runtime-smoke-evidence-(windows|macos|linux)-.+$/;
const manifestFilePattern = /^runtime-smoke-set\.(windows|macos|linux)\.manifest\.json$/i;

function usage() {
  return [
    "Usage:",
    "  node scripts/import-runtime-smoke-evidence.js --source <runtime-smoke-evidence-dir-or-manifest> [options]",
    "",
    "Options:",
    "  --platform <windows|macos|linux>      Expected platform label",
    "  --manifest-dir <dir>                  Integration directory for platform bundles",
    "  --replace                             Replace an existing imported bundle with the same name",
    "",
    "The importer validates each source bundle with --require-cloud-microphone,",
    "then copies it into the manifest directory. If --source is a directory",
    "without a manifest, one-level runtime-smoke-evidence-* child directories",
    "are imported in one pass. It does not run Tauri, read",
    "credentials, start recording, or call providers.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    manifestDir: process.env.TYPEFREE_RUNTIME_SMOKE_MANIFEST_DIR || defaultManifestDir,
    replace: false,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--replace") {
      options.replace = true;
    } else if (arg === "--source" && next) {
      options.source = path.resolve(repoRoot, next);
      index += 1;
    } else if (arg === "--platform" && next) {
      options.platform = next.toLowerCase();
      index += 1;
    } else if (arg === "--manifest-dir" && next) {
      options.manifestDir = path.resolve(repoRoot, next);
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (!options.source && positional.length > 0) {
    options.source = path.resolve(repoRoot, positional.shift());
  }
  if (!options.platform && positional.length > 0 && platforms.includes(positional[0].toLowerCase())) {
    options.platform = positional.shift().toLowerCase();
  }
  if (positional.length > 0) {
    throw new Error(`Unexpected positional arguments: ${positional.join(", ")}`);
  }
  return options;
}

function validateOptions(options) {
  if (options.help) {
    return;
  }
  if (!options.source) {
    throw new Error("Missing --source <runtime-smoke-evidence-dir-or-manifest>");
  }
  if (options.platform && !platforms.includes(options.platform)) {
    throw new Error("Invalid --platform <windows|macos|linux>");
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoSymlink(filePath, context) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`${context}: symlinks are not allowed in runtime evidence bundles`);
  }
  return stat;
}

function assertRealPathInside(root, candidate, context) {
  const realRoot = fs.realpathSync(root);
  const realCandidate = fs.realpathSync(candidate);
  if (!pathInside(realRoot, realCandidate)) {
    throw new Error(`${context}: real path must stay inside the runtime evidence bundle`);
  }
}

function resolveRelativeBundlePath(root, value, context) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context}: expected non-empty relative path`);
  }
  if (path.isAbsolute(value)) {
    throw new Error(`${context}: absolute paths are not allowed in runtime evidence manifests`);
  }

  const resolved = path.resolve(root, value);
  if (!pathInside(root, resolved)) {
    throw new Error(`${context}: path must stay inside the runtime evidence bundle`);
  }
  if (fs.existsSync(resolved)) {
    assertNoSymlink(resolved, context);
    assertRealPathInside(root, resolved, context);
  }
  return resolved;
}

function collectObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectKeys(item, keys);
    }
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectObjectKeys(child, keys);
    }
  }
  return keys;
}

function assertManifestHasNoSensitivePayload(manifest, platform) {
  const forbiddenPayloadKeys = new Set(["text", "transcript", "transcriptText", "rawText", "processedText"]);
  const forbiddenSecretKeyPattern = /(api[_-]?key|access[_-]?token|secret|authorization|credentialValue|tokenValue)/i;

  for (const key of collectObjectKeys(manifest)) {
    if (forbiddenPayloadKeys.has(key)) {
      throw new Error(`${platform}: manifest must not include transcript payload key ${key}`);
    }
    if (forbiddenSecretKeyPattern.test(key) && !/CredentialKeys$/.test(key)) {
      throw new Error(`${platform}: manifest must not include secret payload key ${key}`);
    }
  }
}

function findManifest(source, expectedPlatform) {
  if (!fs.existsSync(source)) {
    throw new Error(`--source must exist: ${source}`);
  }

  const stat = assertNoSymlink(source, "--source");
  if (stat.isFile()) {
    if (!manifestFilePattern.test(path.basename(source))) {
      throw new Error("--source file must be a runtime-smoke-set.<platform>.manifest.json file");
    }
    return source;
  }
  if (!stat.isDirectory()) {
    throw new Error("--source must be a runtime evidence directory or manifest file");
  }

  if (expectedPlatform) {
    const manifest = path.join(source, `runtime-smoke-set.${expectedPlatform}.manifest.json`);
    if (fs.existsSync(manifest)) {
      assertNoSymlink(manifest, `${expectedPlatform}: source manifest`);
      return manifest;
    }
    throw new Error(`${expectedPlatform}: source directory missing runtime-smoke-set.${expectedPlatform}.manifest.json`);
  }

  const manifests = fs
    .readdirSync(source)
    .filter((name) => manifestFilePattern.test(name))
    .map((name) => path.join(source, name));
  if (manifests.length !== 1) {
    throw new Error(`source directory must contain exactly one runtime-smoke-set.<platform>.manifest.json`);
  }
  assertNoSymlink(manifests[0], "source manifest");
  return manifests[0];
}

function discoverChildBundleManifests(source, expectedPlatform) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    return [];
  }

  const manifests = [];
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.name.startsWith("runtime-smoke-evidence-")) {
      continue;
    }
    const match = entry.name.match(evidenceDirPattern);
    if (!match) {
      throw new Error(`invalid runtime evidence bundle directory name: ${entry.name}`);
    }
    const childDir = path.join(source, entry.name);
    const childStat = assertNoSymlink(childDir, `${entry.name}: child bundle`);
    if (!childStat.isDirectory()) {
      throw new Error(`${entry.name}: runtime evidence bundle must be a directory`);
    }
    const directoryPlatform = match[1];
    const directManifests = fs
      .readdirSync(childDir)
      .filter((name) => manifestFilePattern.test(name))
      .map((name) => path.join(childDir, name));
    if (directManifests.length !== 1) {
      throw new Error(`${entry.name}: expected exactly one runtime-smoke-set.<platform>.manifest.json`);
    }
    const manifestName = path.basename(directManifests[0]);
    const manifestPlatform = manifestName.match(manifestFilePattern)?.[1]?.toLowerCase();
    if (manifestPlatform !== directoryPlatform) {
      throw new Error(`${entry.name}: directory platform and manifest filename must match`);
    }
    assertNoSymlink(directManifests[0], `${entry.name}: source manifest`);
    if (expectedPlatform && directoryPlatform !== expectedPlatform) {
      continue;
    }
    for (const platform of platforms) {
      if (platform !== directoryPlatform) {
        continue;
      }
      manifests.push(directManifests[0]);
    }
  }
  return manifests;
}

function findBundleManifests(source, expectedPlatform) {
  if (!fs.existsSync(source)) {
    throw new Error(`--source must exist: ${source}`);
  }
  const sourceStat = assertNoSymlink(source, "--source");
  if (!sourceStat.isDirectory()) {
    return [findManifest(source, expectedPlatform)];
  }

  if (expectedPlatform) {
    const directManifest = path.join(source, `runtime-smoke-set.${expectedPlatform}.manifest.json`);
    if (fs.existsSync(directManifest)) {
      return [directManifest];
    }
    const childManifests = discoverChildBundleManifests(source, expectedPlatform);
    if (childManifests.length === 0) {
      throw new Error(`${expectedPlatform}: source directory missing runtime-smoke-set.${expectedPlatform}.manifest.json`);
    }
    return childManifests;
  }

  const directManifests = fs
    .readdirSync(source)
    .filter((name) => manifestFilePattern.test(name))
    .map((name) => path.join(source, name));
  if (directManifests.length > 1) {
    throw new Error("source directory must contain exactly one direct runtime-smoke-set.<platform>.manifest.json");
  }
  if (directManifests.length === 1) {
    assertNoSymlink(directManifests[0], "source manifest");
    return directManifests;
  }

  const childManifests = discoverChildBundleManifests(source, expectedPlatform);
  if (childManifests.length === 0) {
    throw new Error("source directory must contain a runtime evidence manifest or one-level runtime-smoke-evidence-* child bundles");
  }
  return childManifests;
}

function resolveBundle(source, expectedPlatform) {
  const manifestPath = source;
  const bundleDir = path.dirname(manifestPath);
  assertNoSymlink(manifestPath, "runtime evidence manifest");
  const manifest = readJson(manifestPath);

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("runtime evidence manifest must be a JSON object");
  }
  if (!platforms.includes(manifest.platform)) {
    throw new Error("runtime evidence manifest missing valid platform");
  }
  if (typeof manifest.collectedAt !== "string" || Number.isNaN(Date.parse(manifest.collectedAt))) {
    throw new Error(`${manifest.platform}: manifest missing valid collectedAt timestamp`);
  }
  if (expectedPlatform && manifest.platform !== expectedPlatform) {
    throw new Error(`platform mismatch: expected ${expectedPlatform}, got ${manifest.platform}`);
  }
  const manifestPlatform = path.basename(manifestPath).match(manifestFilePattern)?.[1]?.toLowerCase();
  if (manifestPlatform !== manifest.platform) {
    throw new Error(`${manifest.platform}: manifest filename and platform must match`);
  }
  if (!manifest.summaries || typeof manifest.summaries !== "object") {
    throw new Error(`${manifest.platform}: manifest missing summaries object`);
  }
  assertManifestHasNoSensitivePayload(manifest, manifest.platform);

  const summaryRoot = resolveRelativeBundlePath(
    bundleDir,
    typeof manifest.summarySetDir === "string" ? manifest.summarySetDir : ".",
    `${manifest.platform}: manifest summarySetDir`
  );
  const summaries = {};
  for (const kind of summaryKinds) {
    summaries[kind] = resolveRelativeBundlePath(
      summaryRoot,
      manifest.summaries[kind],
      `${manifest.platform}: manifest summaries.${kind}`
    );
    if (!fs.existsSync(summaries[kind]) || !fs.statSync(summaries[kind]).isFile()) {
      throw new Error(`${manifest.platform}: missing summary file for ${kind}`);
    }
  }

  return {
    bundleDir,
    manifest,
    manifestPath,
    platform: manifest.platform,
    summaries,
  };
}

function resolveBundles(source, expectedPlatform) {
  const manifests = findBundleManifests(source, expectedPlatform);
  const bundles = manifests.map((manifestPath) => resolveBundle(manifestPath, expectedPlatform));
  const seenManifests = new Set();
  const seenPlatforms = new Set();
  for (const bundle of bundles) {
    const resolvedManifest = path.resolve(bundle.manifestPath).toLowerCase();
    if (seenManifests.has(resolvedManifest)) {
      throw new Error(`duplicate runtime evidence manifest: ${bundle.manifestPath}`);
    }
    seenManifests.add(resolvedManifest);
    if (seenPlatforms.has(bundle.platform)) {
      throw new Error(`duplicate runtime evidence platform in import source: ${bundle.platform}`);
    }
    seenPlatforms.add(bundle.platform);
  }
  return bundles.sort((left, right) => {
    const platformOrder = platforms.indexOf(left.platform) - platforms.indexOf(right.platform);
    if (platformOrder !== 0) return platformOrder;
    return left.manifestPath.localeCompare(right.manifestPath);
  });
}

function runStrictSummaryVerifier(bundle) {
  const args = [
    path.join(repoRoot, "scripts/verify-runtime-smoke-summaries.js"),
    "--require-cloud-microphone",
    "--platform",
    bundle.platform,
    "--runtime-probe",
    bundle.summaries["runtime-probe"],
    "--native-recording",
    bundle.summaries["native-recording"],
    "--dictation-pipeline",
    bundle.summaries["dictation-pipeline"],
    "--cloud-preflight",
    bundle.summaries["cloud-preflight"],
    "--cloud-transcription",
    bundle.summaries["cloud-transcription"],
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(`${bundle.platform}: runtime summary verification failed; refusing to import`);
  }
}

function importedBundleName(bundle) {
  const baseName = path.basename(bundle.bundleDir);
  const expectedPrefix = `runtime-smoke-evidence-${bundle.platform}-`;
  if (baseName.startsWith(expectedPrefix)) {
    return baseName;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${expectedPrefix}imported-${stamp}`;
}

function assertSafeImportDestination(manifestDir, destination, platform) {
  const resolvedManifestDir = path.resolve(manifestDir);
  const resolvedDestination = path.resolve(destination);
  const expectedPrefix = `runtime-smoke-evidence-${platform}-`;
  if (!pathInside(resolvedManifestDir, resolvedDestination)) {
    throw new Error("import destination must stay inside --manifest-dir");
  }
  if (!path.basename(resolvedDestination).startsWith(expectedPrefix)) {
    throw new Error(`import destination must start with ${expectedPrefix}`);
  }
}

function importDestinationForBundle(bundle, options) {
  const destination = path.join(options.manifestDir, importedBundleName(bundle));
  assertSafeImportDestination(options.manifestDir, destination, bundle.platform);
  return destination;
}

function preflightImportEntries(bundles, options) {
  fs.mkdirSync(options.manifestDir, { recursive: true });
  const seenDestinations = new Set();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return bundles.map((bundle, index) => {
    const destination = importDestinationForBundle(bundle, options);
    const destinationKey = path.resolve(destination).toLowerCase();
    if (seenDestinations.has(destinationKey)) {
      throw new Error(`duplicate import destination: ${destination}`);
    }
    seenDestinations.add(destinationKey);

    const destinationExists = fs.existsSync(destination);
    if (destinationExists) {
      assertNoSymlink(destination, "import destination");
    }
    if (destinationExists && !options.replace) {
      throw new Error(`destination already exists: ${destination}; pass --replace to overwrite it`);
    }

    return {
      backup: `${destination}.backup-${stamp}-${index}`,
      bundle,
      destination,
      destinationExists,
      manifest: path.join(destination, `runtime-smoke-set.${bundle.platform}.manifest.json`),
      temp: path.join(options.manifestDir, `.runtime-smoke-import-${bundle.platform}-${stamp}-${index}`),
    };
  });
}

function copyWhitelistedBundleFiles(bundle, destinationDir) {
  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.copyFileSync(
    bundle.manifestPath,
    path.join(destinationDir, `runtime-smoke-set.${bundle.platform}.manifest.json`)
  );

  const summarySetDir = typeof bundle.manifest.summarySetDir === "string" ? bundle.manifest.summarySetDir : ".";
  const destinationSummaryRoot = resolveRelativeBundlePath(
    destinationDir,
    summarySetDir,
    `${bundle.platform}: imported manifest summarySetDir`
  );
  fs.mkdirSync(destinationSummaryRoot, { recursive: true });

  for (const kind of summaryKinds) {
    const destinationSummary = resolveRelativeBundlePath(
      destinationSummaryRoot,
      bundle.manifest.summaries[kind],
      `${bundle.platform}: imported manifest summaries.${kind}`
    );
    fs.mkdirSync(path.dirname(destinationSummary), { recursive: true });
    fs.copyFileSync(bundle.summaries[kind], destinationSummary);
  }
}

function prepareImportEntries(entries) {
  const prepared = [];
  try {
    for (const entry of entries) {
      copyWhitelistedBundleFiles(entry.bundle, entry.temp);
      const importedManifest = path.join(entry.temp, `runtime-smoke-set.${entry.bundle.platform}.manifest.json`);
      const importedBundle = resolveBundle(importedManifest, entry.bundle.platform);
      runStrictSummaryVerifier(importedBundle);
      prepared.push(entry);
    }
    return prepared;
  } catch (error) {
    for (const entry of entries) {
      fs.rmSync(entry.temp, { recursive: true, force: true });
    }
    throw error;
  }
}

function commitImportEntries(entries) {
  const backups = [];
  const committed = [];
  try {
    for (const entry of entries) {
      if (entry.destinationExists) {
        fs.renameSync(entry.destination, entry.backup);
        backups.push(entry);
      }
    }
    for (const entry of entries) {
      fs.renameSync(entry.temp, entry.destination);
      committed.push(entry);
    }
    for (const entry of backups) {
      fs.rmSync(entry.backup, { recursive: true, force: true });
    }
  } catch (error) {
    for (const entry of committed) {
      fs.rmSync(entry.destination, { recursive: true, force: true });
    }
    for (const entry of backups.reverse()) {
      if (fs.existsSync(entry.backup)) {
        fs.renameSync(entry.backup, entry.destination);
      }
    }
    for (const entry of entries) {
      fs.rmSync(entry.temp, { recursive: true, force: true });
    }
    throw error;
  }
}

function importBundles(bundles, options) {
  const entries = preflightImportEntries(bundles, options);
  for (const bundle of bundles) {
    runStrictSummaryVerifier(bundle);
  }
  prepareImportEntries(entries);
  commitImportEntries(entries);
  return entries.map((entry) => ({
    destination: entry.destination,
    manifest: entry.manifest,
    platform: entry.bundle.platform,
  }));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  validateOptions(options);

  const bundles = resolveBundles(options.source, options.platform);
  const imports = importBundles(bundles, options);
  const result = {
    imports,
    platform: imports.length === 1 ? imports[0].platform : null,
    status: "passed",
    ...(imports.length === 1
      ? {
          destination: imports[0].destination,
          manifest: imports[0].manifest,
        }
      : {}),
  };
  console.log(`runtime smoke evidence imported (${imports.map((item) => item.platform).join(", ")})`);
  for (const item of imports) {
    console.log(`${item.platform} destination: ${item.destination}`);
    console.log(`${item.platform} manifest: ${item.manifest}`);
  }
  console.log(`TYPEFREE_RUNTIME_SMOKE_IMPORT_RESULT ${JSON.stringify(result)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exit(1);
}
