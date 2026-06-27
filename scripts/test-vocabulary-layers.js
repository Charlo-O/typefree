#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const compiledSrcRoot = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "typefree-vocabulary-tests-")),
  "src"
);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
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

  const outputPath = path.join(compiledSrcRoot, relativePath).replace(/\.tsx?$/, ".cjs");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputText, "utf8");
}

function prepareCompiledModules() {
  const sourceFiles = ["features/vocabulary/vocabularyLayers.ts", "utils/vocabulary.ts"];

  for (const file of sourceFiles) {
    compileSourceFile(file);
  }

  const platformMockPath = path.join(compiledSrcRoot, "shared", "platform", "index.cjs");
  fs.mkdirSync(path.dirname(platformMockPath), { recursive: true });
  fs.writeFileSync(
    platformMockPath,
    [
      "const platform = {",
      "  settings: { get: async () => null, set: async () => undefined },",
      "};",
      "module.exports = { platform, default: platform };",
      "",
    ].join("\n"),
    "utf8"
  );
}

prepareCompiledModules();

const vocabularyLayers = require(
  path.join(compiledSrcRoot, "features", "vocabulary", "vocabularyLayers.cjs")
);
const vocabularyUtils = require(path.join(compiledSrcRoot, "utils", "vocabulary.cjs"));

const windowCommands = read(path.join(repoRoot, "src-tauri", "src", "commands", "window.rs"));
const privacyCommands = read(path.join(repoRoot, "src-tauri", "src", "commands", "privacy.rs"));
const vocabularyCommands = read(
  path.join(repoRoot, "src-tauri", "src", "commands", "vocabulary.rs")
);
const hotkeyCommands = read(path.join(repoRoot, "src-tauri", "src", "commands", "hotkey.rs"));
const dictationCommands = read(path.join(repoRoot, "src-tauri", "src", "commands", "dictation.rs"));
const batchService = read(
  path.join(repoRoot, "src-tauri", "src", "transcription", "batch_service.rs")
);
const volcengineStreaming = read(
  path.join(repoRoot, "src-tauri", "src", "transcription", "volcengine", "streaming.rs")
);
const postprocessingCommands = read(
  path.join(repoRoot, "src-tauri", "src", "commands", "postprocessing.rs")
);
const platformCommands = read(path.join(srcRoot, "shared", "platform", "platformCommands.ts"));
const tauriPlatform = read(path.join(srcRoot, "shared", "platform", "tauriPlatform.ts"));
const useAudioRecording = read(
  path.join(srcRoot, "features", "dictation", "hooks", "useAudioRecording.ts")
);

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function activeVocabularySample() {
  let layers = vocabularyLayers.normalizeVocabularyLayers(undefined, [], []);
  layers = vocabularyLayers.setVocabularyActiveApplication(layers, "code-editor");
  layers = vocabularyLayers.addVocabularyScopedHotword(
    layers,
    "application",
    "code-editor",
    "ProjectPhoenix"
  );
  layers = vocabularyLayers.addVocabularyScopedHotword(
    layers,
    "application",
    "mail",
    "MailOnlyTerm"
  );
  layers = vocabularyLayers.addVocabularyScopedSnippet(layers, "application", "code-editor", {
    trigger: "repo harness",
    replacement: "repo-harness",
  });
  layers = vocabularyLayers.addVocabularyScopedSnippet(layers, "application", "mail", {
    trigger: "mail harness",
    replacement: "mail-harness",
  });
  const packResult = vocabularyLayers.createVocabularyContextPack(layers, "Sprint Alpha");
  layers = packResult.layers;
  const packId = packResult.pack.id;
  layers = vocabularyLayers.addVocabularyContextPackHotword(layers, packId, "ContextOnlyTerm");
  layers = vocabularyLayers.addVocabularyContextPackSnippet(layers, packId, {
    trigger: "alpha pack",
    replacement: "Sprint Alpha Pack",
  });
  layers = vocabularyLayers.setVocabularyContextPackActive(layers, packId, true);

  return { layers, packId };
}

test("active application and context-pack layers feed effective vocabulary", () => {
  const { layers } = activeVocabularySample();
  const settings = vocabularyUtils.normalizeVocabularySettings({
    hotwordsEnabled: true,
    snippetsEnabled: true,
    userHotwords: ["GlobalTerm"],
    userSnippets: [{ trigger: "global phrase", replacement: "Global Phrase" }],
    layers,
  });

  const hotwords = vocabularyUtils.getEffectiveHotwords(settings);
  const snippets = vocabularyUtils.getEffectiveSnippets(settings);
  const snippetMap = new Map(snippets.map((snippet) => [snippet.trigger, snippet.replacement]));

  assert.equal(hotwords.includes("GlobalTerm"), true);
  assert.equal(hotwords.includes("ProjectPhoenix"), true);
  assert.equal(hotwords.includes("ContextOnlyTerm"), true);
  assert.equal(hotwords.includes("MailOnlyTerm"), false);
  assert.equal(snippetMap.get("repo harness"), "repo-harness");
  assert.equal(snippetMap.get("alpha pack"), "Sprint Alpha Pack");
  assert.equal(snippetMap.has("mail harness"), false);
});

test("switching active application swaps scoped vocabulary without touching packs", () => {
  const sample = activeVocabularySample();
  const nextLayers = vocabularyLayers.setVocabularyActiveApplication(sample.layers, "mail");
  const settings = vocabularyUtils.normalizeVocabularySettings({
    hotwordsEnabled: true,
    snippetsEnabled: true,
    layers: nextLayers,
  });

  const hotwords = vocabularyUtils.getEffectiveHotwords(settings);
  const snippets = vocabularyUtils.getEffectiveSnippets(settings);
  const snippetMap = new Map(snippets.map((snippet) => [snippet.trigger, snippet.replacement]));

  assert.equal(hotwords.includes("ProjectPhoenix"), false);
  assert.equal(hotwords.includes("MailOnlyTerm"), true);
  assert.equal(hotwords.includes("ContextOnlyTerm"), true);
  assert.equal(snippetMap.has("repo harness"), false);
  assert.equal(snippetMap.get("mail harness"), "mail-harness");
  assert.equal(snippetMap.get("alpha pack"), "Sprint Alpha Pack");
});

test("foreground sync updates privacy and vocabulary runtime state", () => {
  assert.match(
    windowCommands,
    /sync_foreground_application_vocabulary[\s\S]*privacy::set_active_foreground_application/
  );
  assert.match(
    windowCommands,
    /sync_foreground_application_vocabulary[\s\S]*vocabulary::sync_active_application\(&app,\s*&application\.id\)/
  );
  assert.match(hotkeyCommands, /sync_foreground_application_vocabulary\(app_handle\.clone\(\)\)/);
  assert.match(dictationCommands, /sync_foreground_application_vocabulary\(app\.clone\(\)\)/);
  assert.match(useAudioRecording, /syncForegroundApplicationVocabulary/);
});

test("foreground sync clears stale active state when detection is unavailable", () => {
  assert.match(privacyCommands, /pub fn clear_active_foreground_application/);
  assert.match(
    privacyCommands,
    /remove_setting_value\(app\.clone\(\),\s*ACTIVE_FOREGROUND_KEY\.to_string\(\)\)/
  );
  assert.match(
    privacyCommands,
    /remove_setting_value\(app\.clone\(\),\s*ACTIVE_FOREGROUND_ID_KEY\.to_string\(\)\)/
  );
  assert.match(vocabularyCommands, /pub fn clear_active_application/);
  assert.match(
    vocabularyCommands,
    /layers\.active_application_id = None;[\s\S]*persist_layers_and_effective_vocabulary\(app,\s*&layers\)/
  );
  assert.match(
    windowCommands,
    /fn clear_foreground_application_state[\s\S]*privacy::clear_active_foreground_application[\s\S]*vocabulary::clear_active_application/
  );
  assert.match(
    windowCommands,
    /Err\(err\) => \{[\s\S]*clear_foreground_application_state\(&app\)[\s\S]*return Err\(window_error\(err\)\)/
  );
  assert.match(
    windowCommands,
    /if let Some\(application\) = foreground\.as_ref\(\)[\s\S]*\} else \{[\s\S]*clear_foreground_application_state\(&app\)/
  );
});

test("renderer foreground sync refreshes local vocabulary cache", () => {
  assert.match(
    useAudioRecording,
    /import \{ loadVocabularySettings,\s*syncVocabularySettingsToBackend \} from "..\/..\/..\/utils\/vocabulary"/
  );
  assert.match(
    useAudioRecording,
    /const foregroundApplication = await platform\.app\.syncForegroundApplicationVocabulary\(\)[\s\S]*await refreshVocabularyCache\(foregroundApplication\?\.id \|\| null\)/
  );
  assert.match(
    useAudioRecording,
    /catch \(error\) \{[\s\S]*foregroundApplicationRef\.current = null;[\s\S]*await refreshVocabularyCache\(null\)/
  );
  assert.match(useAudioRecording, /label: "vocabulary\.cache-refreshed"/);
  assert.match(useAudioRecording, /label: "vocabulary\.cache-refresh-failed"/);
});

test("platform bridge exposes foreground vocabulary sync as app capability", () => {
  assert.match(
    platformCommands,
    /syncForegroundApplicationVocabulary[\s\S]*from "\.\/privacyCommands"/
  );
  assert.match(
    tauriPlatform,
    /app:\s*\{[\s\S]*syncForegroundApplicationVocabulary:\s*tauri\.syncForegroundApplicationVocabulary/
  );
});

test("backend transcription and postprocessing consume effective vocabulary", () => {
  assert.match(batchService, /let hotwords = vocabulary::load_effective_hotwords\(app\)/);
  assert.match(volcengineStreaming, /let hotwords = vocabulary::load_effective_hotwords\(&app\)/);
  assert.match(
    postprocessingCommands,
    /vocabulary::apply_snippet_replacements\(&app,\s*&raw_text\)/
  );
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

  console.log(`vocabulary layer tests passed (${tests.length})`);
})();
