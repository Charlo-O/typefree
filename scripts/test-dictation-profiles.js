#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const compiledSrcRoot = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "typefree-profile-tests-")),
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
  for (const file of ["features/settings/dictationProfiles.ts"]) {
    compileSourceFile(file);
  }
}

prepareCompiledModules();

const dictationProfiles = require(
  path.join(compiledSrcRoot, "features", "settings", "dictationProfiles.cjs")
);
const settingsPage = fs.readFileSync(
  path.join(srcRoot, "features", "settings", "ui", "SettingsPage.tsx"),
  "utf8"
);
const translations = fs.readFileSync(path.join(srcRoot, "i18n", "translations.ts"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const {
  DICTATION_PROFILES_STORAGE_KEY,
  MAX_DICTATION_PROFILES,
  deleteDictationProfile,
  readDictationProfiles,
  saveDictationProfile,
} = dictationProfiles;

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("dictation profiles save scene settings without secrets", () => {
  const storage = createMemoryStorage();
  const { profile } = saveDictationProfile(
    {
      name: " Coding ",
      settings: {
        preferredLanguage: "zh",
        cloudTranscriptionProvider: "openai",
        cloudTranscriptionModel: "gpt-4o-mini-transcribe",
        cloudTranscriptionBaseUrl: "https://api.openai.com/v1",
        processingModeId: "bad-mode",
        useReasoningModel: false,
        reasoningModel: "gpt-4.1-mini",
        cloudReasoningBaseUrl: "https://api.openai.com/v1",
        dictationKey: "Ctrl+Space",
        dictationTriggerMode: "double",
        activationMode: "push",
        promptVersionId: "prompt-v1",
        customPromptRaw: '"prompt"',
      },
    },
    { storage }
  );

  assert.equal(profile.id, "coding");
  assert.equal(profile.name, "Coding");
  assert.equal(profile.settings.processingModeId, "voice-polish");
  assert.equal(profile.settings.useReasoningModel, false);
  assert.equal(profile.settings.vocabularyProfileId, profile.id);
  assert.equal(profile.settings.promptVersionId, "prompt-v1");

  const raw = storage.getItem(DICTATION_PROFILES_STORAGE_KEY);
  assert.ok(raw);
  assert.doesNotMatch(raw, /ApiKey|API_KEY|openaiApiKey|secret/);
});

test("dictation profiles update, cap, and delete stored profiles", () => {
  const storage = createMemoryStorage();
  for (let index = 0; index < MAX_DICTATION_PROFILES + 3; index += 1) {
    saveDictationProfile(
      {
        name: `Profile ${index}`,
        settings: {
          preferredLanguage: "en",
          cloudTranscriptionProvider: "groq",
          cloudTranscriptionModel: "whisper-large-v3",
        },
      },
      { storage }
    );
  }

  assert.equal(readDictationProfiles(storage).length, MAX_DICTATION_PROFILES);

  const updated = saveDictationProfile(
    {
      id: "profile-5",
      name: "Updated",
      settings: {
        preferredLanguage: "ja",
        cloudTranscriptionProvider: "openai",
        cloudTranscriptionModel: "gpt-4o-transcribe",
        vocabularyProfileId: "custom-vocab",
      },
    },
    { storage }
  ).profile;

  assert.equal(updated.createdAt <= updated.updatedAt, true);
  assert.equal(readDictationProfiles(storage)[0].id, "profile-5");
  assert.equal(readDictationProfiles(storage)[0].settings.vocabularyProfileId, "custom-vocab");

  const afterDelete = deleteDictationProfile("profile-5", storage);
  assert.equal(
    afterDelete.some((profile) => profile.id === "profile-5"),
    false
  );
});

test("SettingsPage exposes save and apply profile workflow", () => {
  for (const snippet of [
    "readDictationProfiles",
    "saveDictationProfile",
    "deleteDictationProfile",
    "handleSaveDictationProfile",
    "handleApplyDictationProfile",
    "restoreCurrentPromptRaw",
    "setActivePromptVersionId",
    "setVocabularyActiveProfile",
    "registerHotkey",
    "settings.profiles.title",
    "settings.profiles.saveCurrent",
    "settings.profiles.apply",
  ]) {
    assert.match(settingsPage, new RegExp(snippet), snippet);
  }

  const saveHandler = settingsPage.match(
    /const handleSaveDictationProfile = useCallback\(async \(\) => \{[\s\S]*?\n\s{2}const handleApplyDictationProfile/
  );
  assert.ok(saveHandler, "save profile handler not found");
  assert.doesNotMatch(saveHandler[0], /ApiKey|apiKey|AccessToken|accessToken/);
});

test("dictation profile strings are localized and verified", () => {
  for (const key of [
    "settings.profiles.title",
    "settings.profiles.desc",
    "settings.profiles.namePlaceholder",
    "settings.profiles.saveCurrent",
    "settings.profiles.empty",
    "settings.profiles.apply",
    "settings.profiles.delete",
    "settings.profiles.savedTitle",
    "settings.profiles.appliedTitle",
  ]) {
    const occurrences = translations.match(new RegExp(`"${key}"`, "g")) || [];
    assert.equal(occurrences.length, 2, key);
  }

  assert.equal(
    packageJson.scripts["test:dictation-profiles"],
    "node scripts/test-dictation-profiles.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:dictation-profiles/);
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

console.log(`dictation profile tests passed (${tests.length})`);
