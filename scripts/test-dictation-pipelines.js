#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const modelRegistryDataPath = path.join(srcRoot, "models", "modelRegistryData.json");
const developerSection = fs.readFileSync(
  path.join(srcRoot, "features", "settings", "ui", "DeveloperSection.tsx"),
  "utf8"
);
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const compiledSrcRoot = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "typefree-pipeline-tests-")),
  "src"
);

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

const localStorage = createMemoryStorage();
global.window = {
  localStorage,
  getSelection: () => ({ toString: () => "" }),
};
global.document = {
  activeElement: null,
};
global.localStorage = localStorage;
global.performance = {
  now: () => Date.now(),
};

function compileSourceFile(relativePath) {
  const filename = path.join(srcRoot, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
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

  const outputPath = path.join(compiledSrcRoot, relativePath).replace(/\.tsx?$/, ".cjs");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputText, "utf8");
}

function prepareCompiledModules() {
  const sourceFiles = [
    "config/constants.ts",
    "config/processingModes.ts",
    "config/promptContext.ts",
    "features/dictation/pipeline/completionPipeline.ts",
    "features/dictation/pipeline/transcriptionPipeline.ts",
    "features/privacy/privacySettings.ts",
    "features/settings/schema/settingsSchema.ts",
    "features/vocabulary/vocabularyLayers.ts",
    "utils/logger.ts",
    "utils/vocabulary.ts",
  ];

  for (const file of sourceFiles) {
    compileSourceFile(file);
  }

  const compiledModelRegistryDataPath = path.join(
    compiledSrcRoot,
    "models",
    "modelRegistryData.json"
  );
  fs.mkdirSync(path.dirname(compiledModelRegistryDataPath), { recursive: true });
  fs.copyFileSync(modelRegistryDataPath, compiledModelRegistryDataPath);

  const platformMockPath = path.join(compiledSrcRoot, "shared", "platform", "index.cjs");
  fs.mkdirSync(path.dirname(platformMockPath), { recursive: true });
  fs.writeFileSync(
    platformMockPath,
    [
      "const platform = {",
      "  clipboard: { readText: async () => '' },",
      "  logging: { getLevel: async () => 'fatal', write: async () => undefined },",
      "  settings: { get: async () => null, set: async () => undefined },",
      "};",
      "module.exports = { platform, default: platform };",
      "",
    ].join("\n"),
    "utf8"
  );
}

prepareCompiledModules();

const transcriptionPipelinePath = path.join(
  compiledSrcRoot,
  "features",
  "dictation",
  "pipeline",
  "transcriptionPipeline.cjs"
);
const completionPipelinePath = path.join(
  compiledSrcRoot,
  "features",
  "dictation",
  "pipeline",
  "completionPipeline.cjs"
);

const { runTranscriptionPostProcessingPipeline } = require(transcriptionPipelinePath);
const { createDictationCompletionGuard, runDictationCompletionPipeline } = require(
  completionPipelinePath
);
const {
  createPrivacySkipReason,
  isForegroundApplicationBlacklisted,
  parsePrivacyApplicationBlacklist,
} = require(path.join(compiledSrcRoot, "features", "privacy", "privacySettings.cjs"));

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function resetStorage() {
  localStorage.clear();
  localStorage.setItem("promptContextEnabled", "false");
}

function stepNames(steps) {
  return steps.map((step) => step.name);
}

test("runs direct transcription post-processing without reasoning", async () => {
  resetStorage();
  localStorage.setItem("processingModeId", "direct");

  let reasoningChecked = false;
  const result = await runTranscriptionPostProcessingPipeline({
    text: "  Cloud Code  ",
    source: "test",
    isReasoningAvailable: async () => {
      reasoningChecked = true;
      return true;
    },
    processWithReasoningModel: async () => {
      throw new Error("reasoning should not run in direct mode");
    },
  });

  assert.equal(result.text, "Claude Code");
  assert.equal(result.usedReasoning, false);
  assert.equal(result.processingMode, "direct");
  assert.equal(result.fallbackReason, "processing-mode");
  assert.equal(reasoningChecked, false);
  assert.deepEqual(stepNames(result.steps), ["normalize", "vocabulary", "mode", "reasoning"]);
});

test("runs reasoning post-processing with explicit prompt context and prompt step", async () => {
  resetStorage();
  localStorage.setItem("processingModeId", "voice-polish");
  localStorage.setItem("reasoningModel", "gpt-4o-mini");
  localStorage.setItem("reasoningProvider", "openai");
  localStorage.setItem("agentName", "TypeFree");

  let reasoningInput = null;
  const result = await runTranscriptionPostProcessingPipeline({
    text: "chat GPT notes",
    source: "openai",
    isReasoningAvailable: async () => true,
    captureRuntimePromptContext: async () => ({
      selectedText: "selected project term",
      clipboardText: "",
      capturedAt: "2026-06-24T00:00:00.000Z",
    }),
    processWithReasoningModel: async (text, model, agentName, config) => {
      reasoningInput = { text, model, agentName, config };
      return "polished output";
    },
  });

  assert.equal(result.text, "polished output");
  assert.equal(result.normalizedText, "ChatGPT notes");
  assert.equal(result.usedReasoning, true);
  assert.equal(result.processingMode, "voice-polish");
  assert.equal(reasoningInput.text, "ChatGPT notes");
  assert.equal(reasoningInput.model, "gpt-4o-mini");
  assert.equal(reasoningInput.agentName, "TypeFree");
  assert.match(reasoningInput.config.systemPrompt, /PROMPT CONTEXT/);
  assert.match(reasoningInput.config.systemPrompt, /selected project term/);
  assert.deepEqual(stepNames(result.steps), [
    "normalize",
    "vocabulary",
    "mode",
    "prompt-context",
    "prompt",
    "reasoning",
  ]);
  assert.equal(typeof result.timings.promptBuildDurationMs, "number");
});

test("falls back to normalized text when reasoning fails", async () => {
  resetStorage();
  localStorage.setItem("processingModeId", "voice-polish");
  localStorage.setItem("reasoningModel", "gpt-4o-mini");

  const originalConsoleError = console.error;
  console.error = () => undefined;
  let result;
  try {
    result = await runTranscriptionPostProcessingPipeline({
      text: "deep seek summary",
      source: "openai",
      isReasoningAvailable: async () => true,
      captureRuntimePromptContext: async () => ({}),
      processWithReasoningModel: async () => {
        throw new Error("network down");
      },
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.text, "DeepSeek summary");
  assert.equal(result.usedReasoning, false);
  assert.equal(result.fallbackReason, "reasoning-failed");
  assert.equal(result.steps.at(-1).name, "reasoning");
  assert.equal(result.steps.at(-1).status, "failed");
});

test("matches privacy blacklist entries against foreground application candidates", () => {
  const application = {
    id: "com.company.Secret-App",
    name: "Secret App",
    platform: "windows",
    bundleId: "com.company.Secret-App",
    executablePath: "C:\\Program Files\\Secret App\\Secret App.exe",
  };

  assert.deepEqual(parsePrivacyApplicationBlacklist("Secret App;Other App"), [
    "secret-app",
    "other-app",
  ]);
  assert.equal(isForegroundApplicationBlacklisted(application, "other-app\nsecret-app"), true);
  assert.equal(isForegroundApplicationBlacklisted(application, "mail"), false);
  assert.equal(createPrivacySkipReason(application), "privacy blacklist: com.company.Secret-App");
});

test("runs completion pipeline through insert and history stages", async () => {
  resetStorage();
  const guard = createDictationCompletionGuard();
  const dispatches = [];
  const ui = { transcript: "", liveTranscript: "", audioLevel: 1 };
  const pasted = [];
  const saved = [];

  const originalConsoleLog = console.log;
  console.log = () => undefined;
  let result;
  try {
    result = await runDictationCompletionPipeline({
      result: { success: true, text: "  final text  ", source: "test" },
      sessionId: "session-a",
      guard,
      stopRequested: true,
      insertDelayMs: 0,
      dispatchSession: (event) => dispatches.push(event),
      setTranscript: (text) => {
        ui.transcript = text;
      },
      setLiveTranscript: (text) => {
        ui.liveTranscript = text;
      },
      setAudioLevel: (level) => {
        ui.audioLevel = level;
      },
      hideWindow: async () => undefined,
      pasteText: async (text) => {
        pasted.push(text);
        return true;
      },
      saveTranscription: async (text, options) => {
        saved.push({ text, options });
        return true;
      },
    });
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(result.status, "completed");
  assert.equal(result.normalizedText, "final text");
  assert.equal(ui.transcript, "  final text  ");
  assert.equal(ui.liveTranscript, "  final text  ");
  assert.equal(ui.audioLevel, 0);
  assert.deepEqual(pasted, ["  final text  "]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].text, "  final text  ");
  assert.equal(saved[0].options.sessionId, "session-a");
  assert.equal(saved[0].options.rawText, "  final text  ");
  assert.equal(saved[0].options.processedText, "  final text  ");
  assert.equal(saved[0].options.provider, null);
  assert.equal(saved[0].options.outputs.at(-1).stage, "pipeline");
  assert.match(saved[0].options.outputs.at(-1).metadataJson, /"source":"test"/);
  assert.deepEqual(
    dispatches.map((event) => event.type),
    ["inserting", "completed"]
  );
  assert.deepEqual(stepNames(result.steps), [
    "normalize",
    "dedupe",
    "ui",
    "insert",
    "clipboard-history",
    "db-history",
  ]);
  const history = JSON.parse(localStorage.getItem("clipboard.history") || "[]");
  assert.equal(history.length, 1);
  assert.equal(history[0].content, "  final text  ");
});

test("skips clipboard and db history when privacy preflight skips history", async () => {
  resetStorage();
  const guard = createDictationCompletionGuard();
  const dispatches = [];
  let saveCalled = false;

  const originalConsoleLog = console.log;
  console.log = () => undefined;
  let result;
  try {
    result = await runDictationCompletionPipeline({
      result: { success: true, text: "sensitive dictated text", source: "test" },
      sessionId: "session-privacy-preflight",
      guard,
      stopRequested: true,
      skipHistory: true,
      historySkipReason: "privacy blacklist: com.company.Secret-App",
      insertDelayMs: 0,
      dispatchSession: (event) => dispatches.push(event),
      setTranscript: () => undefined,
      setLiveTranscript: () => undefined,
      setAudioLevel: () => undefined,
      hideWindow: async () => undefined,
      pasteText: async () => true,
      saveTranscription: async () => {
        saveCalled = true;
        return true;
      },
    });
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(result.status, "completed");
  assert.deepEqual(
    dispatches.map((event) => event.type),
    ["inserting", "completed"]
  );
  assert.equal(saveCalled, false);
  assert.equal(localStorage.getItem("clipboard.history"), null);
  assert.deepEqual(
    result.steps.slice(-2).map((step) => [step.name, step.status, step.detail]),
    [
      ["clipboard-history", "skipped", "privacy blacklist: com.company.Secret-App"],
      ["db-history", "skipped", "privacy blacklist: com.company.Secret-App"],
    ]
  );
  assert.equal(guard.savedTexts.has("sensitive dictated text"), true);
});

test("fails completion when db history save fails after insert", async () => {
  resetStorage();
  const guard = createDictationCompletionGuard();
  const dispatches = [];
  const pasted = [];

  const originalConsoleLog = console.log;
  console.log = () => undefined;
  let result;
  try {
    result = await runDictationCompletionPipeline({
      result: { success: true, text: "history failure text", source: "test" },
      sessionId: "session-history-fail",
      guard,
      stopRequested: true,
      insertDelayMs: 0,
      dispatchSession: (event) => dispatches.push(event),
      setTranscript: () => undefined,
      setLiveTranscript: () => undefined,
      setAudioLevel: () => undefined,
      hideWindow: async () => undefined,
      pasteText: async (text) => {
        pasted.push(text);
        return true;
      },
      saveTranscription: async () => false,
    });
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(result.status, "failed");
  assert.match(result.error, /Dictation history save failed/);
  assert.deepEqual(pasted, ["history failure text"]);
  assert.deepEqual(
    dispatches.map((event) => event.type),
    ["inserting", "failed"]
  );
  assert.equal(dispatches.at(-1).error, result.error);
  assert.equal(result.steps.at(-1).name, "db-history");
  assert.equal(result.steps.at(-1).status, "failed");
  assert.equal(guard.savedTexts.has("history failure text"), false);
});

test("fails completion when db history save throws after insert", async () => {
  resetStorage();
  const guard = createDictationCompletionGuard();
  const dispatches = [];

  const originalConsoleLog = console.log;
  console.log = () => undefined;
  let result;
  try {
    result = await runDictationCompletionPipeline({
      result: { success: true, text: "history throw text", source: "test" },
      sessionId: "session-history-throw",
      guard,
      stopRequested: true,
      insertDelayMs: 0,
      dispatchSession: (event) => dispatches.push(event),
      setTranscript: () => undefined,
      setLiveTranscript: () => undefined,
      setAudioLevel: () => undefined,
      hideWindow: async () => undefined,
      pasteText: async () => true,
      saveTranscription: async () => {
        throw new Error("db down");
      },
    });
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(result.status, "failed");
  assert.match(result.error, /db down/);
  assert.deepEqual(
    dispatches.map((event) => event.type),
    ["inserting", "failed"]
  );
  assert.equal(result.steps.at(-1).name, "db-history");
  assert.equal(result.steps.at(-1).status, "failed");
  assert.equal(result.steps.at(-1).detail, "db down");
});

test("completes with skipped db history when history bridge reports privacy skip", async () => {
  resetStorage();
  const guard = createDictationCompletionGuard();
  const dispatches = [];

  const originalConsoleLog = console.log;
  console.log = () => undefined;
  let result;
  try {
    result = await runDictationCompletionPipeline({
      result: { success: true, text: "privacy skipped text", source: "test" },
      sessionId: "session-history-skip",
      guard,
      stopRequested: true,
      insertDelayMs: 0,
      dispatchSession: (event) => dispatches.push(event),
      setTranscript: () => undefined,
      setLiveTranscript: () => undefined,
      setAudioLevel: () => undefined,
      hideWindow: async () => undefined,
      pasteText: async () => true,
      saveTranscription: async () => ({
        success: false,
        skipped: true,
        reason: "privacy",
        message: "Transcription history skipped by privacy settings",
      }),
    });
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(result.status, "completed");
  assert.deepEqual(
    dispatches.map((event) => event.type),
    ["inserting", "completed"]
  );
  assert.equal(result.steps.at(-1).name, "db-history");
  assert.equal(result.steps.at(-1).status, "skipped");
  assert.equal(result.steps.at(-1).detail, "Transcription history skipped by privacy settings");
  const history = JSON.parse(localStorage.getItem("clipboard.history") || "[]");
  assert.equal(history.length, 1);
  assert.equal(history[0].content, "privacy skipped text");
  assert.equal(guard.savedTexts.has("privacy skipped text"), true);
});

test("keeps provider identity separate from processing source in history options", async () => {
  resetStorage();
  const guard = createDictationCompletionGuard();
  const saved = [];

  const originalConsoleLog = console.log;
  console.log = () => undefined;
  try {
    await runDictationCompletionPipeline({
      result: {
        success: true,
        text: "polished text",
        rawText: "raw text",
        normalizedText: "normalized text",
        source: "openai-realtime-voice-polish",
        provider: "openai",
        processingMode: "voice-polish",
        usedReasoning: true,
      },
      sessionId: "session-provider",
      guard,
      stopRequested: true,
      insertDelayMs: 0,
      dispatchSession: () => undefined,
      setTranscript: () => undefined,
      setLiveTranscript: () => undefined,
      setAudioLevel: () => undefined,
      hideWindow: async () => undefined,
      pasteText: async () => true,
      saveTranscription: async (text, options) => {
        saved.push({ text, options });
        return true;
      },
    });
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(saved.length, 1);
  assert.equal(saved[0].options.provider, "openai");
  assert.equal(saved[0].options.method, "voice-polish");
  assert.match(
    saved[0].options.outputs.at(-1).metadataJson,
    /"source":"openai-realtime-voice-polish"/
  );
  assert.match(saved[0].options.outputs.at(-1).metadataJson, /"usedReasoning":true/);
});

test("Developer dictation pipeline smoke runs completion without cloud STT or simulated paste", () => {
  assert.match(developerSection, /TYPEFREE_DICTATION_PIPELINE_SMOKE_RESULT/);
  assert.match(developerSection, /VITE_TYPEFREE_DICTATION_PIPELINE_SMOKE_AUTORUN/);
  assert.match(developerSection, /function shouldAutorunDictationPipelineSmoke\(\): boolean/);
  assert.match(
    developerSection,
    /const handleRunDictationPipelineSmoke = useCallback\(async \(\) =>/
  );
  assert.match(developerSection, /runDictationCompletionPipeline/);
  assert.match(developerSection, /createDictationCompletionGuard\(\)/);
  assert.match(developerSection, /source: "dictation-pipeline-smoke"/);
  assert.match(developerSection, /platform\.clipboard\.writeText\(text\)/);
  assert.match(developerSection, /platform\.clipboard\.readText\(\)/);
  assert.match(developerSection, /Clipboard text snapshot unavailable/);
  assert.match(developerSection, /finally \{/);
  assert.match(developerSection, /platform\.clipboard\.writeText\(clipboardTextToRestore\)/);
  assert.match(developerSection, /clipboardRestoreError/);
  assert.match(developerSection, /platform\.history\.saveTranscription/);
  assert.match(developerSection, /platform\.history\.getTranscriptionSession/);
  assert.match(developerSection, /recordDictationPipelineSteps/);
  assert.match(developerSection, /emitDictationPipelineSmokeResult/);

  const handlerMatch = developerSection.match(
    /const handleRunDictationPipelineSmoke = useCallback\(async \(\) => \{[\s\S]*?\n\s{2}const handleRunCloudTranscriptionSmoke/
  );
  assert.ok(handlerMatch, "dictation pipeline smoke handler not found");
  const handler = handlerMatch[0];

  for (const forbidden of [
    "transcribeAudio",
    "startNative",
    "stopNative",
    "cancelNative",
    "platform.clipboard.pasteText",
    "startRecording",
  ]) {
    assert.doesNotMatch(handler, new RegExp(forbidden), forbidden);
  }
  assert.match(handler, /db-history skipped; SQLite history was not verified/);
  assert.doesNotMatch(handler, /dbHistoryStep\?\.status === "skipped"\s*\?\s*"warning"/);
  assert.match(handler, /status: persistedSession \? "passed" : "failed"/);

  assert.equal(
    packageJson.scripts["smoke:dictation-pipeline"],
    "node scripts/run-tauri-dev-smoke.js --dictation-pipeline-smoke"
  );
  assert.doesNotMatch(packageJson.scripts["verify:frontend"], /npm run smoke:dictation-pipeline/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run smoke:dictation-pipeline/);
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

  console.log(`dictation pipeline tests passed (${tests.length})`);
})();
