#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const defaultLogDir = path.join(repoRoot, ".codex-run-logs");
const platforms = ["windows", "macos", "linux"];
const summaryKinds = [
  "runtime-probe",
  "native-recording",
  "dictation-pipeline",
  "cloud-preflight",
  "cloud-transcription",
];

function usage() {
  return [
    "Usage:",
    "  node scripts/pack-runtime-smoke-evidence.js --platform <windows|macos|linux> \\",
    "    --runtime-probe <summary.json> \\",
    "    --native-recording <summary.json> \\",
    "    --dictation-pipeline <summary.json> \\",
    "    --cloud-preflight <summary.json> \\",
    "    --cloud-transcription <summary.json>",
    "",
    "Optional:",
    "  Positional fallback: <platform> <runtime-probe> <native-recording> <dictation-pipeline> <cloud-preflight> <cloud-transcription>",
    "  --log-dir <dir>",
    "  --dry-run",
    "",
    "The packer validates the summary set with --require-cloud-microphone,",
    "copies the summaries into a portable bundle, and writes a final-gate manifest.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    logDir: process.env.TAURI_DEV_SMOKE_LOG_DIR || defaultLogDir,
    summaries: {},
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--log-dir" && next) {
      options.logDir = path.resolve(repoRoot, next);
      index += 1;
    } else if (arg === "--platform" && next) {
      options.platform = next.toLowerCase();
      index += 1;
    } else if (arg.startsWith("--")) {
      const kind = arg.slice(2);
      if (!summaryKinds.includes(kind) || !next) {
        throw new Error(`Unknown or incomplete option: ${arg}`);
      }
      options.summaries[kind] = path.resolve(repoRoot, next);
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    const remaining = [...positional];
    if (!options.platform && platforms.includes(String(remaining[0] || "").toLowerCase())) {
      options.platform = remaining.shift().toLowerCase();
    }
    for (const kind of summaryKinds) {
      if (!options.summaries[kind] && remaining.length > 0) {
        options.summaries[kind] = path.resolve(repoRoot, remaining.shift());
      }
    }
    if (remaining.length > 0) {
      throw new Error(`Unexpected positional arguments: ${remaining.join(", ")}`);
    }
  }

  return options;
}

function validateOptions(options) {
  if (options.help) {
    return;
  }
  if (!platforms.includes(options.platform)) {
    throw new Error("Missing or invalid --platform <windows|macos|linux>");
  }

  const missing = summaryKinds.filter((kind) => !options.summaries[kind]);
  if (missing.length > 0) {
    throw new Error(`Missing summary paths: ${missing.map((kind) => `--${kind}`).join(", ")}`);
  }
}

function quoteArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=\\-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function commandLine(args) {
  return [process.execPath, ...args].map(quoteArg).join(" ");
}

function verifierArgs(platform, summaries) {
  return [
    path.join("scripts", "verify-runtime-smoke-summaries.js"),
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
}

function goalReadinessArgs(platform, summaries) {
  return summaryKinds.flatMap((kind) => [`--${platform}-${kind}`, summaries[kind]]);
}

function evidenceDirPath(logDir, platform) {
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const evidenceDir = path.join(logDir, `runtime-smoke-evidence-${platform}-${stamp}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  return evidenceDir;
}

function cleanupUnfinishedEvidenceDir(evidenceDir, logDir, platform) {
  if (!evidenceDir) {
    return;
  }

  const resolvedLogDir = path.resolve(logDir);
  const resolvedEvidenceDir = path.resolve(evidenceDir);
  const expectedPrefix = `runtime-smoke-evidence-${platform}-`;
  const insideLogDir =
    resolvedEvidenceDir === resolvedLogDir ||
    resolvedEvidenceDir.startsWith(`${resolvedLogDir}${path.sep}`);
  const hasExpectedName = path.basename(resolvedEvidenceDir).startsWith(expectedPrefix);

  if (insideLogDir && hasExpectedName) {
    fs.rmSync(resolvedEvidenceDir, { recursive: true, force: true });
  }
}

function copyStableSummaries(evidenceDir, summaries) {
  const stableSummaries = {};
  for (const kind of summaryKinds) {
    const destination = path.join(evidenceDir, `${kind}.summary.json`);
    fs.copyFileSync(summaries[kind], destination);
    stableSummaries[kind] = destination;
  }
  return stableSummaries;
}

function portableSummaryPaths() {
  return Object.fromEntries(summaryKinds.map((kind) => [kind, `${kind}.summary.json`]));
}

function runVerifier(platform, summaries, options) {
  const args = verifierArgs(platform, summaries);
  const display = commandLine(args);
  console.log(`\n[verify-runtime-smoke-summaries] ${display}`);

  if (options.dryRun) {
    return { display };
  }

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
    throw new Error("runtime summary verification failed; refusing to write manifest");
  }
  return { display };
}

function writeManifest(evidenceDir, options, stableSummaries, verifyCommand) {
  const portableSummaries = portableSummaryPaths();
  const manifestPath = path.join(evidenceDir, `runtime-smoke-set.${options.platform}.manifest.json`);
  const manifest = {
    collectedAt: new Date().toISOString(),
    goalReadinessArgs: goalReadinessArgs(options.platform, portableSummaries),
    packedFromExistingSummaries: true,
    platform: options.platform,
    sourceSummaries: options.summaries,
    summaries: portableSummaries,
    summarySetDir: ".",
    summarySourcePaths: stableSummaries,
    verifyCommand,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  validateOptions(options);

  if (options.dryRun) {
    const verification = runVerifier(options.platform, options.summaries, options);
    const result = {
      goalReadinessArgs: goalReadinessArgs(options.platform, portableSummaryPaths()),
      platform: options.platform,
      status: "dry-run",
      verifyCommand: verification.display,
    };
    console.log(`\nTYPEFREE_RUNTIME_SMOKE_PACK_RESULT ${JSON.stringify(result)}`);
    return;
  }

  let evidenceDir;
  let manifest;
  let stableSummaries;
  let verification;

  try {
    evidenceDir = evidenceDirPath(options.logDir, options.platform);
    stableSummaries = copyStableSummaries(evidenceDir, options.summaries);
    verification = runVerifier(options.platform, stableSummaries, options);
    manifest = writeManifest(evidenceDir, options, stableSummaries, verification.display);
  } catch (error) {
    if (!manifest) {
      cleanupUnfinishedEvidenceDir(evidenceDir, options.logDir, options.platform);
    }
    throw error;
  }

  const result = {
    manifest,
    platform: options.platform,
    status: "passed",
    summaries: stableSummaries,
  };

  console.log(`\nruntime smoke evidence packed for ${options.platform}`);
  console.log(`evidence dir: ${evidenceDir}`);
  console.log(`manifest: ${manifest}`);
  console.log(`goal readiness args: ${goalReadinessArgs(options.platform, stableSummaries).join(" ")}`);
  console.log(`TYPEFREE_RUNTIME_SMOKE_PACK_RESULT ${JSON.stringify(result)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exit(1);
}
