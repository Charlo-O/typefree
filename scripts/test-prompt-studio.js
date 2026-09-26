#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const compiledSrcRoot = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "typefree-prompt-studio-tests-")),
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
  const outputText = output.outputText.replace(
    /require\("(\.{1,2}\/[^"]+)"\)/g,
    (match, request) => {
      const target = path.resolve(sourceDir, request);
      let nextRequest = null;
      if (fs.existsSync(`${target}.ts`) || fs.existsSync(`${target}.tsx`)) {
        nextRequest = `${request}.cjs`;
      } else if (fs.existsSync(path.join(target, "index.ts"))) {
        nextRequest = `${request}/index.cjs`;
      }

      return nextRequest ? `require("${nextRequest}")` : match;
    }
  );

  const outputPath = path.join(compiledSrcRoot, relativePath).replace(/\.tsx?$/, ".cjs");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputText, "utf8");
}

function prepareCompiledModules() {
  const sourceFiles = [
    "config/promptStorage.ts",
    "config/promptContext.ts",
    "config/processingModePromptStorage.ts",
    "config/processingModes.ts",
    "config/promptQuality.ts",
    "features/promptStudio/promptVersions.ts",
    "features/promptStudio/promptTestSamples.ts",
    "features/promptStudio/promptTestRuns.ts",
  ];

  for (const file of sourceFiles) {
    compileSourceFile(file);
  }

  const platformMockPath = path.join(compiledSrcRoot, "shared", "platform", "index.cjs");
  fs.mkdirSync(path.dirname(platformMockPath), { recursive: true });
  fs.writeFileSync(
    platformMockPath,
    [
      "const platform = {",
      "  clipboard: { readText: async () => '' },",
      "};",
      "module.exports = { platform, default: platform };",
      "",
    ].join("\n"),
    "utf8"
  );
}

prepareCompiledModules();

const promptVersions = require(
  path.join(compiledSrcRoot, "features", "promptStudio", "promptVersions.cjs")
);
const promptTestSamples = require(
  path.join(compiledSrcRoot, "features", "promptStudio", "promptTestSamples.cjs")
);
const promptTestRuns = require(
  path.join(compiledSrcRoot, "features", "promptStudio", "promptTestRuns.cjs")
);
const promptQuality = require(path.join(compiledSrcRoot, "config", "promptQuality.cjs"));
const promptStorage = require(path.join(compiledSrcRoot, "config", "promptStorage.cjs"));
const processingModePromptStorage = require(
  path.join(compiledSrcRoot, "config", "processingModePromptStorage.cjs")
);
const processingModes = require(path.join(compiledSrcRoot, "config", "processingModes.cjs"));

const promptStudioUi = fs.readFileSync(
  path.join(srcRoot, "features", "promptStudio", "ui", "PromptStudio.tsx"),
  "utf8"
);
const translations = fs.readFileSync(path.join(srcRoot, "i18n", "translations.ts"), "utf8");
const platformBootstrapSource = fs.readFileSync(
  path.join(srcRoot, "shared", "platform", "platformBootstrap.ts"),
  "utf8"
);
const nativePostprocessingSource = fs.readFileSync(
  path.join(repoRoot, "src-tauri", "src", "commands", "postprocessing.rs"),
  "utf8"
);
const processingModesSource = fs.readFileSync(
  path.join(srcRoot, "config", "processingModes.ts"),
  "utf8"
);
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("prompt versions persist active version and current prompt raw value", () => {
  const storage = createMemoryStorage();
  const { version } = promptVersions.savePromptVersion("first prompt", {
    storage,
    score: 72,
  });
  assert.equal(promptVersions.readActivePromptVersionId(storage), version.id);
  assert.equal(promptVersions.readPromptVersions(storage)[0].score, 72);
  assert.equal(promptVersions.readPromptVersions(storage)[0].charCount, "first prompt".length);

  const rollback = promptVersions.savePromptVersion("rolled back prompt", {
    storage,
    source: "rollback",
    score: 88,
  });
  assert.equal(rollback.version.source, "rollback");
  assert.equal(promptVersions.readActivePromptVersionId(storage), rollback.version.id);
  assert.equal(promptVersions.readPromptVersions(storage)[0].source, "rollback");

  promptVersions.writeCurrentPrompt("custom prompt", storage);
  assert.equal(
    storage.getItem(promptStorage.CUSTOM_UNIFIED_PROMPT_STORAGE_KEY),
    JSON.stringify("custom prompt")
  );
  assert.equal(promptVersions.readCurrentPromptRaw(storage), JSON.stringify("custom prompt"));

  promptVersions.restoreCurrentPromptRaw(null, storage);
  assert.equal(storage.getItem(promptStorage.CUSTOM_UNIFIED_PROMPT_STORAGE_KEY), null);

  promptVersions.setActivePromptVersionId(null, storage);
  assert.equal(promptVersions.readActivePromptVersionId(storage), null);
});

test("processing mode prompts persist per-mode overrides and feed the runtime prompt", () => {
  const storage = createMemoryStorage();
  const mode = processingModes.getProcessingModeById("voice-polish");
  const originalWindow = global.window;
  global.window = { localStorage: storage };

  try {
    assert.equal(processingModes.getProcessingModePrompt(mode), mode.systemPrompt);

    const customPrompt = "  Custom voice polish rules. Return only the final text.  ";
    const overrides = processingModePromptStorage.setStoredProcessingModePrompt(
      "voice-polish",
      customPrompt,
      storage
    );

    assert.equal(overrides["voice-polish"], customPrompt.trim());
    assert.equal(processingModes.getProcessingModePrompt(mode), customPrompt.trim());
    assert.match(
      processingModes.buildModeSystemPrompt(mode, "TypeFree"),
      /Custom voice polish rules/
    );

    processingModePromptStorage.setStoredProcessingModePrompt(
      "prompt-optimize",
      "custom optimizer",
      storage
    );
    assert.equal(
      processingModePromptStorage.readProcessingModePromptOverrides(storage)["prompt-optimize"],
      "custom optimizer"
    );

    processingModePromptStorage.setStoredProcessingModePrompt(
      "command",
      "command mode test prompt",
      storage
    );
    assert.equal(
      processingModePromptStorage.readProcessingModePromptOverrides(storage).command,
      "command mode test prompt"
    );

    processingModePromptStorage.clearStoredProcessingModePrompt("voice-polish", storage);
    assert.equal(processingModes.getProcessingModePrompt(mode), mode.systemPrompt);
  } finally {
    global.window = originalWindow;
  }
});

test("prompt versions, samples, and runs stay capped and support deletion", () => {
  const storage = createMemoryStorage();
  for (let index = 0; index < promptVersions.MAX_PROMPT_VERSIONS + 3; index += 1) {
    promptVersions.savePromptVersion(`prompt ${index}`, { storage, score: index });
  }
  assert.equal(
    promptVersions.readPromptVersions(storage).length,
    promptVersions.MAX_PROMPT_VERSIONS
  );

  for (let index = 0; index < promptTestSamples.MAX_PROMPT_TEST_SAMPLES + 2; index += 1) {
    promptTestSamples.savePromptTestSample({
      input: `sample ${index}`,
      selectedText: "selected",
      clipboardText: "clipboard",
      storage,
    });
  }
  const samples = promptTestSamples.readPromptTestSamples(storage);
  assert.equal(samples.length, promptTestSamples.MAX_PROMPT_TEST_SAMPLES);
  assert.equal(samples[0].selectedText, "selected");
  assert.equal(samples[0].clipboardText, "clipboard");
  assert.equal(
    promptTestSamples
      .deletePromptTestSample(samples[0].id, storage)
      .some((sample) => sample.id === samples[0].id),
    false
  );

  for (let index = 0; index < promptTestRuns.MAX_PROMPT_TEST_RUNS + 5; index += 1) {
    promptTestRuns.savePromptTestRun({
      input: `input ${index}`,
      selectedText: "",
      clipboardText: "",
      promptVersionId: `version-${index}`,
      promptScore: 80,
      promptCharCount: 1200,
      provider: "openai",
      model: "gpt-4.1-mini",
      output: `output ${index}`,
      error: index % 2 === 0 ? null : "failed",
      durationMs: index,
      comparisonId: index < 2 ? "comparison-a" : undefined,
      storage,
    });
  }
  const runs = promptTestRuns.readPromptTestRuns(storage);
  assert.equal(runs.length, promptTestRuns.MAX_PROMPT_TEST_RUNS);
  assert.equal(runs[0].provider, "openai");
  assert.equal(runs[0].model, "gpt-4.1-mini");
  assert.equal(
    promptTestRuns.deletePromptTestRun(runs[0].id, storage).some((run) => run.id === runs[0].id),
    false
  );
});

test("prompt quality scoring rewards complete dictation prompt requirements", () => {
  const weak = promptQuality.scorePromptTemplate("rewrite this", { contextEnabled: false });
  const strong = promptQuality.scorePromptTemplate(
    [
      "You clean speech dictation transcripts and polish transcription output.",
      "Output only the processed text; do not answer question-like speech.",
      "Handle self-correction and false starts.",
      "Avoid a single numbered item when there is only one point.",
      "Normalize number, percentage, percent, and time expressions.",
      "Preserve technical terms, proper nouns, acronyms, and code-like text.",
      "Use selected text and clipboard context only inside clear boundaries.",
      "Format numbered list, bullet, paragraph, and email content without over-formatting.",
      "Preserve tone, intent, formality, and natural voice.",
    ].join("\n"),
    { contextEnabled: true }
  );

  assert.equal(strong.total, 10);
  assert.equal(strong.maxScore, 100);
  assert.equal(strong.score > weak.score, true);
  assert.equal(strong.passed > weak.passed, true);
});

test("PromptStudio UI wires versioning, samples, runs, and comparison workflows", () => {
  for (const snippet of [
    "savePromptVersion",
    "readPromptVersions",
    "readActivePromptVersionId",
    "restorePromptVersion",
    'source: "rollback"',
    "savePromptTestSample",
    "deletePromptTestSample",
    "savePromptTestRun",
    "deletePromptTestRun",
    "comparePromptVersions",
    "compareSameVersionTitle",
    "comparisonId",
    "promptStudio.versionsTitle",
    "promptStudio.samplesTitle",
    "promptStudio.compareTitle",
    "promptStudio.runsTitle",
    "renderProcessingModePrompts",
    "setStoredProcessingModePrompt",
    "resetProcessingModePrompt",
  ]) {
    assert.match(promptStudioUi, new RegExp(snippet), snippet);
  }

  assert.match(promptStudioUi, /if \(compareLeftVersionId === compareRightVersionId\)/);
  assert.match(promptStudioUi, /setCompareRuns\(nextCompareRuns\)/);
  assert.match(promptStudioUi, /setTestRuns\(deletePromptTestRun\(run\.id\)\)/);
});

test("processing mode prompts sync to the native post-processing path", () => {
  assert.match(platformBootstrapSource, /customProcessingModePrompts/);
  assert.match(nativePostprocessingSource, /custom_system_prompt_for_mode/);
  assert.match(nativePostprocessingSource, /system_prompt_for_mode\(&app, &mode\)/);
  assert.match(processingModesSource, /id: "command"/);
  assert.match(processingModesSource, /帮我翻译/);
  assert.match(nativePostprocessingSource, /"command"/);
  assert.match(nativePostprocessingSource, /帮我翻译/);
});

test("Prompt Studio strings are localized and verification is wired", () => {
  for (const key of [
    "promptStudio.qualityScore",
    "promptStudio.qualityPassed",
    "promptStudio.qualityMissing",
    "promptStudio.versionsTitle",
    "promptStudio.versionActive",
    "promptStudio.versionMeta",
    "promptStudio.restoreVersion",
    "promptStudio.saveSample",
    "promptStudio.samplesTitle",
    "promptStudio.deleteSample",
    "promptStudio.compareTitle",
    "promptStudio.compareVersionA",
    "promptStudio.compareVersionB",
    "promptStudio.compareRun",
    "promptStudio.runsTitle",
    "promptStudio.runsCount",
    "promptStudio.runMeta",
    "promptStudio.deleteRun",
    "promptStudio.unsavedPrompt",
    "promptStudio.processingModePromptsTitle",
    "promptStudio.processingModePromptsDesc",
    "promptStudio.processingModePromptSelect",
    "promptStudio.processingModePromptDefault",
    "promptStudio.processingModePromptCustomized",
    "promptStudio.processingModePromptPlaceholder",
    "promptStudio.processingModePromptVariables",
    "promptStudio.saveModePrompt",
    "promptStudio.resetModePrompt",
    "promptStudio.modePromptSavedTitle",
    "promptStudio.modePromptSavedDesc",
    "promptStudio.modePromptResetTitle",
    "promptStudio.modePromptResetDesc",
  ]) {
    const occurrences = translations.match(new RegExp(`"${key}"`, "g")) || [];
    assert.equal(occurrences.length, 2, key);
  }

  assert.equal(packageJson.scripts["test:prompt-studio"], "node scripts/test-prompt-studio.js");
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:prompt-studio/);
});

let failures = 0;

for (const { name, fn } of tests) {
  try {
    fn();
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

console.log(`prompt studio tests passed (${tests.length})`);
