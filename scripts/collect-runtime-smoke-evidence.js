#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const defaultLogDir = path.join(repoRoot, ".codex-run-logs");
const platformByNode = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
};
const nodeByPlatform = {
  linux: "linux",
  macos: "darwin",
  windows: "win32",
};
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
    "  node scripts/collect-runtime-smoke-evidence.js --cloud-provider <provider> [options]",
    "",
    "Options:",
    "  --platform <windows|macos|linux>      Override platform label; live runs must match this host",
    "  --cloud-model <model>                 Provider model for the cloud transcription smoke",
    "  --cloud-language <lang>               Language hint for the cloud transcription smoke",
    "  --cloud-smoke-ms <ms>                 Native recording duration for cloud transcription",
    "  --cloud-speaker-fixture               Windows only: play generated speech while recording mic",
    "  --cloud-playback-path <wav>           Play an existing WAV while recording mic",
    "  --timeout-ms <ms>                     Per-smoke runner timeout",
    "  --ready-grace-ms <ms>                 Per-smoke runner ready grace",
    "  --log-dir <dir>                       Summary and manifest directory",
    "  --dry-run                            Print commands without running Tauri",
    "",
    "The collector runs runtime-probe, native-recording, dictation-pipeline,",
    "cloud-credential-preflight, and cloud-transcription, then validates the",
    "summary set with --require-cloud-microphone.",
  ].join("\n");
}

function optionValue(value) {
  const text = String(value || "").trim();
  return text && text !== "true" ? text : "";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(name) {
  const value = process.env[name];
  return value === "1" || value === "true";
}

function parseArgs(argv) {
  const options = {
    cloudProvider:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_PROVIDER) ||
      optionValue(process.env.npm_config_cloud_provider),
    cloudModel:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MODEL) ||
      optionValue(process.env.npm_config_cloud_model),
    cloudLanguage:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_LANGUAGE) ||
      optionValue(process.env.npm_config_cloud_language),
    cloudSmokeMs:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MS) ||
      optionValue(process.env.npm_config_cloud_smoke_ms),
    cloudSpeakerFixture:
      envFlag("TYPEFREE_CLOUD_TRANSCRIPTION_SPEAKER_FIXTURE") ||
      envFlag("npm_config_cloud_speaker_fixture"),
    cloudPlaybackPath:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_PLAYBACK_PATH) ||
      optionValue(process.env.npm_config_cloud_playback_path),
    dryRun: false,
    logDir: process.env.TAURI_DEV_SMOKE_LOG_DIR || defaultLogDir,
    platform:
      optionValue(process.env.TYPEFREE_RUNTIME_SMOKE_PLATFORM) ||
      optionValue(process.env.npm_config_platform) ||
      platformByNode[process.platform] ||
      "",
    readyGraceMs: parsePositiveInteger(
      process.env.TAURI_DEV_SMOKE_READY_GRACE_MS || process.env.npm_config_ready_grace_ms,
      2000
    ),
    timeoutMs: parsePositiveInteger(
      process.env.TAURI_DEV_SMOKE_TIMEOUT_MS || process.env.npm_config_timeout_ms,
      180000
    ),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--cloud-speaker-fixture") {
      options.cloudSpeakerFixture = true;
    } else if (arg === "--platform" && next) {
      options.platform = next.toLowerCase();
      index += 1;
    } else if (arg === "--cloud-provider" && next) {
      options.cloudProvider = next;
      index += 1;
    } else if (arg === "--cloud-model" && next) {
      options.cloudModel = next;
      index += 1;
    } else if (arg === "--cloud-language" && next) {
      options.cloudLanguage = next;
      index += 1;
    } else if (arg === "--cloud-smoke-ms" && next) {
      options.cloudSmokeMs = next;
      index += 1;
    } else if (arg === "--cloud-playback-path" && next) {
      options.cloudPlaybackPath = path.resolve(repoRoot, next);
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      options.timeoutMs = parsePositiveInteger(next, options.timeoutMs);
      index += 1;
    } else if (arg === "--ready-grace-ms" && next) {
      options.readyGraceMs = parsePositiveInteger(next, options.readyGraceMs);
      index += 1;
    } else if (arg === "--log-dir" && next) {
      options.logDir = path.resolve(repoRoot, next);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
  }

  return options;
}

function validateOptions(options) {
  if (options.help) {
    return;
  }

  if (!nodeByPlatform[options.platform]) {
    throw new Error("Missing or invalid --platform <windows|macos|linux>");
  }

  if (!options.cloudProvider) {
    throw new Error("Missing --cloud-provider <provider>");
  }

  const detectedPlatform = platformByNode[process.platform];
  if (!options.dryRun && detectedPlatform && options.platform !== detectedPlatform) {
    throw new Error(
      `Platform mismatch: --platform ${options.platform} cannot be collected on ${detectedPlatform}`
    );
  }

  if (options.cloudSpeakerFixture && options.platform !== "windows") {
    throw new Error("--cloud-speaker-fixture is only valid for Windows evidence collection");
  }

  if (options.cloudSpeakerFixture && options.cloudPlaybackPath) {
    throw new Error("--cloud-speaker-fixture cannot be combined with --cloud-playback-path");
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

function runnerArgs(modeFlag, options) {
  const args = [
    path.join("scripts", "run-tauri-dev-smoke.js"),
    modeFlag,
    "--timeout-ms",
    String(options.timeoutMs),
    "--ready-grace-ms",
    String(options.readyGraceMs),
    "--log-dir",
    options.logDir,
  ];

  if (modeFlag === "--cloud-credential-preflight" || modeFlag === "--cloud-transcription-smoke") {
    args.push("--cloud-provider", options.cloudProvider);
    if (options.cloudModel) {
      args.push("--cloud-model", options.cloudModel);
    }
    if (options.cloudLanguage) {
      args.push("--cloud-language", options.cloudLanguage);
    }
  }

  if (modeFlag === "--cloud-transcription-smoke") {
    if (options.cloudSmokeMs) {
      args.push("--cloud-smoke-ms", options.cloudSmokeMs);
    }
    if (options.cloudSpeakerFixture) {
      args.push("--cloud-speaker-fixture");
    }
    if (options.cloudPlaybackPath) {
      args.push("--cloud-playback-path", options.cloudPlaybackPath);
    }
  }

  return args;
}

function extractSummaryPath(output) {
  const matches = [...String(output || "").matchAll(/^summary:\s*(.+?\.summary\.json)\s*$/gim)];
  if (matches.length === 0) {
    return "";
  }
  return path.resolve(matches[matches.length - 1][1].trim());
}

function runCommand(label, args, options, commandOptions = {}) {
  const expectSummary = commandOptions.expectSummary !== false;
  const display = commandLine(args);
  console.log(`\n[${label}] ${display}`);

  if (options.dryRun) {
    return {
      display,
      ...(expectSummary ? { summaryPath: `<${label}.summary.json>` } : {}),
    };
  }

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const summaryPath = extractSummaryPath(output);
  if (result.status !== 0) {
    throw new Error(`${label} failed${summaryPath ? `; summary: ${summaryPath}` : ""}`);
  }
  if (!expectSummary) {
    return { display };
  }
  if (!summaryPath) {
    throw new Error(`${label} passed without printing a summary path`);
  }

  return { display, summaryPath };
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

function writeManifest(evidenceDir, options, sourceSummaries, stableSummaries, commands, verifyCommand) {
  const filePath = path.join(evidenceDir, `runtime-smoke-set.${options.platform}.manifest.json`);
  const portableSummaries = portableSummaryPaths();
  const manifest = {
    collectedAt: new Date().toISOString(),
    cloudLanguage: options.cloudLanguage || null,
    cloudModel: options.cloudModel || null,
    cloudPlaybackPath: options.cloudPlaybackPath || null,
    cloudProvider: options.cloudProvider,
    cloudSmokeMs: options.cloudSmokeMs || null,
    cloudSpeakerFixture: options.cloudSpeakerFixture,
    commands,
    goalReadinessArgs: goalReadinessArgs(options.platform, portableSummaries),
    nodePlatform: process.platform,
    platform: options.platform,
    sourceSummaries,
    summaries: portableSummaries,
    summarySetDir: ".",
    summarySourcePaths: stableSummaries,
    verifyCommand,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { evidenceDir, filePath };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  validateOptions(options);

  const steps = [
    ["runtime-probe", "--runtime-probe"],
    ["native-recording", "--native-recording-smoke"],
    ["dictation-pipeline", "--dictation-pipeline-smoke"],
    ["cloud-preflight", "--cloud-credential-preflight"],
    ["cloud-transcription", "--cloud-transcription-smoke"],
  ];
  const summaries = {};
  const commands = {};

  for (const [kind, flag] of steps) {
    const result = runCommand(kind, runnerArgs(flag, options), options);
    summaries[kind] = result.summaryPath;
    commands[kind] = result.display;
  }

  const verifyArgs = verifierArgs(options.platform, summaries);
  const verification = runCommand(
    "verify-runtime-smoke-summaries",
    verifyArgs,
    {
      ...options,
      dryRun: options.dryRun,
    },
    { expectSummary: false }
  );

  if (options.dryRun) {
    const result = {
      commands,
      goalReadinessArgs: goalReadinessArgs(options.platform, summaries),
      platform: options.platform,
      status: "dry-run",
      verifyCommand: verification.display,
    };
    console.log(`\nTYPEFREE_RUNTIME_SMOKE_EVIDENCE_RESULT ${JSON.stringify(result)}`);
    return;
  }

  let evidenceDir;
  let evidenceManifest;
  let stableSummaries;

  try {
    evidenceDir = evidenceDirPath(options.logDir, options.platform);
    stableSummaries = copyStableSummaries(evidenceDir, summaries);
    evidenceManifest = writeManifest(
      evidenceDir,
      options,
      summaries,
      stableSummaries,
      commands,
      verification.display
    );
  } catch (error) {
    if (!evidenceManifest) {
      cleanupUnfinishedEvidenceDir(evidenceDir, options.logDir, options.platform);
    }
    throw error;
  }

  const result = {
    manifest: evidenceManifest.filePath,
    platform: options.platform,
    status: "passed",
    summaries: stableSummaries,
  };
  console.log(`\nruntime smoke evidence collected for ${options.platform}`);
  console.log(`evidence dir: ${evidenceManifest.evidenceDir}`);
  console.log(`manifest: ${evidenceManifest.filePath}`);
  console.log(`goal readiness args: ${goalReadinessArgs(options.platform, stableSummaries).join(" ")}`);
  console.log(`TYPEFREE_RUNTIME_SMOKE_EVIDENCE_RESULT ${JSON.stringify(result)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exit(1);
}
