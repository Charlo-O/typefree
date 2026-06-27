#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const defaultLogDir = path.join(repoRoot, ".codex-run-logs");
const runtimeProbeSentinel = "TYPEFREE_RUNTIME_PROBE_RESULT";
const nativeRecordingSmokeSentinel = "TYPEFREE_NATIVE_RECORDING_SMOKE_RESULT";
const dictationPipelineSmokeSentinel = "TYPEFREE_DICTATION_PIPELINE_SMOKE_RESULT";
const cloudTranscriptionSmokeSentinel = "TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_RESULT";
const cloudCredentialPreflightSentinel = "TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_RESULT";

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionValue(value) {
  const text = String(value || "").trim();
  return text && text !== "true" ? text : "";
}

function parseArgs(argv) {
  const options = {
    timeoutMs: parsePositiveInteger(
      process.env.TAURI_DEV_SMOKE_TIMEOUT_MS || process.env.npm_config_timeout_ms,
      180000
    ),
    readyGraceMs: parsePositiveInteger(
      process.env.TAURI_DEV_SMOKE_READY_GRACE_MS || process.env.npm_config_ready_grace_ms,
      2000
    ),
    logDir: process.env.TAURI_DEV_SMOKE_LOG_DIR || defaultLogDir,
    runtimeProbe: false,
    nativeRecordingSmoke: false,
    dictationPipelineSmoke: false,
    cloudTranscriptionSmoke: false,
    cloudCredentialPreflight: false,
    cloudSpeechFixture:
      process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SPEECH_FIXTURE === "1" ||
      process.env.npm_config_cloud_speech_fixture === "true",
    cloudSpeakerFixture:
      process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SPEAKER_FIXTURE === "1" ||
      process.env.npm_config_cloud_speaker_fixture === "true",
    cloudTranscriptionProvider:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_PROVIDER) ||
      optionValue(process.env.npm_config_cloud_provider) ||
      "",
    cloudTranscriptionModel:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MODEL) ||
      optionValue(process.env.npm_config_cloud_model) ||
      "",
    cloudTranscriptionLanguage:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_LANGUAGE) ||
      optionValue(process.env.npm_config_cloud_language) ||
      "",
    cloudTranscriptionSmokeMs:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MS) ||
      optionValue(process.env.npm_config_cloud_smoke_ms) ||
      "",
    cloudTranscriptionFixturePath:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_FIXTURE_PATH) ||
      optionValue(process.env.npm_config_cloud_fixture_path) ||
      "",
    cloudTranscriptionPlaybackPath:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_PLAYBACK_PATH) ||
      optionValue(process.env.npm_config_cloud_playback_path) ||
      "",
    cloudTranscriptionFixtureText:
      optionValue(process.env.TYPEFREE_CLOUD_TRANSCRIPTION_FIXTURE_TEXT) ||
      optionValue(process.env.npm_config_cloud_fixture_text) ||
      "typefree cloud transcription smoke test",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (/^\d+$/.test(arg)) {
      options.timeoutMs = parsePositiveInteger(arg, options.timeoutMs);
    } else if (arg === "--timeout-ms" && next) {
      options.timeoutMs = parsePositiveInteger(next, options.timeoutMs);
      index += 1;
    } else if (arg === "--ready-grace-ms" && next) {
      options.readyGraceMs = parsePositiveInteger(next, options.readyGraceMs);
      index += 1;
    } else if (arg === "--log-dir" && next) {
      options.logDir = path.resolve(repoRoot, next);
      index += 1;
    } else if (arg === "--runtime-probe") {
      options.runtimeProbe = true;
    } else if (arg === "--native-recording-smoke") {
      options.nativeRecordingSmoke = true;
    } else if (arg === "--dictation-pipeline-smoke") {
      options.dictationPipelineSmoke = true;
    } else if (arg === "--cloud-transcription-smoke") {
      options.cloudTranscriptionSmoke = true;
    } else if (arg === "--cloud-credential-preflight") {
      options.cloudCredentialPreflight = true;
    } else if (arg === "--cloud-provider" && next) {
      options.cloudTranscriptionProvider = next;
      index += 1;
    } else if (arg === "--cloud-model" && next) {
      options.cloudTranscriptionModel = next;
      index += 1;
    } else if (arg === "--cloud-language" && next) {
      options.cloudTranscriptionLanguage = next;
      index += 1;
    } else if (arg === "--cloud-smoke-ms" && next) {
      options.cloudTranscriptionSmokeMs = next;
      index += 1;
    } else if (arg === "--cloud-speech-fixture") {
      options.cloudSpeechFixture = true;
    } else if (arg === "--cloud-speaker-fixture") {
      options.cloudSpeakerFixture = true;
    } else if (arg === "--cloud-fixture-path" && next) {
      options.cloudTranscriptionFixturePath = next;
      index += 1;
    } else if (arg === "--cloud-playback-path" && next) {
      options.cloudTranscriptionPlaybackPath = next;
      index += 1;
    } else if (arg === "--cloud-fixture-text" && next) {
      options.cloudTranscriptionFixtureText = next;
      index += 1;
    } else if (
      !arg.startsWith("-") &&
      !options.cloudTranscriptionProvider &&
      (options.cloudTranscriptionSmoke || options.cloudCredentialPreflight)
    ) {
      options.cloudTranscriptionProvider = arg;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node scripts/run-tauri-dev-smoke.js [--runtime-probe|--native-recording-smoke|--dictation-pipeline-smoke|--cloud-transcription-smoke|--cloud-credential-preflight] [--cloud-provider openai] [--cloud-model model] [--cloud-language en] [--cloud-smoke-ms 3500] [--cloud-speech-fixture|--cloud-speaker-fixture] [--cloud-fixture-text text] [--timeout-ms 180000] [--ready-grace-ms 2000] [--log-dir .codex-run-logs]",
          "",
          "Starts npm run tauri:dev, waits for Vite, Cargo, and the Tauri app-running signal,",
          "optionally waits for a Developer diagnostics sentinel, writes logs, then",
          "terminates the process tree.",
        ].join("\n")
      );
      process.exit(0);
    }
  }

  const selectedSmokeModes = [
    options.runtimeProbe,
    options.nativeRecordingSmoke,
    options.dictationPipelineSmoke,
    options.cloudTranscriptionSmoke,
    options.cloudCredentialPreflight,
  ].filter(Boolean).length;
  if (selectedSmokeModes > 1) {
    throw new Error(
      "Choose only one smoke mode: --runtime-probe, --native-recording-smoke, --dictation-pipeline-smoke, --cloud-transcription-smoke, or --cloud-credential-preflight"
    );
  }

  return options;
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function tailLines(text, count = 80) {
  return stripAnsi(text).split(/\r?\n/).slice(-count).join("\n");
}

function createLogPaths(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  return {
    stdout: path.join(logDir, `tauri-dev-smoke-${stamp}.out.log`),
    stderr: path.join(logDir, `tauri-dev-smoke-${stamp}.err.log`),
    summary: path.join(logDir, `tauri-dev-smoke-${stamp}.summary.json`),
    smokeConfig: path.join(logDir, `tauri-smoke-${stamp}.conf.json`),
    cloudSpeechFixture: path.join(logDir, `tauri-cloud-speech-fixture-${stamp}.wav`),
    cloudSpeakerFixture: path.join(logDir, `tauri-cloud-speaker-fixture-${stamp}.wav`),
  };
}

function quotePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function writeWindowsSpeechFixture(fixturePath, text) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)",
    `$s.SetOutputToWaveFile('${quotePowerShellSingleQuoted(fixturePath)}', $format)`,
    `$s.Speak('${quotePowerShellSingleQuoted(text)}')`,
    "$s.Dispose()",
  ].join("; ");

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to generate Windows speech fixture: ${result.stderr || result.stdout || result.status}`
    );
  }
}

function prepareCloudSpeechFixture(options, fixturePath) {
  if (options.cloudSpeechFixture && options.cloudSpeakerFixture) {
    throw new Error("--cloud-speech-fixture and --cloud-speaker-fixture are mutually exclusive");
  }
  if (options.cloudTranscriptionFixturePath && (options.cloudSpeakerFixture || options.cloudTranscriptionPlaybackPath)) {
    throw new Error("--cloud-fixture-path cannot be combined with --cloud-speaker-fixture or --cloud-playback-path");
  }

  if (options.cloudTranscriptionFixturePath) {
    return;
  }

  if (!options.cloudSpeechFixture) {
    return;
  }

  if (process.platform !== "win32") {
    throw new Error("--cloud-speech-fixture is currently implemented with Windows SAPI only");
  }

  writeWindowsSpeechFixture(fixturePath, options.cloudTranscriptionFixtureText);
  const stats = fs.statSync(fixturePath);
  if (!stats.isFile() || stats.size < 44) {
    throw new Error(`Generated cloud speech fixture is invalid: ${fixturePath}`);
  }
  options.cloudTranscriptionFixturePath = fixturePath;
}

function prepareCloudSpeakerFixture(options, fixturePath) {
  if (options.cloudTranscriptionPlaybackPath) {
    return;
  }

  if (!options.cloudSpeakerFixture) {
    return;
  }

  if (process.platform !== "win32") {
    throw new Error("--cloud-speaker-fixture is currently implemented with Windows SAPI only");
  }

  writeWindowsSpeechFixture(fixturePath, options.cloudTranscriptionFixtureText);
  const stats = fs.statSync(fixturePath);
  if (!stats.isFile() || stats.size < 44) {
    throw new Error(`Generated cloud speaker fixture is invalid: ${fixturePath}`);
  }
  options.cloudTranscriptionPlaybackPath = fixturePath;
}

function writeSmokeConfig(configPath, controlWindowUrl) {
  const sourcePath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const config = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const windows = Array.isArray(config?.app?.windows) ? config.app.windows : [];
  const controlWindow = windows.find((windowConfig) => windowConfig?.label === "control");

  if (!controlWindow) {
    throw new Error("Tauri config does not contain the control window");
  }

  controlWindow.url = controlWindowUrl;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function quoteWindowsCmdArg(value) {
  const text = String(value);
  if (text.includes('"')) {
    throw new Error(`Cannot quote Windows command argument containing double quotes: ${text}`);
  }

  if (/^[A-Za-z0-9_./:=\\-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/\^/g, "^^").replace(/%/g, "^%")}"`;
}

function windowsCmdLine(args) {
  return args.map(quoteWindowsCmdArg).join(" ");
}

function buildQuery(params) {
  const query = new URLSearchParams(params);
  return `?${query.toString()}`;
}

function devCommandForOptions(options, logPaths) {
  if (
    options.runtimeProbe ||
    options.nativeRecordingSmoke ||
    options.dictationPipelineSmoke ||
    options.cloudTranscriptionSmoke ||
    options.cloudCredentialPreflight
  ) {
    let controlWindowUrl = "?panel=true&runtimeProbe=1";
    if (options.dictationPipelineSmoke) {
      controlWindowUrl = "?panel=true&dictationPipelineSmoke=1";
    } else if (options.nativeRecordingSmoke) {
      controlWindowUrl = "?panel=true&nativeRecordingSmoke=1";
    } else if (options.cloudTranscriptionSmoke) {
      const query = {
        panel: "true",
        cloudTranscriptionSmoke: "1",
      };
      if (options.cloudTranscriptionProvider) {
        query.cloudTranscriptionSmokeProvider = options.cloudTranscriptionProvider;
      }
      if (options.cloudTranscriptionModel) {
        query.cloudTranscriptionSmokeModel = options.cloudTranscriptionModel;
      }
      if (options.cloudTranscriptionLanguage) {
        query.cloudTranscriptionSmokeLanguage = options.cloudTranscriptionLanguage;
      }
      if (options.cloudTranscriptionSmokeMs) {
        query.cloudTranscriptionSmokeMs = options.cloudTranscriptionSmokeMs;
      }
      if (options.cloudTranscriptionFixturePath) {
        query.cloudTranscriptionFixturePath = options.cloudTranscriptionFixturePath;
      }
      if (options.cloudTranscriptionPlaybackPath) {
        query.cloudTranscriptionPlaybackPath = options.cloudTranscriptionPlaybackPath;
      }
      controlWindowUrl = buildQuery(query);
    } else if (options.cloudCredentialPreflight) {
      const query = {
        panel: "true",
        cloudCredentialPreflight: "1",
      };
      if (options.cloudTranscriptionProvider) {
        query.cloudTranscriptionSmokeProvider = options.cloudTranscriptionProvider;
      }
      if (options.cloudTranscriptionModel) {
        query.cloudTranscriptionSmokeModel = options.cloudTranscriptionModel;
      }
      if (options.cloudTranscriptionLanguage) {
        query.cloudTranscriptionSmokeLanguage = options.cloudTranscriptionLanguage;
      }
      if (options.cloudTranscriptionFixturePath) {
        query.cloudTranscriptionFixturePath = options.cloudTranscriptionFixturePath;
      }
      controlWindowUrl = buildQuery(query);
    }
    writeSmokeConfig(logPaths.smokeConfig, controlWindowUrl);
    const smokeArgs = ["npx", "tauri", "dev", "--config", logPaths.smokeConfig];

    if (process.platform === "win32") {
      return {
        command: "cmd.exe",
        args: ["/d", "/c", windowsCmdLine(smokeArgs)],
        display: windowsCmdLine(smokeArgs),
      };
    }

    return {
      command: "npx",
      args: smokeArgs.slice(1),
      display: smokeArgs.join(" "),
    };
  }

  return {
    command: process.platform === "win32" ? "cmd.exe" : "npm",
    args:
      process.platform === "win32" ? ["/d", "/s", "/c", "npm run tauri:dev"] : ["run", "tauri:dev"],
    display: "npm run tauri:dev",
  };
}

function parseSentinelResult(text, sentinel) {
  const lines = stripAnsi(text).split(/\r?\n/).reverse();

  for (const line of lines) {
    if (!line.includes(sentinel)) continue;

    const rendererLogMatch = line.match(/RENDERER_LOG\s+(\{.*\})\s*$/);
    if (rendererLogMatch) {
      try {
        const payload = JSON.parse(rendererLogMatch[1]);
        if (payload?.meta && typeof payload.meta === "object") {
          return payload.meta;
        }

        if (typeof payload?.message === "string") {
          const index = payload.message.indexOf(sentinel);
          if (index >= 0) {
            return JSON.parse(payload.message.slice(index + sentinel.length).trim());
          }
        }
      } catch {
        // Fall back to parsing the raw line below.
      }
    }

    try {
      const index = line.indexOf(sentinel);
      return JSON.parse(line.slice(index + sentinel.length).trim());
    } catch {
      return { status: "failed", error: `${sentinel} sentinel was not valid JSON`, line };
    }
  }

  return null;
}

function parseRuntimeProbeResult(text) {
  return parseSentinelResult(text, runtimeProbeSentinel);
}

function parseNativeRecordingSmokeResult(text) {
  return parseSentinelResult(text, nativeRecordingSmokeSentinel);
}

function parseDictationPipelineSmokeResult(text) {
  return parseSentinelResult(text, dictationPipelineSmokeSentinel);
}

function parseCloudTranscriptionSmokeResult(text) {
  return parseSentinelResult(text, cloudTranscriptionSmokeSentinel);
}

function parseCloudCredentialPreflightResult(text) {
  return parseSentinelResult(text, cloudCredentialPreflightSentinel);
}

function detectState(stdout, stderr) {
  const combined = stripAnsi(`${stdout}\n${stderr}`);

  return {
    viteReady: /\bVITE\b[\s\S]*\bready in\b/.test(combined),
    viteLocalUrl: /Local:\s+http:\/\/localhost:5174\//.test(combined),
    beforeDevCommand: /Running BeforeDevCommand/.test(combined),
    devCommand: /Running DevCommand/.test(combined),
    cargoFinished: /Finished\s+`dev` profile/.test(combined),
    appRunning: /Running\s+`target[\\/]debug[\\/]typefree(?:\.exe)?`/.test(combined),
    runtimeProbeResult: parseRuntimeProbeResult(combined),
    nativeRecordingSmokeResult: parseNativeRecordingSmokeResult(combined),
    dictationPipelineSmokeResult: parseDictationPipelineSmokeResult(combined),
    cloudTranscriptionSmokeResult: parseCloudTranscriptionSmokeResult(combined),
    cloudCredentialPreflightResult: parseCloudCredentialPreflightResult(combined),
  };
}

function isBaseReady(state) {
  return state.viteReady && state.viteLocalUrl && state.devCommand && state.appRunning;
}

function isReady(state, options) {
  if (!isBaseReady(state)) return false;
  if (options.runtimeProbe) return !!state.runtimeProbeResult;
  if (options.nativeRecordingSmoke) return !!state.nativeRecordingSmokeResult;
  if (options.dictationPipelineSmoke) return !!state.dictationPipelineSmokeResult;
  if (options.cloudTranscriptionSmoke) return !!state.cloudTranscriptionSmokeResult;
  if (options.cloudCredentialPreflight) return !!state.cloudCredentialPreflightResult;
  return true;
}

function smokeResultForOptions(state, options) {
  if (options.runtimeProbe) return state.runtimeProbeResult;
  if (options.nativeRecordingSmoke) return state.nativeRecordingSmokeResult;
  if (options.dictationPipelineSmoke) return state.dictationPipelineSmokeResult;
  if (options.cloudTranscriptionSmoke) return state.cloudTranscriptionSmokeResult;
  if (options.cloudCredentialPreflight) return state.cloudCredentialPreflightResult;
  return null;
}

function smokeReasonForOptions(state, options) {
  if (options.runtimeProbe) {
    return `runtime-probe:${state.runtimeProbeResult?.status || "unknown"}`;
  }
  if (options.nativeRecordingSmoke) {
    return `native-recording-smoke:${state.nativeRecordingSmokeResult?.status || "unknown"}`;
  }
  if (options.dictationPipelineSmoke) {
    return `dictation-pipeline-smoke:${state.dictationPipelineSmokeResult?.status || "unknown"}`;
  }
  if (options.cloudTranscriptionSmoke) {
    return `cloud-transcription-smoke:${state.cloudTranscriptionSmokeResult?.status || "unknown"}`;
  }
  if (options.cloudCredentialPreflight) {
    return `cloud-credential-preflight:${state.cloudCredentialPreflightResult?.status || "unknown"}`;
  }
  return "vite+cargo+tauri-app-running";
}

function smokeFailureReason(options) {
  if (options.runtimeProbe) return "runtime probe reported failed checks";
  if (options.nativeRecordingSmoke) return "native recording smoke reported failed checks";
  if (options.dictationPipelineSmoke) return "dictation pipeline smoke reported failed checks";
  if (options.cloudTranscriptionSmoke) return "cloud transcription smoke reported failed checks";
  if (options.cloudCredentialPreflight) return "cloud credential preflight reported failed checks";
  return "smoke reported failed checks";
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function stopProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }

    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
      return;
    }

    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }

    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // already gone
      }
      resolve();
    }, 3000);
  });
}

function writeSummary(summaryPath, summary) {
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const logPaths = createLogPaths(options.logDir);
  prepareCloudSpeechFixture(options, logPaths.cloudSpeechFixture);
  prepareCloudSpeakerFixture(options, logPaths.cloudSpeakerFixture);
  const devCommand = devCommandForOptions(options, logPaths);
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let settled = false;
  let readyTimer = null;
  let watchdogTimer = null;

  const outStream = fs.createWriteStream(logPaths.stdout, { flags: "w" });
  const errStream = fs.createWriteStream(logPaths.stderr, { flags: "w" });

  const child = spawn(devCommand.command, devCommand.args, {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      ...(options.runtimeProbe ? { VITE_TYPEFREE_RUNTIME_PROBE_AUTORUN: "1" } : {}),
      ...(options.nativeRecordingSmoke
        ? { VITE_TYPEFREE_NATIVE_RECORDING_SMOKE_AUTORUN: "1" }
        : {}),
      ...(options.dictationPipelineSmoke
        ? { VITE_TYPEFREE_DICTATION_PIPELINE_SMOKE_AUTORUN: "1" }
        : {}),
      ...(options.cloudTranscriptionSmoke
        ? {
            VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_AUTORUN: "1",
            ...(options.cloudTranscriptionProvider
              ? {
                  VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_PROVIDER:
                    options.cloudTranscriptionProvider,
                }
              : {}),
            ...(options.cloudTranscriptionModel
              ? { VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MODEL: options.cloudTranscriptionModel }
              : {}),
            ...(options.cloudTranscriptionLanguage
              ? {
                  VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_LANGUAGE:
                    options.cloudTranscriptionLanguage,
                }
              : {}),
            ...(options.cloudTranscriptionSmokeMs
              ? { VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MS: options.cloudTranscriptionSmokeMs }
              : {}),
            ...(options.cloudTranscriptionFixturePath
              ? {
                  VITE_TYPEFREE_CLOUD_TRANSCRIPTION_FIXTURE_PATH:
                    options.cloudTranscriptionFixturePath,
                }
              : {}),
            ...(options.cloudTranscriptionPlaybackPath
              ? {
                  VITE_TYPEFREE_CLOUD_TRANSCRIPTION_PLAYBACK_PATH:
                    options.cloudTranscriptionPlaybackPath,
                }
              : {}),
          }
        : {}),
      ...(options.cloudCredentialPreflight
        ? {
            VITE_TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_AUTORUN: "1",
            ...(options.cloudTranscriptionProvider
              ? {
                  VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_PROVIDER:
                    options.cloudTranscriptionProvider,
                }
              : {}),
            ...(options.cloudTranscriptionModel
              ? { VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MODEL: options.cloudTranscriptionModel }
              : {}),
            ...(options.cloudTranscriptionLanguage
              ? {
                  VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_LANGUAGE:
                    options.cloudTranscriptionLanguage,
                }
              : {}),
            ...(options.cloudTranscriptionFixturePath
              ? {
                  VITE_TYPEFREE_CLOUD_TRANSCRIPTION_FIXTURE_PATH:
                    options.cloudTranscriptionFixturePath,
                }
              : {}),
          }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const finish = async (success, reason) => {
    if (settled) return;
    settled = true;
    if (readyTimer) clearTimeout(readyTimer);
    if (watchdogTimer) clearTimeout(watchdogTimer);

    await stopProcessTree(child.pid);
    await waitForExit(child);
    outStream.end();
    errStream.end();

    const state = detectState(stdout, stderr);
    const summary = {
      success,
      reason,
      command: devCommand.display,
      durationMs: Date.now() - startedAt,
      pid: child.pid,
      state,
      timeoutMs: options.timeoutMs,
      readyGraceMs: options.readyGraceMs,
      runtimeProbe: options.runtimeProbe,
      nativeRecordingSmoke: options.nativeRecordingSmoke,
      dictationPipelineSmoke: options.dictationPipelineSmoke,
      cloudTranscriptionSmoke: options.cloudTranscriptionSmoke,
      cloudCredentialPreflight: options.cloudCredentialPreflight,
      cloudSpeechFixture: options.cloudSpeechFixture,
      cloudTranscriptionFixturePath: options.cloudTranscriptionFixturePath || null,
      cloudTranscriptionPlaybackPath: options.cloudTranscriptionPlaybackPath || null,
      cloudSpeakerFixture: options.cloudSpeakerFixture,
      runtimeProbeResult: state.runtimeProbeResult,
      nativeRecordingSmokeResult: state.nativeRecordingSmokeResult,
      dictationPipelineSmokeResult: state.dictationPipelineSmokeResult,
      cloudTranscriptionSmokeResult: state.cloudTranscriptionSmokeResult,
      cloudCredentialPreflightResult: state.cloudCredentialPreflightResult,
      logs: logPaths,
    };

    writeSummary(logPaths.summary, summary);

    if (success) {
      console.log(`tauri dev smoke passed in ${summary.durationMs}ms`);
      console.log(`summary: ${logPaths.summary}`);
      console.log(`stdout: ${logPaths.stdout}`);
      console.log(`stderr: ${logPaths.stderr}`);
      return;
    }

    console.error(`tauri dev smoke failed: ${reason}`);
    console.error(`summary: ${logPaths.summary}`);
    console.error("--- stdout tail ---");
    console.error(tailLines(stdout));
    console.error("--- stderr tail ---");
    console.error(tailLines(stderr));
    process.exitCode = 1;
  };

  const maybeReady = () => {
    const state = detectState(stdout, stderr);
    if (!isReady(state, options) || settled || readyTimer) return;

    const smokeResult = smokeResultForOptions(state, options);
    if (smokeResult?.status === "failed") {
      void finish(false, smokeFailureReason(options));
      return;
    }

    readyTimer = setTimeout(() => {
      void finish(true, smokeReasonForOptions(state, options));
    }, options.readyGraceMs);
  };

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    outStream.write(chunk);
    maybeReady();
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    errStream.write(chunk);
    maybeReady();
  });

  child.on("error", (error) => {
    void finish(false, `failed to start npm run tauri:dev: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    if (!settled) {
      void finish(false, `process exited before readiness (code=${code}, signal=${signal})`);
    }
  });

  watchdogTimer = setTimeout(() => {
    void finish(false, `timeout after ${options.timeoutMs}ms`);
  }, options.timeoutMs);
}

void main();
