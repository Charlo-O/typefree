#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const compiledSrcRoot = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "typefree-audio-quality-tests-")),
  "src"
);

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    clear() {
      values.clear();
    },
  };
}

const localStorage = createMemoryStorage();
let pendingTimer = null;

global.localStorage = localStorage;
global.window = {
  localStorage,
  setTimeout(callback, delay) {
    pendingTimer = { callback, delay };
    return 1;
  },
  clearTimeout() {
    pendingTimer = null;
  },
};

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeCompiled(relativePath, contents) {
  const outputPath = path.join(compiledSrcRoot, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, contents, "utf8");
}

function compileSourceFile(relativePath) {
  const filename = path.join(srcRoot, relativePath);
  const source = read(filename);
  const output = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const diagnostics = (output.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (diagnostics.length > 0) {
    const message = diagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("\n");
    throw new Error(`Failed to transpile ${filename}:\n${message}`);
  }

  const sourceDir = path.dirname(filename);
  let outputText = output.outputText.replaceAll("import.meta", "({ env: {} })");
  outputText = outputText.replace(/require\("(\.{1,2}\/[^"]+)"\)/g, (match, request) => {
    const target = path.resolve(sourceDir, request);
    let nextRequest = null;
    if (fs.existsSync(`${target}.ts`) || fs.existsSync(`${target}.tsx`)) {
      nextRequest = `${request}.cjs`;
    } else if (fs.existsSync(path.join(target, "index.ts"))) {
      nextRequest = `${request}/index.cjs`;
    }

    return nextRequest ? `require("${nextRequest}")` : match;
  });

  writeCompiled(relativePath.replace(/\.tsx?$/, ".cjs"), outputText);
}

function prepareCompiledModules() {
  compileSourceFile("features/dictation/audio/audioManager.ts");
  const modelRegistryData = JSON.parse(
    read(path.join(srcRoot, "models", "modelRegistryData.json"))
  );
  const transcriptionProviders = Object.fromEntries(
    modelRegistryData.transcriptionProviders.map((provider) => [
      provider.id,
      { baseUrl: provider.baseUrl },
    ])
  );

  writeCompiled(
    "services/ReasoningService.cjs",
    "module.exports = { __esModule: true, default: class ReasoningService {} };\n"
  );
  writeCompiled(
    "services/VolcengineASRService.cjs",
    "module.exports = { __esModule: true, default: class VolcengineASRService {} };\n"
  );
  writeCompiled(
    "config/constants.cjs",
    [
      "exports.API_ENDPOINTS = {};",
      "exports.buildApiUrl = (endpoint) => endpoint;",
      "exports.normalizeBaseUrl = (url) => url;",
      "",
    ].join("\n")
  );
  writeCompiled(
    "utils/logger.cjs",
    [
      "const noop = () => undefined;",
      "module.exports = {",
      "  __esModule: true,",
      "  default: { debug: noop, info: noop, warn: noop, error: noop },",
      "};",
      "",
    ].join("\n")
  );
  writeCompiled("utils/audioDeviceUtils.cjs", "exports.isBuiltInMicrophone = () => false;\n");
  writeCompiled("utils/urlUtils.cjs", "exports.isSecureEndpoint = () => true;\n");
  writeCompiled(
    "models/ModelRegistry.cjs",
    [
      `const transcriptionProviders = ${JSON.stringify(transcriptionProviders)};`,
      "exports.getTranscriptionProvider = (providerId) => transcriptionProviders[providerId];",
      "",
    ].join("\n")
  );
  writeCompiled(
    "utils/vocabulary.cjs",
    "exports.syncVocabularySettingsToBackend = async () => undefined;\n"
  );
  writeCompiled(
    "shared/platform/index.cjs",
    "module.exports = { __esModule: true, default: {} };\n"
  );
  writeCompiled(
    "features/dictation/pipeline/transcriptionPipeline.cjs",
    "exports.runTranscriptionPostProcessingPipeline = async () => ({});\n"
  );
}

prepareCompiledModules();

const AudioManager = require(
  path.join(compiledSrcRoot, "features", "dictation", "audio", "audioManager.cjs")
).default;
const audioManagerSource = read(
  path.join(srcRoot, "features", "dictation", "audio", "audioManager.ts")
);
const nativeAudioQualitySource = read(
  path.join(repoRoot, "src-tauri", "src", "commands", "audio_quality.rs")
);
const platformBootstrapSource = read(
  path.join(srcRoot, "shared", "platform", "platformBootstrap.ts")
);
const settingsSchemaSource = read(
  path.join(srcRoot, "features", "settings", "schema", "settingsSchema.ts")
);
const settingsPageSource = read(
  path.join(srcRoot, "features", "settings", "ui", "SettingsPage.tsx")
);
const translationsSource = read(path.join(srcRoot, "i18n", "translations.ts"));
const packageJson = JSON.parse(read(path.join(repoRoot, "package.json")));

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createManager() {
  return new AudioManager({});
}

function resetStorage() {
  localStorage.clear();
  pendingTimer = null;
}

function assertIncludes(source, snippet) {
  assert.equal(source.includes(snippet), true, snippet);
}

function assertApproximatelyEqual(actual, expected, epsilon = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
}

function voiceSamples(sampleRate = 48000) {
  const samples = new Float32Array(sampleRate);
  for (let index = Math.floor(sampleRate * 0.25); index < Math.floor(sampleRate * 0.4); index++) {
    samples[index] = index % 2 === 0 ? 0.08 : -0.08;
  }
  return samples;
}

async function blobText(blob, start, end) {
  const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
  return String.fromCharCode(...bytes);
}

class FakeAudioContext {
  static samples = voiceSamples();
  static sampleRate = 48000;
  static closed = 0;

  async decodeAudioData() {
    const samples = FakeAudioContext.samples;
    return {
      duration: samples.length / FakeAudioContext.sampleRate,
      length: samples.length,
      numberOfChannels: 1,
      sampleRate: FakeAudioContext.sampleRate,
      getChannelData: () => samples,
    };
  }

  async close() {
    FakeAudioContext.closed += 1;
  }
}

global.window.AudioContext = FakeAudioContext;

test("audio quality settings clamp schema-backed duration and feed the max-duration timer", () => {
  resetStorage();
  const manager = createManager();

  assert.deepEqual(manager.getAudioQualitySettings(), {
    processingEnabled: true,
    noiseGateEnabled: false,
    preRollMs: 250,
    maxDurationSeconds: 300,
  });

  localStorage.setItem("audioQualityProcessingEnabled", "false");
  localStorage.setItem("audioQualityNoiseGateEnabled", "true");
  localStorage.setItem("audioQualityPreRollMs", "25");
  localStorage.setItem("recordingMaxDurationSeconds", "1");
  assert.deepEqual(manager.getAudioQualitySettings(), {
    processingEnabled: false,
    noiseGateEnabled: true,
    preRollMs: 25,
    maxDurationSeconds: 15,
  });

  localStorage.setItem("audioQualityPreRollMs", "9999");
  assert.equal(manager.getAudioQualitySettings().preRollMs, 2000);

  localStorage.setItem("audioQualityPreRollMs", "0");
  assert.equal(manager.getAudioQualitySettings().preRollMs, 0);

  localStorage.setItem("recordingMaxDurationSeconds", "9999");
  assert.equal(manager.getAudioQualitySettings().maxDurationSeconds, 3600);

  localStorage.setItem("recordingMaxDurationSeconds", "0");
  assert.equal(manager.getAudioQualitySettings().maxDurationSeconds, 0);

  localStorage.setItem("recordingMaxDurationSeconds", "15");
  let stopRequested = false;
  manager.isRecording = true;
  manager.isProcessing = false;
  manager.requestStop = () => {
    stopRequested = true;
  };
  manager.armRecordingMaxDurationTimer("mediarecorder");

  assert.equal(pendingTimer.delay, 15000);
  pendingTimer.callback();
  assert.equal(stopRequested, true);
});

test("container rewrite stays provider-aware and avoids OpenAI gpt-4o native formats", () => {
  const manager = createManager();

  assert.equal(
    manager.shouldAllowAudioQualityContainerRewrite(
      new Blob(["wav"], { type: "audio/wav" }),
      "openai",
      "gpt-4o-transcribe"
    ),
    true
  );
  assert.equal(
    manager.shouldAllowAudioQualityContainerRewrite(new Blob(["webm"]), "zai", "glm-asr"),
    true
  );
  assert.equal(
    manager.shouldAllowAudioQualityContainerRewrite(
      new Blob(["webm"]),
      "assemblyai",
      "universal-2"
    ),
    true
  );
  assert.equal(
    manager.shouldAllowAudioQualityContainerRewrite(new Blob(["webm"]), "volcengine", "bigmodel"),
    true
  );
  assert.equal(
    manager.shouldAllowAudioQualityContainerRewrite(new Blob(["webm"]), "groq", "whisper-large-v3"),
    true
  );
  assert.equal(
    manager.shouldAllowAudioQualityContainerRewrite(
      new Blob(["webm"], { type: "audio/webm" }),
      "openai",
      "gpt-4o-transcribe"
    ),
    false
  );
  assert.equal(
    manager.shouldAllowAudioQualityContainerRewrite(
      new Blob(["webm"], { type: "audio/webm" }),
      "openai",
      "whisper-1"
    ),
    true
  );
});

test("voice activity detection trims silence while preserving padding and minimum output", () => {
  const manager = createManager();
  const silent = new Float32Array(16000);
  const active = voiceSamples(16000);

  const silentAnalysis = manager.analyzeVoiceActivity(silent, 16000);
  assert.equal(silentAnalysis.isSilent, true);

  const activeAnalysis = manager.analyzeVoiceActivity(active, 16000);
  assert.equal(activeAnalysis.isSilent, false);
  assert.ok(activeAnalysis.startSample <= 1120, `unexpected start: ${activeAnalysis.startSample}`);
  assert.ok(activeAnalysis.endSample >= 9280, `unexpected end: ${activeAnalysis.endSample}`);
  assert.ok(activeAnalysis.endSample - activeAnalysis.startSample >= 5600);
  assert.ok(activeAnalysis.gateThreshold >= 0.002);

  const preRolledAnalysis = manager.analyzeVoiceActivity(active, 16000, 0.5);
  assert.equal(preRolledAnalysis.isSilent, false);
  assert.equal(preRolledAnalysis.startSample, 0);
});

test("noise gate suppresses quiet frames and keeps active speech frames", () => {
  const manager = createManager();
  const frameSize = 320;
  const samples = new Float32Array(frameSize * 2);
  samples.fill(0.001, 0, frameSize);
  samples.fill(0.02, frameSize);

  const gated = manager.applyNoiseGate(samples, 16000, 0.005);

  assert.equal(gated[0], 0);
  assert.equal(gated[frameSize - 1], 0);
  assertApproximatelyEqual(gated[frameSize], 0.02);
  assertApproximatelyEqual(gated[gated.length - 1], 0.02);
});

test("resampling and WAV conversion produce a 16-bit mono audio/wav container", async () => {
  const manager = createManager();
  const input = new Float32Array(480).fill(0).map((_, index) => Math.sin(index / 12) * 0.5);
  const resampled = manager.resampleMonoSamples(input, 48000, 16000);

  assert.equal(resampled.length, 160);

  const blob = manager.monoSamplesToWavBlob(resampled, 16000);
  assert.equal(blob.type, "audio/wav");
  assert.equal(blob.size, 44 + resampled.length * 2);
  assert.equal(await blobText(blob, 0, 4), "RIFF");
  assert.equal(await blobText(blob, 8, 12), "WAVE");
  assert.equal(await blobText(blob, 12, 16), "fmt ");
  assert.equal(await blobText(blob, 36, 40), "data");
});

test("prepareAudioForTranscription decodes, VAD trims, gates, resamples, and annotates metadata", async () => {
  resetStorage();
  localStorage.setItem("audioQualityNoiseGateEnabled", "true");
  FakeAudioContext.samples = voiceSamples(48000);
  FakeAudioContext.sampleRate = 48000;
  FakeAudioContext.closed = 0;

  const manager = createManager();
  const result = await manager.prepareAudioForTranscription(
    new Blob(["encoded audio"], { type: "audio/webm" }),
    { durationSeconds: 1 },
    null,
    { allowContainerRewrite: true }
  );

  assert.equal(result.audioBlob.type, "audio/wav");
  assert.equal(await blobText(result.audioBlob, 0, 4), "RIFF");
  assert.equal(result.metadata.audioQuality.processed, true);
  assert.equal(result.metadata.audioQuality.noiseGateEnabled, true);
  assert.equal(result.metadata.audioQuality.preRollMs, 250);
  assert.equal(typeof result.metadata.audioQuality.processingDurationMs, "number");
  assert.ok(result.metadata.durationSeconds > 0);
  assert.equal(FakeAudioContext.closed, 1);
});

test("prepareAudioForTranscription leaves unsupported paths alone and fails silence explicitly", async () => {
  resetStorage();
  const manager = createManager();
  const originalBlob = new Blob(["encoded audio"], { type: "audio/webm" });

  const skipped = await manager.prepareAudioForTranscription(originalBlob, {}, null, {
    allowContainerRewrite: false,
  });
  assert.equal(skipped.audioBlob, originalBlob);
  assert.deepEqual(skipped.metadata, {});

  FakeAudioContext.samples = new Float32Array(48000);
  await assert.rejects(
    () =>
      manager.prepareAudioForTranscription(originalBlob, {}, null, {
        allowContainerRewrite: true,
      }),
    /No audio detected/
  );
});

test("audio quality controls stay schema-backed, localized, and wired into frontend verification", () => {
  for (const snippet of [
    'audioQualityProcessingEnabled: booleanSetting("audioQualityProcessingEnabled", true',
    'audioQualityNoiseGateEnabled: booleanSetting("audioQualityNoiseGateEnabled", false',
    'audioQualityPreRollMs: numberSetting("audioQualityPreRollMs", 250',
    'recordingMaxDurationSeconds: numberSetting("recordingMaxDurationSeconds", 300',
    "syncToBackend: true",
    "max: 2000",
    "min: 15",
    "max: 3600",
    "allowZero: true",
  ]) {
    assertIncludes(settingsSchemaSource, snippet);
  }

  for (const snippet of [
    "settings.recordingAudio.qualityProcessing",
    "settings.recordingAudio.noiseGate",
    "settings.recordingAudio.preRoll",
    "settings.recordingAudio.maxDuration",
    'normalizeAppSettingValue("audioQualityPreRollMs", value)',
    'normalizeAppSettingValue("recordingMaxDurationSeconds", value)',
  ]) {
    assertIncludes(settingsPageSource, snippet);
  }

  for (const key of [
    "settings.recordingAudio.qualityProcessing",
    "settings.recordingAudio.noiseGate",
    "settings.recordingAudio.preRoll",
    "settings.recordingAudio.maxDuration",
  ]) {
    const occurrences = translationsSource.match(new RegExp(`"${key}"`, "g")) || [];
    assert.equal(occurrences.length, 2, key);
  }

  assert.match(audioManagerSource, /await this\.prepareAudioForTranscription\(/);
  assert.match(
    audioManagerSource,
    /allowContainerRewrite: this\.shouldAllowAudioQualityContainerRewrite/
  );
  assert.match(audioManagerSource, /preRollMs: readMilliseconds\("audioQualityPreRollMs"/);
  assert.match(
    audioManagerSource,
    /this\.analyzeVoiceActivity\([\s\S]*settings\.preRollMs \/ 1000/
  );
  assert.match(audioManagerSource, /preRollMs: settings\.preRollMs/);
  assert.match(nativeAudioQualitySource, /read_u32_setting\([\s\S]*"audioQualityPreRollMs"/);
  assert.match(
    nativeAudioQualitySource,
    /analyze_voice_activity\(&decoded\.samples, decoded\.sample_rate, settings\.pre_roll_ms\)/
  );
  assert.match(
    nativeAudioQualitySource,
    /leading_padding_seconds = TRIM_PADDING_SECONDS\.max\(pre_roll_seconds\)/
  );
  assert.match(platformBootstrapSource, /audioQualityPreRollMs/);
  assert.match(
    platformBootstrapSource,
    /await setSetting\("audioQualityPreRollMs", audioQualityPreRollMs\)/
  );
  assert.equal(
    packageJson.scripts["test:audio-quality"],
    "node scripts/test-audio-quality-contract.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:audio-quality/);
});

(async () => {
  let failures = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
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

  console.log(`audio quality contract tests passed (${tests.length})`);
})();
