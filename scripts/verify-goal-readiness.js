#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const platforms = ["windows", "macos", "linux"];
const requiredLivePlatforms = ["windows"];
const optionalLivePlatforms = platforms.filter((platform) => !requiredLivePlatforms.includes(platform));
const summaryKinds = [
  "runtime-probe",
  "native-recording",
  "dictation-pipeline",
  "cloud-preflight",
  "cloud-transcription",
];

function usage() {
  const platformOptions = platforms
    .flatMap((platform) =>
      [
        `  --${platform}-manifest <runtime-smoke-set.${platform}.manifest.json>`,
        ...summaryKinds.map((kind) => `  --${platform}-${kind} <summary.json>`),
      ]
    )
    .join("\n");

  return [
    "Usage:",
    "  node scripts/verify-goal-readiness.js \\",
    "  --manifest-dir <directory-containing-runtime-smoke-evidence-bundles>",
    platformOptions,
    "",
    "Manifest options are portable collector outputs and cannot be combined with",
    "explicit summary paths for the same platform.",
    "",
    "Positional fallback order:",
    "  one directory path is treated as --manifest-dir.",
    "  manifests: windows manifest, then optional macOS manifest, then optional Linux manifest.",
    "  windows runtime/native/pipeline/preflight/cloud, then optional macos, then optional linux.",
    "",
    "Windows live runtime summary evidence is required for the current goal.",
    "Optional macOS/Linux evidence is validated with the same strict checks when provided.",
    "Cloud transcription is verified with --require-cloud-microphone.",
    "",
    "To generate and verify external collection command bundles:",
    "  npm run handoff:runtime-smoke-evidence -- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang> --cloud-smoke-ms <ms> --platform <platforms> --manifest-dir <dir> --bundle-dir <handoff-bundle-dir>",
    "  npm run verify:runtime-smoke-handoff-bundle -- --bundle-dir <handoff-bundle-dir>",
    "  npm run import:runtime-smoke-evidence -- --source <runtime-smoke-evidence-platform-dir-or-manifest> --manifest-dir <dir>",
  ].join("\n");
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(filePath) {
  const resolved = path.resolve(filePath);
  return {
    resolved,
    value: JSON.parse(fs.readFileSync(resolved, "utf8")),
  };
}

function parseArgs(argv) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const name = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;

    if (name === "manifest-dir") {
      options.manifestDir = value;
      continue;
    }

    const platform = platforms.find((candidate) => name.startsWith(`${candidate}-`));
    if (!platform) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const kind = name.slice(platform.length + 1);
    if (kind === "manifest") {
      options[platform] ||= {};
      options[platform].manifest = value;
      continue;
    }
    if (!summaryKinds.includes(kind)) {
      throw new Error(`Unknown summary kind for ${arg}`);
    }

    options[platform] ||= {};
    options[platform][kind] = value;
  }

  if (positional.length > 0) {
    const positionalManifests = positional.filter((value) => /\.manifest\.json$/i.test(value));
    if (positional.length === 1 && fs.existsSync(positional[0]) && fs.statSync(positional[0]).isDirectory()) {
      options.manifestDir ||= positional[0];
    } else if (positionalManifests.length === positional.length && positional.length <= platforms.length) {
      for (let index = 0; index < positional.length; index += 1) {
        options[platforms[index]] ||= {};
        options[platforms[index]].manifest ||= positional[index];
      }
    } else {
      const expected = platforms.length * summaryKinds.length;
      if (positional.length > expected) {
        throw new Error(`Expected at most ${expected} positional summary paths, got ${positional.length}`);
      }

      let index = 0;
      for (const platform of platforms) {
        options[platform] ||= {};
        for (const kind of summaryKinds) {
          if (index < positional.length) {
            options[platform][kind] ||= positional[index];
          }
          index += 1;
        }
      }
    }
  }

  if (options.manifestDir) {
    applyManifestDir(options, options.manifestDir);
  }

  for (const platform of platforms) {
    const platformOptions = options[platform];
    if (!platformOptions?.manifest) {
      continue;
    }
    const explicitKinds = summaryKinds.filter((kind) => platformOptions[kind]);
    if (explicitKinds.length > 0) {
      throw new Error(
        `${platform}: --${platform}-manifest cannot be combined with ${explicitKinds
          .map((kind) => `--${platform}-${kind}`)
          .join(", ")}`
      );
    }
  }

  return options;
}

function hasPlatformEvidence(platformOptions) {
  return !!platformOptions?.manifest || summaryKinds.some((kind) => !!platformOptions?.[kind]);
}

function manifestCandidateSortKey(platform, manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const collectedAtMs = Date.parse(String(manifest?.collectedAt || ""));
    if (!Number.isFinite(collectedAtMs)) {
      return null;
    }
    return { collectedAtMs, manifestPath };
  } catch {
    return null;
  }
}

function latestManifestForPlatform(manifestDir, platform) {
  const expectedName = `runtime-smoke-set.${platform}.manifest.json`;
  const expectedPrefix = `runtime-smoke-evidence-${platform}-`;
  let entries;
  try {
    entries = fs.readdirSync(manifestDir, { withFileTypes: true });
  } catch {
    return "";
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(expectedPrefix))
    .map((entry) => path.join(manifestDir, entry.name, expectedName))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .map((manifestPath) => manifestCandidateSortKey(platform, manifestPath))
    .filter(Boolean)
    .sort((left, right) => {
      const collectedAt = right.collectedAtMs - left.collectedAtMs;
      if (collectedAt !== 0) return collectedAt;
      return right.manifestPath.localeCompare(left.manifestPath);
    });

  return candidates[0]?.manifestPath || "";
}

function applyManifestDir(options, manifestDir) {
  const resolved = path.resolve(manifestDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`--manifest-dir must be an existing directory: ${manifestDir}`);
  }

  for (const platform of platforms) {
    options[platform] ||= {};
    if (hasPlatformEvidence(options[platform])) {
      continue;
    }
    const manifest = latestManifestForPlatform(resolved, platform);
    if (manifest) {
      options[platform].manifest = manifest;
    }
  }
}

function requireSnippet(text, snippet, label) {
  if (!text.includes(snippet)) {
    throw new Error(`${label} must include ${snippet}`);
  }
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

function staticChecks() {
  const packageJson = JSON.parse(read("package.json"));
  const audit = read("docs/goal-completion-audit.md");
  const agents = read("AGENTS.md");
  const matrix = read("docs/runtime-smoke-matrix.md");
  const goalCoverage = read("scripts/test-goal-coverage.js");
  const smokeVerifier = read("scripts/verify-runtime-smoke-summaries.js");

  for (const scriptName of [
    "verify:frontend",
    "verify:tauri",
    "test:goal-coverage",
    "test:goal-readiness",
    "verify:goal-readiness",
    "verify:runtime-smoke-summaries",
    "smoke:runtime-probe",
    "smoke:native-recording",
    "smoke:dictation-pipeline",
    "smoke:cloud-credential-preflight",
    "smoke:cloud-transcription",
    "collect:runtime-smoke-evidence",
    "pack:runtime-smoke-evidence",
    "import:runtime-smoke-evidence",
    "handoff:runtime-smoke-evidence",
    "verify:runtime-smoke-handoff-bundle",
    "test:runtime-smoke-evidence",
    "test:runtime-smoke-packager",
    "test:runtime-smoke-importer",
    "test:runtime-smoke-handoff",
    "test:runtime-smoke-handoff-bundle",
  ]) {
    if (typeof packageJson.scripts?.[scriptName] !== "string") {
      throw new Error(`package.json missing script ${scriptName}`);
    }
  }

  const requirementRows = [...audit.matchAll(/^\| \d+ \|/gm)];
  if (requirementRows.length !== 22) {
    throw new Error(`docs/goal-completion-audit.md must list 22 requirement rows, found ${requirementRows.length}`);
  }

  requireSnippet(packageJson.scripts["verify:frontend"], "npm run test:goal-coverage", "verify:frontend");
  requireSnippet(packageJson.scripts["verify:frontend"], "npm run test:goal-readiness", "verify:frontend");
  requireSnippet(
    packageJson.scripts["verify:frontend"],
    "npm run test:runtime-smoke-evidence",
    "verify:frontend"
  );
  requireSnippet(
    packageJson.scripts["verify:frontend"],
    "npm run test:runtime-smoke-packager",
    "verify:frontend"
  );
  requireSnippet(
    packageJson.scripts["verify:frontend"],
    "npm run test:runtime-smoke-importer",
    "verify:frontend"
  );
  requireSnippet(
    packageJson.scripts["verify:frontend"],
    "npm run test:runtime-smoke-handoff",
    "verify:frontend"
  );
  requireSnippet(
    packageJson.scripts["verify:frontend"],
    "npm run test:runtime-smoke-handoff-bundle",
    "verify:frontend"
  );
  requireSnippet(packageJson.scripts["verify:tauri"], "npm run test:tauri-dev-smoke-contract", "verify:tauri");
  requireSnippet(goalCoverage, "goal coverage contract tests passed", "test-goal-coverage");
  requireSnippet(audit, "runtime summary verifier", "goal audit");
  requireSnippet(matrix, "--require-cloud-microphone", "runtime smoke matrix");
  requireSnippet(matrix, "windows", "runtime smoke matrix");
  requireSnippet(matrix, "macos", "runtime smoke matrix");
  requireSnippet(matrix, "linux", "runtime smoke matrix");
  requireSnippet(matrix, "collect:runtime-smoke-evidence", "runtime smoke matrix");
  requireSnippet(matrix, "pack:runtime-smoke-evidence", "runtime smoke matrix");
  requireSnippet(matrix, "import:runtime-smoke-evidence", "runtime smoke matrix");
  requireSnippet(matrix, "handoff:runtime-smoke-evidence", "runtime smoke matrix");
  requireSnippet(matrix, "verify:runtime-smoke-handoff-bundle", "runtime smoke matrix");
  requireSnippet(matrix, "runtime-smoke-set.<platform>.manifest.json", "runtime smoke matrix");
  requireSnippet(matrix, "--windows-manifest", "runtime smoke matrix");
  requireSnippet(matrix, "--manifest-dir", "runtime smoke matrix");
  requireSnippet(agents, "npm run verify:goal-readiness", "AGENTS.md");
  requireSnippet(smokeVerifier, "assertCloudMicrophoneEvidence", "runtime smoke summary verifier");

  const coverage = spawnSync(process.execPath, [path.join(repoRoot, "scripts/test-goal-coverage.js")], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (coverage.status !== 0) {
    throw new Error(`test-goal-coverage failed: ${(coverage.stderr || coverage.stdout).trim()}`);
  }
  requireSnippet(coverage.stdout, "goal coverage contract tests passed (23)", "test-goal-coverage output");

  const evidenceCollector = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts/test-runtime-smoke-evidence-collector.js")],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );
  if (evidenceCollector.status !== 0) {
    throw new Error(
      `test-runtime-smoke-evidence failed: ${(evidenceCollector.stderr || evidenceCollector.stdout).trim()}`
    );
  }
  requireSnippet(
    evidenceCollector.stdout,
    "runtime smoke evidence collector tests passed",
    "test-runtime-smoke-evidence output"
  );

  const evidencePackager = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts/test-runtime-smoke-evidence-packager.js")],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );
  if (evidencePackager.status !== 0) {
    throw new Error(
      `test-runtime-smoke-packager failed: ${(evidencePackager.stderr || evidencePackager.stdout).trim()}`
    );
  }
  requireSnippet(
    evidencePackager.stdout,
    "runtime smoke evidence packager tests passed",
    "test-runtime-smoke-packager output"
  );

  const evidenceImporter = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts/test-runtime-smoke-evidence-importer.js")],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );
  if (evidenceImporter.status !== 0) {
    throw new Error(
      `test-runtime-smoke-importer failed: ${(evidenceImporter.stderr || evidenceImporter.stdout).trim()}`
    );
  }
  requireSnippet(
    evidenceImporter.stdout,
    "runtime smoke evidence importer tests passed",
    "test-runtime-smoke-importer output"
  );

  const evidenceHandoff = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts/test-runtime-smoke-handoff.js")],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );
  if (evidenceHandoff.status !== 0) {
    throw new Error(
      `test-runtime-smoke-handoff failed: ${(evidenceHandoff.stderr || evidenceHandoff.stdout).trim()}`
    );
  }
  requireSnippet(
    evidenceHandoff.stdout,
    "runtime smoke handoff tests passed",
    "test-runtime-smoke-handoff output"
  );

  const evidenceHandoffBundle = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts/test-runtime-smoke-handoff-bundle.js")],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );
  if (evidenceHandoffBundle.status !== 0) {
    throw new Error(
      `test-runtime-smoke-handoff-bundle failed: ${(
        evidenceHandoffBundle.stderr || evidenceHandoffBundle.stdout
      ).trim()}`
    );
  }
  requireSnippet(
    evidenceHandoffBundle.stdout,
    "runtime smoke handoff bundle tests passed",
    "test-runtime-smoke-handoff-bundle output"
  );
}

function manifestSummaries(platform, manifestPath) {
  let parsed;
  try {
    parsed = readJson(manifestPath);
  } catch (error) {
    return {
      errors: [`${platform}: failed to read --${platform}-manifest ${manifestPath}: ${error.message}`],
      summaries: null,
    };
  }

  const manifest = parsed.value;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      errors: [`${platform}: manifest must be a JSON object`],
      summaries: null,
    };
  }
  if (manifest.platform !== platform) {
    return {
      errors: [
        `${platform}: manifest platform mismatch, expected ${platform}, got ${JSON.stringify(
          manifest.platform
        )}`,
      ],
      summaries: null,
    };
  }
  if (!manifest.summaries || typeof manifest.summaries !== "object") {
    return {
      errors: [`${platform}: manifest missing summaries object`],
      summaries: null,
    };
  }
  try {
    assertManifestHasNoSensitivePayload(manifest, platform);
  } catch (error) {
    return {
      errors: [error.message],
      summaries: null,
    };
  }

  const manifestDir = path.dirname(parsed.resolved);
  let summaryRoot;
  try {
    summaryRoot = resolveRelativeBundlePath(
      manifestDir,
      typeof manifest.summarySetDir === "string" ? manifest.summarySetDir : ".",
      `${platform}: manifest summarySetDir`
    );
  } catch (error) {
    return {
      errors: [error.message],
      summaries: null,
    };
  }
  const summaries = {};
  const errors = [];
  for (const kind of summaryKinds) {
    const value = manifest.summaries[kind];
    try {
      summaries[kind] = resolveRelativeBundlePath(summaryRoot, value, `${platform}: manifest summaries.${kind}`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    errors,
    summaries: errors.length > 0 ? null : summaries,
  };
}

function resolvePlatformSummaries(platform, platformOptions) {
  if (!platformOptions?.manifest) {
    return {
      errors: [],
      summaries: platformOptions,
    };
  }
  return manifestSummaries(platform, platformOptions.manifest);
}

function validatePlatformSummaries(platform, summaries) {
  const missing = summaryKinds.filter((kind) => !summaries?.[kind]);
  if (missing.length > 0) {
    return [`${platform}: missing ${missing.map((kind) => `--${platform}-${kind}`).join(", ")}`];
  }

  const args = [
    path.join(repoRoot, "scripts/verify-runtime-smoke-summaries.js"),
    "--require-cloud-microphone",
    "--platform",
    platform,
    "--runtime-probe",
    summaries["runtime-probe"],
    "--native-recording",
    summaries["native-recording"],
    "--dictation-pipeline",
    summaries["dictation-pipeline"],
    "--cloud-preflight",
    summaries["cloud-preflight"],
    "--cloud-transcription",
    summaries["cloud-transcription"],
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return [
      `${platform}: runtime summary verification failed`,
      ...(result.stderr || result.stdout || "").trim().split(/\r?\n/).filter(Boolean),
    ];
  }

  return [];
}

function missingEvidencePlatforms(failures) {
  return platforms.filter((platform) =>
    failures.some((failure) => failure.startsWith(`${platform}: missing --${platform}-`))
  );
}

function readinessFailureHint(options, failures) {
  const missing = missingEvidencePlatforms(failures);
  if (missing.length === 0) {
    return [];
  }

  const manifestDir = options.manifestDir || "<directory-containing-runtime-smoke-evidence-bundles>";
  const platformList = missing.join(",");
  const handoffBundleDir = manifestDir.includes("<")
    ? "<handoff-bundle-dir>"
    : `${manifestDir.replace(/[\\/]+$/, "")}/runtime-smoke-handoff-${missing.join("-")}`;
  return [
    "Next evidence step:",
    `  Missing platform bundles: ${missing.join(", ")}`,
    "  Generate and validate the handoff command bundle:",
    `    npm run handoff:runtime-smoke-evidence -- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang> --cloud-smoke-ms <ms> --platform ${platformList} --manifest-dir ${manifestDir} --bundle-dir ${handoffBundleDir}`,
    `    npm run verify:runtime-smoke-handoff-bundle -- --bundle-dir ${handoffBundleDir}`,
    "  Import each returned platform evidence bundle:",
    `    npm run import:runtime-smoke-evidence -- --source <runtime-smoke-evidence-platform-dir-or-manifest> --manifest-dir ${manifestDir}`,
    "    or use the generated handoff bundle helper:",
    `    ${handoffBundleDir}/import-returned-evidence.ps1 <runtime-smoke-evidence-platform-dir-or-manifest>`,
    `    ${handoffBundleDir}/import-returned-evidence.sh <runtime-smoke-evidence-platform-dir-or-manifest>`,
    "  Rerun this readiness command after importing the missing platform bundles.",
  ];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const failures = [];
  try {
    staticChecks();
  } catch (error) {
    failures.push(error.message);
  }

  for (const platform of platforms) {
    const resolved = resolvePlatformSummaries(platform, options[platform]);
    failures.push(...resolved.errors);
    if (resolved.errors.length > 0) {
      continue;
    }
    if (!requiredLivePlatforms.includes(platform) && !hasPlatformEvidence(options[platform])) {
      continue;
    }
    failures.push(...validatePlatformSummaries(platform, resolved.summaries));
  }

  if (failures.length > 0) {
    console.error("goal readiness failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    const hint = readinessFailureHint(options, failures);
    if (hint.length > 0) {
      console.error("");
      for (const line of hint) {
        console.error(line);
      }
    }
    console.error("");
    console.error(usage());
    process.exit(1);
  }

  console.log(
    `goal readiness passed for ${requiredLivePlatforms.join(", ")} live evidence${
      optionalLivePlatforms.length > 0 ? `; optional ${optionalLivePlatforms.join(", ")} evidence was not required` : ""
    }`
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exit(1);
}
