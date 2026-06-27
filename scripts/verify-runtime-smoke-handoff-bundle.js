#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const platforms = ["windows", "macos", "linux"];
const bundleKind = "typefree-runtime-smoke-handoff-bundle";

function usage() {
  return [
    "Usage:",
    "  node scripts/verify-runtime-smoke-handoff-bundle.js --bundle-dir <handoff-bundle-dir>",
    "",
    "The verifier reads only the handoff bundle. It does not run Tauri, read",
    "credentials, start recording, call providers, or write runtime evidence.",
  ].join("\n");
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
    if (arg === "--bundle-dir" && argv[index + 1]) {
      options.bundleDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
    positional.push(arg);
  }

  if (!options.bundleDir && positional.length > 0) {
    options.bundleDir = positional.shift();
  }
  if (positional.length > 0) {
    throw new Error(`Unexpected positional arguments: ${positional.join(", ")}`);
  }
  if (!options.help && !options.bundleDir) {
    throw new Error("Missing --bundle-dir <handoff-bundle-dir>");
  }
  return options;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveBundlePath(bundleDir, value, context) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context}: expected non-empty relative path`);
  }
  if (path.isAbsolute(value)) {
    throw new Error(`${context}: absolute paths are not allowed in handoff bundle manifests`);
  }

  const resolved = path.resolve(bundleDir, value);
  if (!pathInside(bundleDir, resolved)) {
    throw new Error(`${context}: path must stay inside the handoff bundle`);
  }
  return resolved;
}

function requireFile(filePath, context) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${context}: missing file ${filePath}`);
  }
}

function requireSnippet(text, snippet, context) {
  if (!text.includes(snippet)) {
    throw new Error(`${context}: expected ${snippet}`);
  }
}

function rejectSnippet(text, snippet, context) {
  if (text.includes(snippet)) {
    throw new Error(`${context}: forbidden snippet ${snippet}`);
  }
}

function forbiddenBundleSnippets() {
  return [
    ["API", "KEY"].join("_"),
    ["ACCESS", "TOKEN"].join("_"),
    ["smoke", ["tauri", "dev"].join("-")].join(":"),
    ["smoke", ["runtime", "probe"].join("-")].join(":"),
    ["smoke", ["native", "recording"].join("-")].join(":"),
    ["smoke", ["dictation", "pipeline"].join("-")].join(":"),
    ["smoke", ["cloud", "transcription"].join("-")].join(":"),
    ["smoke", ["cloud", "credential", "preflight"].join("-")].join(":"),
    ["cloud", "speech", "fixture"].join("-"),
    ["cloud", "speaker", "fixture"].join("-"),
    ["allow", "missing", "cloud"].join("-"),
    ["get", "credential"].join("_"),
    ["credential", "Value"].join(""),
    ["token", "Value"].join(""),
    "authorization",
    "curl",
    "wget",
    "Invoke-WebRequest",
    "iwr",
    "WebSocket",
    "node:http",
    "node:https",
    ["run", "tauri", "dev", "smoke"].join("-"),
    ["node scripts/run", "tauri", "dev", "smoke.js"].join("-"),
    ["tauri", "dev"].join(" "),
    "fetch" + "(",
    "processedText",
    "rawText",
    "transcript",
    "transcriptText",
  ];
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

function assertJsonHasNoSensitivePayload(value, context) {
  const forbiddenPayloadKeys = new Set(["text", "transcript", "transcriptText", "rawText", "processedText"]);
  const forbiddenSecretKeyPattern = /(api[_-]?key|access[_-]?token|secret|authorization|credentialValue|tokenValue)/i;

  for (const key of collectObjectKeys(value)) {
    if (forbiddenPayloadKeys.has(key)) {
      throw new Error(`${context}: forbidden payload key ${key}`);
    }
    if (forbiddenSecretKeyPattern.test(key) && !/CredentialKeys$/.test(key)) {
      throw new Error(`${context}: forbidden secret key ${key}`);
    }
  }
}

function assertBundleTextSafety(fileTexts) {
  const forbidden = forbiddenBundleSnippets();
  for (const [label, text] of Object.entries(fileTexts)) {
    for (const snippet of forbidden) {
      rejectSnippet(text, snippet, label);
    }
  }
}

function assertPlatforms(value, context) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${context}: expected at least one platform`);
  }
  const unique = [...new Set(value)];
  if (unique.length !== value.length) {
    throw new Error(`${context}: duplicate platforms are not allowed`);
  }
  for (const platform of value) {
    if (!platforms.includes(platform)) {
      throw new Error(`${context}: invalid platform ${JSON.stringify(platform)}`);
    }
  }
  return value;
}

function assertPlatformCommand(platform, command, context) {
  requireSnippet(command, "npm run collect:runtime-smoke-evidence", context);
  requireSnippet(command, `--platform ${platform}`, context);
  requireSnippet(command, "--cloud-provider", context);
  rejectSnippet(command, "verify:runtime-smoke-summaries", context);
  rejectSnippet(command, "verify:goal-readiness", context);
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

function powershellCommandFileContent(command) {
  return [
    "Set-StrictMode -Version Latest",
    "$ErrorActionPreference = 'Stop'",
    ...powershellRepoRootPrelude(),
    command,
    "",
  ].join("\n");
}

function shellCommandFileContent(command) {
  return ["#!/usr/bin/env sh", "set -eu", ...shellRepoRootPrelude(), command, ""].join("\n");
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

function assertCommandFileContent(filePath, command, shell, context) {
  const actual = readText(filePath);
  const expected = shell === "powershell" ? powershellCommandFileContent(command) : shellCommandFileContent(command);
  if (actual !== expected) {
    throw new Error(`${context}: command file content does not match the expected ${shell} wrapper`);
  }
}

function assertNoUnexpectedScripts(bundleDir, allowedScriptPaths) {
  const allowed = new Set(allowedScriptPaths.map((filePath) => path.resolve(filePath).toLowerCase()));
  const scriptPattern = /\.(sh|ps1|bat|cmd)$/i;
  for (const entry of fs.readdirSync(bundleDir, { withFileTypes: true })) {
    if (!entry.isFile() || !scriptPattern.test(entry.name)) {
      continue;
    }
    const filePath = path.join(bundleDir, entry.name);
    if (!allowed.has(path.resolve(filePath).toLowerCase())) {
      throw new Error(`handoff bundle: unexpected script ${entry.name}`);
    }
  }
}

function resolveManifestFiles(bundleDir, manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("manifest: expected JSON object");
  }
  if (manifest.kind !== bundleKind) {
    throw new Error(`manifest: expected kind ${bundleKind}`);
  }
  if (manifest.schemaVersion !== 3) {
    throw new Error("manifest: expected schemaVersion 3");
  }
  const manifestPlatforms = assertPlatforms(manifest.platforms, "manifest.platforms");
  const files = manifest.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("manifest.files: expected object");
  }
  if (!files.platformCommands || typeof files.platformCommands !== "object") {
    throw new Error("manifest.files.platformCommands: expected object");
  }

  const resolved = {
    importPowershell: resolveBundlePath(
      bundleDir,
      files.importPowershell,
      "manifest.files.importPowershell"
    ),
    importShell: resolveBundlePath(bundleDir, files.importShell, "manifest.files.importShell"),
    json: resolveBundlePath(bundleDir, files.json, "manifest.files.json"),
    manifest: resolveBundlePath(bundleDir, files.manifest, "manifest.files.manifest"),
    markdown: resolveBundlePath(bundleDir, files.markdown, "manifest.files.markdown"),
    platformCommands: {},
    verifyPowershell: resolveBundlePath(
      bundleDir,
      files.verifyPowershell,
      "manifest.files.verifyPowershell"
    ),
    verifyShell: resolveBundlePath(bundleDir, files.verifyShell, "manifest.files.verifyShell"),
  };

  for (const platform of manifestPlatforms) {
    resolved.platformCommands[platform] = resolveBundlePath(
      bundleDir,
      files.platformCommands[platform],
      `manifest.files.platformCommands.${platform}`
    );
  }

  for (const [key, filePath] of Object.entries({
    json: resolved.json,
    importPowershell: resolved.importPowershell,
    importShell: resolved.importShell,
    manifest: resolved.manifest,
    markdown: resolved.markdown,
    verifyPowershell: resolved.verifyPowershell,
    verifyShell: resolved.verifyShell,
    ...resolved.platformCommands,
  })) {
    requireFile(filePath, `manifest.files.${key}`);
  }

  return { manifestPlatforms, resolved };
}

function verifyBundle(bundleDirInput) {
  const bundleDir = path.resolve(bundleDirInput);
  if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) {
    throw new Error(`--bundle-dir must be an existing directory: ${bundleDirInput}`);
  }

  const manifestPath = path.join(bundleDir, "runtime-smoke-handoff.manifest.json");
  requireFile(manifestPath, "handoff bundle manifest");
  const manifest = readJson(manifestPath);
  const { manifestPlatforms, resolved } = resolveManifestFiles(bundleDir, manifest);
  if (path.resolve(resolved.manifest) !== path.resolve(manifestPath)) {
    throw new Error("manifest.files.manifest must point at runtime-smoke-handoff.manifest.json");
  }
  assertJsonHasNoSensitivePayload(manifest, "runtime-smoke-handoff.manifest.json");

  const handoff = readJson(resolved.json);
  assertJsonHasNoSensitivePayload(handoff, "runtime-smoke-handoff.json");
  const handoffPlatforms = assertPlatforms(
    handoff?.platforms?.map((item) => item.platform),
    "runtime-smoke-handoff.json platforms"
  );
  if (handoffPlatforms.join(",") !== manifestPlatforms.join(",")) {
    throw new Error("manifest platforms must match runtime-smoke-handoff.json platforms");
  }
  requireSnippet(
    handoff.strictRequirement || "",
    "--require-cloud-microphone",
    "runtime-smoke-handoff.json strictRequirement"
  );
  requireSnippet(
    handoff.finalReadinessCommand || "",
    "npm run verify:goal-readiness -- --manifest-dir",
    "runtime-smoke-handoff.json finalReadinessCommand"
  );
  requireSnippet(
    handoff.finalReadinessCommands?.powershell || "",
    "npm run verify:goal-readiness -- --manifest-dir",
    "runtime-smoke-handoff.json finalReadinessCommands.powershell"
  );
  requireSnippet(
    handoff.finalReadinessCommands?.sh || "",
    "npm run verify:goal-readiness -- --manifest-dir",
    "runtime-smoke-handoff.json finalReadinessCommands.sh"
  );
  requireSnippet(
    handoff.importCommand || "",
    "npm run import:runtime-smoke-evidence -- --source",
    "runtime-smoke-handoff.json importCommand"
  );
  requireSnippet(handoff.importCommand || "", "--manifest-dir", "runtime-smoke-handoff.json importCommand");
  requireSnippet(
    handoff.importCommands?.powershell || "",
    "npm run import:runtime-smoke-evidence -- --source",
    "runtime-smoke-handoff.json importCommands.powershell"
  );
  requireSnippet(
    handoff.importCommands?.sh || "",
    "npm run import:runtime-smoke-evidence -- --source",
    "runtime-smoke-handoff.json importCommands.sh"
  );

  const fileTexts = {
    "import-returned-evidence.ps1": readText(resolved.importPowershell),
    "import-returned-evidence.sh": readText(resolved.importShell),
    "runtime-smoke-handoff.json": readText(resolved.json),
    "runtime-smoke-handoff.manifest.json": readText(resolved.manifest),
    "runtime-smoke-handoff.md": readText(resolved.markdown),
    "verify-goal-readiness.ps1": readText(resolved.verifyPowershell),
    "verify-goal-readiness.sh": readText(resolved.verifyShell),
  };

  requireSnippet(fileTexts["runtime-smoke-handoff.md"], "--require-cloud-microphone", "handoff markdown");
  requireSnippet(fileTexts["runtime-smoke-handoff.md"], "import-returned-evidence.ps1", "handoff markdown");
  requireSnippet(fileTexts["runtime-smoke-handoff.md"], "import-returned-evidence.sh", "handoff markdown");
  for (const [label, text] of Object.entries({
    "verify-goal-readiness.ps1": fileTexts["verify-goal-readiness.ps1"],
    "verify-goal-readiness.sh": fileTexts["verify-goal-readiness.sh"],
  })) {
    requireSnippet(text, "npm run verify:goal-readiness", label);
    requireSnippet(text, "--manifest-dir", label);
  }
  assertCommandFileContent(
    resolved.verifyPowershell,
    handoff.finalReadinessCommands.powershell,
    "powershell",
    "verify-goal-readiness.ps1"
  );
  assertCommandFileContent(
    resolved.verifyShell,
    handoff.finalReadinessCommands.sh,
    "sh",
    "verify-goal-readiness.sh"
  );
  for (const [label, filePath, shell] of [
    ["import-returned-evidence.ps1", resolved.importPowershell, "powershell"],
    ["import-returned-evidence.sh", resolved.importShell, "sh"],
  ]) {
    const content = readText(filePath);
    requireSnippet(content, "node scripts/import-runtime-smoke-evidence.js", label);
    requireSnippet(content, "--source", label);
    requireSnippet(content, "--manifest-dir", label);
    if (content !== importCommandFileContent(handoff.manifestDir, shell)) {
      throw new Error(`${label}: import command file content does not match the expected ${shell} wrapper`);
    }
  }

  for (const platform of manifestPlatforms) {
    const item = handoff.platforms.find((candidate) => candidate.platform === platform);
    if (!item) {
      throw new Error(`handoff missing platform ${platform}`);
    }
    assertPlatformCommand(platform, item.collectCommand || "", `handoff ${platform} collectCommand`);

    const label = `collect-${platform}`;
    const commandText = readText(resolved.platformCommands[platform]);
    fileTexts[label] = commandText;
    requireSnippet(commandText, item.collectCommand, label);
    assertPlatformCommand(platform, commandText, label);
    assertCommandFileContent(
      resolved.platformCommands[platform],
      item.collectCommand,
      platform === "windows" ? "powershell" : "sh",
      label
    );
  }

  assertNoUnexpectedScripts(bundleDir, [
    resolved.importPowershell,
    resolved.importShell,
    resolved.verifyPowershell,
    resolved.verifyShell,
    ...Object.values(resolved.platformCommands),
  ]);
  assertBundleTextSafety(fileTexts);
  return { bundleDir, platforms: manifestPlatforms };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = verifyBundle(options.bundleDir);
  console.log(`runtime smoke handoff bundle passed (${result.platforms.join(", ")})`);
  console.log(`TYPEFREE_RUNTIME_SMOKE_HANDOFF_BUNDLE_VERIFY ${JSON.stringify(result)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exit(1);
}
