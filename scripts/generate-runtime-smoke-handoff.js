#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const platforms = ["windows", "macos", "linux"];

function usage() {
  return [
    "Usage:",
    "  node scripts/generate-runtime-smoke-handoff.js --cloud-provider <provider> [options]",
    "",
    "Options:",
    "  --platform <windows|macos|linux|all>  Target platform; may be repeated",
    "  --cloud-model <model>                 Provider model for the cloud transcription smoke",
    "  --cloud-language <lang>               Language hint for the cloud transcription smoke",
    "  --cloud-smoke-ms <ms>                 Native recording duration for cloud transcription",
    "  --manifest-dir <dir>                  Integration directory containing platform bundles",
    "  --format <markdown|json>              Output format",
    "  --output <file>                       Also write the handoff to a file",
    "  --bundle-dir <dir>                    Write markdown, json, and command files",
    "",
    "The handoff only prints or writes commands. It does not run Tauri, read",
    "secrets, start recording, call providers, or write runtime evidence.",
  ].join("\n");
}

function optionValue(value) {
  const text = String(value || "").trim();
  return text && text !== "true" ? text : "";
}

function isBareShellValue(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=\\-]+$/.test(text);
}

function quoteShArg(value) {
  const text = String(value);
  if (isBareShellValue(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\"'\"'")}'`;
}

function quotePowerShellArg(value) {
  const text = String(value);
  if (isBareShellValue(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "''")}'`;
}

function quoteShellArg(value, shell) {
  return shell === "powershell" ? quotePowerShellArg(value) : quoteShArg(value);
}

function shellForPlatform(platform) {
  return platform === "windows" ? "powershell" : "sh";
}

function parsePlatforms(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "all") {
    return platforms;
  }

  const selected = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const platform of selected) {
    if (!platforms.includes(platform)) {
      throw new Error("Invalid --platform <windows|macos|linux|all>");
    }
  }
  return selected;
}

function isPlatformFallback(value) {
  try {
    parsePlatforms(value);
    return true;
  } catch {
    return false;
  }
}

function looksLikeOutputFile(value) {
  return /\.(md|markdown|json|txt)$/i.test(String(value || ""));
}

function looksLikeBundleDir(value) {
  return /(?:handoff|bundle)/i.test(path.basename(String(value || "")));
}

function unique(values) {
  return [...new Set(values)];
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
    format: optionValue(process.env.TYPEFREE_RUNTIME_SMOKE_HANDOFF_FORMAT) || "markdown",
    bundleDir: optionValue(process.env.TYPEFREE_RUNTIME_SMOKE_HANDOFF_BUNDLE_DIR),
    manifestDir: optionValue(process.env.TYPEFREE_RUNTIME_SMOKE_MANIFEST_DIR) || ".codex-run-logs",
    outputPath: optionValue(process.env.TYPEFREE_RUNTIME_SMOKE_HANDOFF_OUTPUT),
    platforms: [],
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--platform" && next) {
      options.platforms.push(...parsePlatforms(next));
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
    } else if (arg === "--manifest-dir" && next) {
      options.manifestDir = next;
      index += 1;
    } else if (arg === "--format" && next) {
      options.format = next;
      index += 1;
    } else if (arg === "--output" && next) {
      options.outputPath = path.resolve(repoRoot, next);
      index += 1;
    } else if (arg === "--bundle-dir" && next) {
      options.bundleDir = path.resolve(repoRoot, next);
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (!options.cloudProvider && positional.length > 0) {
    options.cloudProvider = positional.shift();
  }
  if (!options.cloudModel && positional.length > 0) {
    options.cloudModel = positional.shift();
  }
  if (!options.cloudLanguage && positional.length > 0) {
    options.cloudLanguage = positional.shift();
  }
  if (!options.cloudSmokeMs && positional.length > 0) {
    options.cloudSmokeMs = positional.shift();
  }

  const remaining = [];
  for (const value of positional) {
    if (isPlatformFallback(value)) {
      options.platforms.push(...parsePlatforms(value));
    } else {
      remaining.push(value);
    }
  }
  positional.length = 0;

  for (const value of remaining) {
    if (!options.outputPath && looksLikeOutputFile(value)) {
      options.outputPath = path.resolve(repoRoot, value);
    } else if (!options.bundleDir && looksLikeBundleDir(value)) {
      options.bundleDir = path.resolve(repoRoot, value);
    } else if (options.manifestDir === ".codex-run-logs" && !looksLikeOutputFile(value)) {
      options.manifestDir = value;
    } else {
      positional.push(value);
    }
  }

  if (positional.length > 0) {
    throw new Error(`Unexpected positional arguments: ${positional.join(", ")}`);
  }

  options.platforms = unique(options.platforms.length > 0 ? options.platforms : platforms);
  options.format = String(options.format || "markdown").toLowerCase();
  return options;
}

function validateOptions(options) {
  if (options.help) {
    return;
  }
  if (!options.cloudProvider) {
    throw new Error("Missing --cloud-provider <provider>");
  }
  if (!["markdown", "json"].includes(options.format)) {
    throw new Error("Invalid --format <markdown|json>");
  }
}

function collectCommand(platform, options) {
  const shell = shellForPlatform(platform);
  const args = ["npm", "run", "collect:runtime-smoke-evidence", "--", "--platform", platform, "--cloud-provider", options.cloudProvider];

  if (options.cloudModel) {
    args.push("--cloud-model", options.cloudModel);
  }
  if (options.cloudLanguage) {
    args.push("--cloud-language", options.cloudLanguage);
  }
  if (options.cloudSmokeMs) {
    args.push("--cloud-smoke-ms", options.cloudSmokeMs);
  }

  return args
    .map((arg, index) => (index < 4 || String(arg).startsWith("--") ? String(arg) : quoteShellArg(arg, shell)))
    .join(" ");
}

function finalReadinessCommand(options, shell = "sh") {
  const args = [
    "npm",
    "run",
    "verify:goal-readiness",
    "--",
    "--manifest-dir",
    options.manifestDir,
  ];
  return args
    .map((arg, index) => (index < 4 || String(arg).startsWith("--") ? String(arg) : quoteShellArg(arg, shell)))
    .join(" ");
}

function importCommand(options, shell = "sh") {
  const args = [
    "npm",
    "run",
    "import:runtime-smoke-evidence",
    "--",
    "--source",
    "<runtime-smoke-evidence-platform-dir-or-manifest>",
    "--manifest-dir",
    options.manifestDir,
  ];
  return args
    .map((arg, index) => (index < 4 || String(arg).startsWith("--") ? String(arg) : quoteShellArg(arg, shell)))
    .join(" ");
}

function buildHandoff(options) {
  const finalReadinessCommands = {
    powershell: finalReadinessCommand(options, "powershell"),
    sh: finalReadinessCommand(options, "sh"),
  };
  const importCommands = {
    powershell: importCommand(options, "powershell"),
    sh: importCommand(options, "sh"),
  };
  return {
    cwd: repoRoot,
    finalReadinessCommand: finalReadinessCommands.sh,
    finalReadinessCommands,
    importCommand: importCommands.sh,
    importCommands,
    manifestDir: options.manifestDir,
    platforms: options.platforms.map((platform) => ({
      collectCommand: collectCommand(platform, options),
      platform,
      producedBundle: `runtime-smoke-evidence-${platform}-<timestamp>/`,
      producedManifest: `runtime-smoke-set.${platform}.manifest.json`,
    })),
    strictRequirement:
      "The final gate delegates to verify-runtime-smoke-summaries --require-cloud-microphone for every platform.",
    transferInstruction:
      `Import each produced runtime-smoke-evidence-<platform>-<timestamp>/ directory with the generated import-returned-evidence helper scripts, or with npm run import:runtime-smoke-evidence -- --source <bundle> --manifest-dir ${options.manifestDir}, before running the final readiness command.`,
  };
}

function renderMarkdown(handoff) {
  const lines = [
    "# Runtime Smoke Evidence Handoff",
    "",
    `Workspace: \`${handoff.cwd}\``,
    "",
    "Run the matching command on each target OS:",
    "",
  ];

  for (const item of handoff.platforms) {
    lines.push(
      `## ${item.platform}`,
      "",
      "```sh",
      item.collectCommand,
      "```",
      "",
      `Expected bundle: \`${item.producedBundle}${item.producedManifest}\``,
      ""
    );
  }

  lines.push(
    "After all platform bundles return to the integration machine, import each bundle:",
    "",
    "```sh",
    handoff.importCommand,
    "```",
    "",
    "Or use the generated helper scripts from this bundle, run from the integration repo root:",
    "",
    "```powershell",
    "<handoff-bundle-dir>/import-returned-evidence.ps1 <runtime-smoke-evidence-platform-dir-or-manifest>",
    "```",
    "",
    "```sh",
    "<handoff-bundle-dir>/import-returned-evidence.sh <runtime-smoke-evidence-platform-dir-or-manifest>",
    "```",
    "",
    "Then run final readiness:",
    "",
    "```sh",
    handoff.finalReadinessCommand,
    "```",
    "",
    handoff.strictRequirement,
    handoff.transferInstruction
  );

  return `${lines.join("\n")}\n`;
}

function renderHandoff(handoff, format) {
  if (format === "json") {
    return `${JSON.stringify(handoff, null, 2)}\n`;
  }
  return renderMarkdown(handoff);
}

function writeOutput(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function bundleRelativePath(bundleDir, filePath) {
  return path.relative(bundleDir, filePath).replace(/\\/g, "/");
}

function powershellRepoRootPrelude() {
  return [
    "function Test-TypeFreeRepoRoot([string]$Path) {",
    "  return $Path -and (Test-Path -LiteralPath (Join-Path $Path 'package.json')) -and (Test-Path -LiteralPath (Join-Path $Path 'scripts/import-runtime-smoke-evidence.js')) -and (Test-Path -LiteralPath (Join-Path $Path 'scripts/verify-goal-readiness.js'))",
    "}",
    "function Find-TypeFreeRepoRoot([string]$StartPath) {",
    "  $candidate = $StartPath",
    "  while ($candidate) {",
    "    if (Test-TypeFreeRepoRoot $candidate) { return $candidate }",
    "    $parent = Split-Path -Parent $candidate",
    "    if (-not $parent -or $parent -eq $candidate) { break }",
    "    $candidate = $parent",
    "  }",
    "  return $null",
    "}",
    "$scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }",
    "$repoRoot = Find-TypeFreeRepoRoot (Get-Location).Path",
    "if (-not $repoRoot) { $repoRoot = Find-TypeFreeRepoRoot (Split-Path -Parent $scriptPath) }",
    "if (-not $repoRoot) { throw 'Unable to locate TypeFree repo root from the current directory or handoff script path.' }",
    "Set-Location -LiteralPath $repoRoot",
  ];
}

function shellRepoRootPrelude() {
  return [
    "is_typefree_repo_root() {",
    '  [ -f "$1/package.json" ] && [ -f "$1/scripts/import-runtime-smoke-evidence.js" ] && [ -f "$1/scripts/verify-goal-readiness.js" ]',
    "}",
    "find_typefree_repo_root() {",
    '  candidate="$1"',
    '  while [ -n "$candidate" ]; do',
    '    if is_typefree_repo_root "$candidate"; then',
    '      printf "%s\\n" "$candidate"',
    "      return 0",
    "    fi",
    '    parent=$(dirname "$candidate")',
    '    if [ "$parent" = "$candidate" ]; then',
    "      break",
    "    fi",
    '    candidate="$parent"',
    "  done",
    "  return 1",
    "}",
    'script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)',
    'repo_root=$(find_typefree_repo_root "$(pwd -P)" || true)',
    'if [ -z "$repo_root" ]; then',
    '  repo_root=$(find_typefree_repo_root "$script_dir" || true)',
    "fi",
    'if [ -z "$repo_root" ]; then',
    '  echo "Unable to locate TypeFree repo root from the current directory or handoff script path." >&2',
    "  exit 2",
    "fi",
    'cd "$repo_root"',
  ];
}

function commandFileContent(command, shell) {
  if (shell === "powershell") {
    return [
      "Set-StrictMode -Version Latest",
      "$ErrorActionPreference = 'Stop'",
      ...powershellRepoRootPrelude(),
      command,
      "",
    ].join("\n");
  }

  return ["#!/usr/bin/env sh", "set -eu", ...shellRepoRootPrelude(), command, ""].join("\n");
}

function importCommandFileContent(manifestDir, shell) {
  if (shell === "powershell") {
    return [
      "Set-StrictMode -Version Latest",
      "$ErrorActionPreference = 'Stop'",
      ...powershellRepoRootPrelude(),
      "if ($args.Count -lt 1) { throw 'Usage: .\\import-returned-evidence.ps1 <runtime-smoke-evidence-platform-dir-or-manifest>' }",
      `node scripts/import-runtime-smoke-evidence.js --source $args[0] --manifest-dir ${quotePowerShellArg(manifestDir)}`,
      "",
    ].join("\n");
  }

  return [
    "#!/usr/bin/env sh",
    "set -eu",
    ...shellRepoRootPrelude(),
    "if [ \"$#\" -lt 1 ]; then",
    "  echo \"Usage: ./import-returned-evidence.sh <runtime-smoke-evidence-platform-dir-or-manifest>\" >&2",
    "  exit 2",
    "fi",
    `node scripts/import-runtime-smoke-evidence.js --source "$1" --manifest-dir ${quoteShArg(manifestDir)}`,
    "",
  ].join("\n");
}

function writeBundle(bundleDir, handoff) {
  fs.mkdirSync(bundleDir, { recursive: true });
  const files = {
    importPowershell: path.join(bundleDir, "import-returned-evidence.ps1"),
    importShell: path.join(bundleDir, "import-returned-evidence.sh"),
    json: path.join(bundleDir, "runtime-smoke-handoff.json"),
    manifest: path.join(bundleDir, "runtime-smoke-handoff.manifest.json"),
    markdown: path.join(bundleDir, "runtime-smoke-handoff.md"),
    platformCommands: {},
    verifyPowershell: path.join(bundleDir, "verify-goal-readiness.ps1"),
    verifyShell: path.join(bundleDir, "verify-goal-readiness.sh"),
  };

  fs.writeFileSync(files.markdown, renderMarkdown(handoff));
  fs.writeFileSync(files.json, `${JSON.stringify(handoff, null, 2)}\n`);

  for (const item of handoff.platforms) {
    const fileName = item.platform === "windows"
      ? `collect-${item.platform}.ps1`
      : `collect-${item.platform}.sh`;
    const shell = item.platform === "windows" ? "powershell" : "sh";
    const filePath = path.join(bundleDir, fileName);
    fs.writeFileSync(filePath, commandFileContent(item.collectCommand, shell));
    files.platformCommands[item.platform] = filePath;
  }

  fs.writeFileSync(files.verifyPowershell, commandFileContent(handoff.finalReadinessCommands.powershell, "powershell"));
  fs.writeFileSync(files.verifyShell, commandFileContent(handoff.finalReadinessCommands.sh, "sh"));
  fs.writeFileSync(files.importPowershell, importCommandFileContent(handoff.manifestDir, "powershell"));
  fs.writeFileSync(files.importShell, importCommandFileContent(handoff.manifestDir, "sh"));

  const manifest = {
    files: {
      importPowershell: bundleRelativePath(bundleDir, files.importPowershell),
      importShell: bundleRelativePath(bundleDir, files.importShell),
      json: bundleRelativePath(bundleDir, files.json),
      manifest: bundleRelativePath(bundleDir, files.manifest),
      markdown: bundleRelativePath(bundleDir, files.markdown),
      platformCommands: Object.fromEntries(
        Object.entries(files.platformCommands).map(([platform, filePath]) => [
          platform,
          bundleRelativePath(bundleDir, filePath),
        ])
      ),
      verifyPowershell: bundleRelativePath(bundleDir, files.verifyPowershell),
      verifyShell: bundleRelativePath(bundleDir, files.verifyShell),
    },
    generatedAt: new Date().toISOString(),
    kind: "typefree-runtime-smoke-handoff-bundle",
    manifestDir: handoff.manifestDir,
    platforms: handoff.platforms.map((item) => item.platform),
    schemaVersion: 3,
    strictRequirement: handoff.strictRequirement,
  };
  fs.writeFileSync(files.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  return files;
}

function printResult(handoff, options, content) {
  let bundleFiles = null;
  if (options.bundleDir) {
    bundleFiles = writeBundle(options.bundleDir, handoff);
    console.log(`handoff bundle written: ${options.bundleDir}`);
  }
  if (options.outputPath) {
    writeOutput(options.outputPath, content);
    console.log(`handoff written: ${options.outputPath}`);
  } else if (!options.bundleDir) {
    process.stdout.write(content);
  }
  const result = bundleFiles
    ? { ...handoff, bundleDir: options.bundleDir, bundleFiles }
    : handoff;
  console.log(`TYPEFREE_RUNTIME_SMOKE_HANDOFF ${JSON.stringify(result)}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  validateOptions(options);

  const handoff = buildHandoff(options);
  printResult(handoff, options, renderHandoff(handoff, options.format));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exit(1);
}
