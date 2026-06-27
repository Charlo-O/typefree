#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const PLATFORM_NODE_VALUES = {
  windows: "win32",
  macos: "darwin",
  linux: "linux",
};

const SUMMARY_OPTIONS = new Set([
  "runtime-probe",
  "native-recording",
  "dictation-pipeline",
  "cloud-preflight",
  "cloud-transcription",
]);

function usage() {
  return [
    "Usage:",
    "  node scripts/verify-runtime-smoke-summaries.js --platform <windows|macos|linux> \\",
    "    --runtime-probe <summary.json> \\",
    "    --native-recording <summary.json> \\",
    "    --dictation-pipeline <summary.json> \\",
    "    --cloud-preflight <summary.json> \\",
    "    --cloud-transcription <summary.json>",
    "",
    "Optional:",
    "  Positional fallback: <platform> <runtime-probe> <native-recording> <dictation-pipeline> <cloud-preflight> <cloud-transcription>",
    "  --require-cloud-microphone",
    "  --allow-missing-cloud-preflight",
    "  --allow-missing-cloud-transcription",
  ].join("\n");
}

function fail(message) {
  throw new Error(message);
}

function envFlag(name) {
  const value = process.env[name];
  return value === "1" || value === "true";
}

function parseArgs(argv) {
  const options = {
    allowMissingCloudPreflight: envFlag("npm_config_allow_missing_cloud_preflight"),
    allowMissingCloudTranscription: envFlag("npm_config_allow_missing_cloud_transcription"),
    requireCloudMicrophone: envFlag("npm_config_require_cloud_microphone"),
    summaries: {},
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--allow-missing-cloud-preflight") {
      options.allowMissingCloudPreflight = true;
      continue;
    }
    if (arg === "--allow-missing-cloud-transcription") {
      options.allowMissingCloudTranscription = true;
      continue;
    }
    if (arg === "--require-cloud-microphone") {
      options.requireCloudMicrophone = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const name = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for ${arg}`);
    }
    index += 1;

    if (name === "platform") {
      options.platform = value.toLowerCase();
      continue;
    }
    if (SUMMARY_OPTIONS.has(name)) {
      options.summaries[name] = value;
      continue;
    }

    fail(`Unknown option: ${arg}`);
  }

  if (positional.length > 0) {
    const orderedSummaries = [
      "runtime-probe",
      "native-recording",
      "dictation-pipeline",
      "cloud-preflight",
      "cloud-transcription",
    ];
    const remaining = [...positional];

    if (!options.platform && PLATFORM_NODE_VALUES[String(remaining[0] || "").toLowerCase()]) {
      options.platform = remaining.shift().toLowerCase();
    }

    for (const name of orderedSummaries) {
      if (!options.summaries[name] && remaining.length > 0) {
        options.summaries[name] = remaining.shift();
      }
    }

    if (remaining.length > 0) {
      fail(`Unexpected positional arguments: ${remaining.join(", ")}`);
    }
  }

  return options;
}

function readSummary(summaryPath) {
  const resolved = path.resolve(summaryPath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    fail(`Failed to read ${resolved}: ${error.message}`);
  }
  return { path: resolved, summary: parsed };
}

function assertEqual(actual, expected, context) {
  if (actual !== expected) {
    fail(`${context}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, context) {
  if (!value) {
    fail(`${context}: expected truthy value`);
  }
}

function assertArray(value, context) {
  if (!Array.isArray(value)) {
    fail(`${context}: expected array`);
  }
}

function assertNonEmptyString(value, context) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${context}: expected non-empty string`);
  }
}

function assertPositiveNumber(value, context) {
  if (typeof value !== "number" || value <= 0) {
    fail(`${context}: expected positive number`);
  }
}

function assertRuntimeShell(summary, label) {
  assertEqual(summary.success, true, `${label}.success`);
  assertEqual(summary.state?.viteReady, true, `${label}.state.viteReady`);
  assertTruthy(summary.state?.viteLocalUrl, `${label}.state.viteLocalUrl`);
  assertEqual(summary.state?.devCommand, true, `${label}.state.devCommand`);
  assertEqual(summary.state?.appRunning, true, `${label}.state.appRunning`);
}

function resultFor(summary, key, label) {
  const result = summary.state?.[key];
  if (!result || typeof result !== "object" || Object.keys(result).length === 0) {
    fail(`${label}.${key}: missing result payload`);
  }
  assertEqual(result.status, "passed", `${label}.${key}.status`);
  assertEqual(result.failed, 0, `${label}.${key}.failed`);
  assertArray(result.checks, `${label}.${key}.checks`);
  return result;
}

function checkById(result, id, label) {
  const check = result.checks.find((item) => item.id === id);
  if (!check) {
    fail(`${label}: missing check ${id}`);
  }
  assertEqual(check.status, "passed", `${label}.${id}.status`);
  return check;
}

function assertCheckIds(result, ids, label) {
  for (const id of ids) {
    checkById(result, id, label);
  }
}

function validateRuntimeProbe(summary, expectedPlatform) {
  assertRuntimeShell(summary, "runtime-probe");
  const result = resultFor(summary, "runtimeProbeResult", "runtime-probe");
  assertCheckIds(result, ["runtime", "native-recording", "foreground", "vocabulary", "privacy"], "runtime-probe");

  const native = checkById(result, "native-recording", "runtime-probe");
  assertEqual(native.meta?.platform, expectedPlatform, "runtime-probe.native-recording.meta.platform");
  assertEqual(native.meta?.supported, true, "runtime-probe.native-recording.meta.supported");
  assertNonEmptyString(native.meta?.backend, "runtime-probe.native-recording.meta.backend");
}

function validateNativeRecording(summary, expectedPlatform) {
  assertRuntimeShell(summary, "native-recording");
  const result = resultFor(summary, "nativeRecordingSmokeResult", "native-recording");
  assertCheckIds(
    result,
    [
      "native-recording-capabilities",
      "native-recording-start",
      "native-recording-active",
      "native-recording-capture",
    ],
    "native-recording"
  );

  const capabilities = checkById(result, "native-recording-capabilities", "native-recording");
  assertEqual(capabilities.meta?.platform, expectedPlatform, "native-recording.capabilities.meta.platform");
  assertEqual(capabilities.meta?.supported, true, "native-recording.capabilities.meta.supported");
  assertNonEmptyString(capabilities.meta?.backend, "native-recording.capabilities.meta.backend");

  const capture = checkById(result, "native-recording-capture", "native-recording");
  assertEqual(capture.meta?.wav, true, "native-recording.capture.meta.wav");
  assertEqual(capture.meta?.mimeType, "audio/wav", "native-recording.capture.meta.mimeType");
  if (typeof capture.meta?.audioBytes !== "number" || capture.meta.audioBytes < 44) {
    fail("native-recording.capture.meta.audioBytes: expected WAV payload bytes");
  }
}

function validateDictationPipeline(summary) {
  assertRuntimeShell(summary, "dictation-pipeline");
  const result = resultFor(summary, "dictationPipelineSmokeResult", "dictation-pipeline");
  assertCheckIds(
    result,
    [
      "dictation-pipeline-input",
      "dictation-pipeline-steps",
      "dictation-pipeline-insert",
      "dictation-pipeline-history",
      "dictation-pipeline-session",
    ],
    "dictation-pipeline"
  );

  const steps = checkById(result, "dictation-pipeline-steps", "dictation-pipeline");
  const stepNames = new Set((steps.meta?.steps || []).map((step) => step.name));
  for (const name of ["normalize", "dedupe", "ui", "insert", "clipboard-history", "db-history"]) {
    if (!stepNames.has(name)) {
      fail(`dictation-pipeline.steps: missing ${name}`);
    }
  }

  const insert = checkById(result, "dictation-pipeline-insert", "dictation-pipeline");
  assertEqual(insert.meta?.clipboardRoundTrip, true, "dictation-pipeline.insert.meta.clipboardRoundTrip");
  assertEqual(insert.meta?.clipboardRestored, true, "dictation-pipeline.insert.meta.clipboardRestored");
  assertEqual(insert.meta?.insertStatus, "completed", "dictation-pipeline.insert.meta.insertStatus");

  const history = checkById(result, "dictation-pipeline-history", "dictation-pipeline");
  assertEqual(history.meta?.dbHistoryStatus, "completed", "dictation-pipeline.history.meta.dbHistoryStatus");
  assertPositiveNumber(history.meta?.savedHistoryId, "dictation-pipeline.history.meta.savedHistoryId");

  const session = checkById(result, "dictation-pipeline-session", "dictation-pipeline");
  assertEqual(session.meta?.hasPersistedSession, true, "dictation-pipeline.session.meta.hasPersistedSession");
}

function validateCloudPreflight(summary) {
  assertRuntimeShell(summary, "cloud-preflight");
  const result = resultFor(summary, "cloudCredentialPreflightResult", "cloud-preflight");
  assertCheckIds(result, ["cloud-credential-provider", "cloud-credential-preflight"], "cloud-preflight");

  const preflight = checkById(result, "cloud-credential-preflight", "cloud-preflight");
  assertEqual(preflight.meta?.presenceOnly, true, "cloud-preflight.meta.presenceOnly");
  assertEqual(preflight.meta?.recordingStarted, false, "cloud-preflight.meta.recordingStarted");
  assertEqual(preflight.meta?.providerRequestStarted, false, "cloud-preflight.meta.providerRequestStarted");
  assertArray(preflight.meta?.requiredCredentialKeys, "cloud-preflight.meta.requiredCredentialKeys");
  assertArray(preflight.meta?.presentCredentialKeys, "cloud-preflight.meta.presentCredentialKeys");
  assertArray(preflight.meta?.missingCredentialKeys, "cloud-preflight.meta.missingCredentialKeys");
  if (preflight.meta.requiredCredentialKeys.length === 0) {
    fail("cloud-preflight.meta.requiredCredentialKeys: expected at least one credential key");
  }
  assertEqual(preflight.meta.missingCredentialKeys.length, 0, "cloud-preflight.meta.missingCredentialKeys.length");
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

function assertCloudSummaryHasNoSensitivePayload(result) {
  const forbiddenPayloadKeys = new Set(["text", "transcript", "transcriptText", "rawText", "processedText"]);
  const forbiddenSecretKeyPattern = /(api[_-]?key|access[_-]?token|secret|authorization|credentialValue|tokenValue)/i;

  for (const key of collectObjectKeys(result)) {
    if (forbiddenPayloadKeys.has(key)) {
      fail(`cloud-transcription result must not include transcript payload key ${key}`);
    }
    if (forbiddenSecretKeyPattern.test(key) && !/CredentialKeys$/.test(key)) {
      fail(`cloud-transcription result must not include secret payload key ${key}`);
    }
  }
}

function assertCloudMicrophoneEvidence(result) {
  const capabilities = checkById(
    result,
    "cloud-transcription-recording-capabilities",
    "cloud-transcription.microphone"
  );
  assertEqual(
    capabilities.meta?.supported,
    true,
    "cloud-transcription.microphone.recording-capabilities.meta.supported"
  );

  checkById(result, "cloud-transcription-recording-start", "cloud-transcription.microphone");

  const capture = checkById(result, "cloud-transcription-recording-capture", "cloud-transcription.microphone");
  assertEqual(capture.meta?.wav, true, "cloud-transcription.microphone.recording-capture.meta.wav");
  assertEqual(capture.meta?.mimeType, "audio/wav", "cloud-transcription.microphone.recording-capture.meta.mimeType");
  if (typeof capture.meta?.audioBytes !== "number" || capture.meta.audioBytes < 44) {
    fail("cloud-transcription.microphone.recording-capture.meta.audioBytes: expected native WAV bytes");
  }

  const transcript = checkById(result, "cloud-transcription-result", "cloud-transcription.microphone");
  assertEqual(
    transcript.meta?.audioSource,
    "native-recording",
    "cloud-transcription.microphone.result.meta.audioSource"
  );

  const fixture = result.checks.find((item) => item.id === "cloud-transcription-speech-fixture");
  if (fixture?.status === "passed") {
    fail("cloud-transcription.microphone: speech fixture evidence cannot satisfy --require-cloud-microphone");
  }
}

function validateCloudTranscription(summary, options = {}) {
  assertRuntimeShell(summary, "cloud-transcription");
  const result = resultFor(summary, "cloudTranscriptionSmokeResult", "cloud-transcription");
  assertCheckIds(
    result,
    ["cloud-transcription-provider", "cloud-transcription-credentials", "cloud-transcription-result"],
    "cloud-transcription"
  );

  const credentials = checkById(result, "cloud-transcription-credentials", "cloud-transcription");
  assertArray(credentials.meta?.requiredCredentialKeys, "cloud-transcription.credentials.meta.requiredCredentialKeys");
  assertArray(credentials.meta?.presentCredentialKeys, "cloud-transcription.credentials.meta.presentCredentialKeys");
  assertArray(credentials.meta?.missingCredentialKeys, "cloud-transcription.credentials.meta.missingCredentialKeys");
  if (credentials.meta.requiredCredentialKeys.length === 0) {
    fail("cloud-transcription.credentials.meta.requiredCredentialKeys: expected at least one credential key");
  }
  assertEqual(
    credentials.meta.missingCredentialKeys.length,
    0,
    "cloud-transcription.credentials.meta.missingCredentialKeys.length"
  );

  const provider = checkById(result, "cloud-transcription-provider", "cloud-transcription");
  assertNonEmptyString(provider.meta?.provider, "cloud-transcription.provider.meta.provider");

  const transcript = checkById(result, "cloud-transcription-result", "cloud-transcription");
  assertNonEmptyString(transcript.meta?.provider, "cloud-transcription.result.meta.provider");
  assertPositiveNumber(transcript.meta?.transcriptLength, "cloud-transcription.result.meta.transcriptLength");
  if (typeof transcript.meta?.audioBytes !== "number" || transcript.meta.audioBytes < 44) {
    fail("cloud-transcription.result.meta.audioBytes: expected recorded or fixture WAV bytes");
  }
  assertNonEmptyString(transcript.meta?.audioSource, "cloud-transcription.result.meta.audioSource");
  if (options.requireCloudMicrophone) {
    assertCloudMicrophoneEvidence(result);
  }
  assertCloudSummaryHasNoSensitivePayload(result);
}

function requireSummary(options, name) {
  const value = options.summaries[name];
  if (!value) {
    fail(`Missing --${name} <summary.json>`);
  }
  return readSummary(value).summary;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.platform || !PLATFORM_NODE_VALUES[options.platform]) {
    fail("Missing or invalid --platform <windows|macos|linux>");
  }

  const expectedPlatform = PLATFORM_NODE_VALUES[options.platform];
  validateRuntimeProbe(requireSummary(options, "runtime-probe"), expectedPlatform);
  validateNativeRecording(requireSummary(options, "native-recording"), expectedPlatform);
  validateDictationPipeline(requireSummary(options, "dictation-pipeline"));

  if (options.summaries["cloud-preflight"]) {
    validateCloudPreflight(readSummary(options.summaries["cloud-preflight"]).summary);
  } else if (!options.allowMissingCloudPreflight) {
    fail("Missing --cloud-preflight <summary.json>");
  }

  if (options.summaries["cloud-transcription"]) {
    validateCloudTranscription(readSummary(options.summaries["cloud-transcription"]).summary, {
      requireCloudMicrophone: options.requireCloudMicrophone,
    });
  } else if (!options.allowMissingCloudTranscription) {
    fail("Missing --cloud-transcription <summary.json>");
  }

  console.log(`runtime smoke summaries passed for ${options.platform}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exit(1);
}
