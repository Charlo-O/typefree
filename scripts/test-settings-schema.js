#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const modelRegistryDataPath = path.join(srcRoot, "models", "modelRegistryData.json");
const compiledSrcRoot = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "typefree-settings-tests-")),
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walkSourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if ([".vite", "dist"].includes(entry.name)) continue;
      files.push(...walkSourceFiles(path.join(root, entry.name)));
    } else if (entry.isFile() && /\.(?:js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(path.join(root, entry.name));
    }
  }
  return files;
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
    "config/promptContext.ts",
    "config/processingModes.ts",
    "config/processingModePromptStorage.ts",
    "features/settings/credentialMigration.ts",
    "features/settings/schema/settingsSchema.ts",
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
      "};",
      "module.exports = { platform, default: platform };",
      "",
    ].join("\n"),
    "utf8"
  );
}

prepareCompiledModules();

const constants = require(path.join(compiledSrcRoot, "config", "constants.cjs"));
const settingsSchema = require(
  path.join(compiledSrcRoot, "features", "settings", "schema", "settingsSchema.cjs")
);
const credentialMigration = require(
  path.join(compiledSrcRoot, "features", "settings", "credentialMigration.cjs")
);
const modelRegistryData = JSON.parse(fs.readFileSync(modelRegistryDataPath, "utf8"));
const credentialKeyBySensitiveSetting = {
  openaiApiKey: "OPENAI_API_KEY",
  assemblyaiApiKey: "ASSEMBLYAI_API_KEY",
  anthropicApiKey: "ANTHROPIC_API_KEY",
  geminiApiKey: "GEMINI_API_KEY",
  groqApiKey: "GROQ_API_KEY",
  deepseekApiKey: "DEEPSEEK_API_KEY",
  zaiApiKey: "ZAI_API_KEY",
  volcengineAppId: "VOLCENGINE_APP_ID",
  volcengineAccessToken: "VOLCENGINE_ACCESS_TOKEN",
  customReasoningApiKey: "CUSTOM_REASONING_API_KEY",
  customTranscriptionApiKey: "CUSTOM_TRANSCRIPTION_API_KEY",
};

const {
  createAppSettingsExportPayload,
  importAppSettingsExportPayload,
  isAppSettingKey,
  normalizeAppSettingValue,
  readAppSetting,
  readStoredAppSetting,
  searchSettingsSchema,
  SETTINGS_SCHEMA,
  SETTINGS_SCHEMA_KEYS,
  shouldSyncSettingToBackend,
  writeAppSetting,
} = settingsSchema;
const { CREDENTIAL_KEYS } = credentialMigration;

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("normalizes bounded numeric settings through the schema", () => {
  assert.equal(normalizeAppSettingValue("recordingMaxDurationSeconds", "0"), 0);
  assert.equal(normalizeAppSettingValue("recordingMaxDurationSeconds", "1"), 15);
  assert.equal(normalizeAppSettingValue("recordingMaxDurationSeconds", "9999"), 3600);
  assert.equal(normalizeAppSettingValue("recordingMaxDurationSeconds", "nope"), 300);
  assert.equal(normalizeAppSettingValue("privacyHistoryRetentionDays", "0"), 30);
  assert.equal(normalizeAppSettingValue("privacyHistoryRetentionDays", "99999"), 3650);
  assert.equal(normalizeAppSettingValue("processingModeId", "bad-mode"), "voice-polish");
  assert.equal(normalizeAppSettingValue("processingModeId", "command"), "command");
});

test("normalizes before writing and after reading local storage", () => {
  const storage = createMemoryStorage();

  assert.equal(writeAppSetting("recordingMaxDurationSeconds", 1, storage), true);
  assert.equal(storage.getItem("recordingMaxDurationSeconds"), "15");
  assert.equal(readAppSetting("recordingMaxDurationSeconds", storage), 15);

  storage.setItem("privacyHistoryRetentionDays", "99999");
  assert.equal(readAppSetting("privacyHistoryRetentionDays", storage), 3650);
});

test("imports only supported primitive settings and applies schema normalization", () => {
  const storage = createMemoryStorage();
  const result = importAppSettingsExportPayload(
    {
      settings: {
        recordingMaxDurationSeconds: 9999,
        privacyHistoryRetentionDays: 0,
        processingModeId: "bad-mode",
        openaiApiKey: "sensitive",
        unknownSetting: true,
        audioQualityProcessingEnabled: { enabled: false },
      },
    },
    { storage }
  );

  assert.equal(result.applied, 3);
  assert.equal(result.skipped, 2);
  assert.equal(result.invalid, 1);
  assert.deepEqual(result.appliedKeys.sort(), [
    "privacyHistoryRetentionDays",
    "processingModeId",
    "recordingMaxDurationSeconds",
  ]);
  assert.equal(readAppSetting("recordingMaxDurationSeconds", storage), 3600);
  assert.equal(readAppSetting("privacyHistoryRetentionDays", storage), 30);
  assert.equal(readAppSetting("processingModeId", storage), "voice-polish");
});

test("exports non-sensitive settings and tracks skipped secrets", () => {
  const storage = createMemoryStorage();
  writeAppSetting("recordingMaxDurationSeconds", 9999, storage);
  assert.equal(writeAppSetting("openaiApiKey", "secret", storage), false);
  assert.equal(storage.getItem("openaiApiKey"), null);

  const payload = createAppSettingsExportPayload(storage);

  assert.equal(payload.app, "TypeFree");
  assert.equal(payload.kind, "settings-export");
  assert.equal(payload.settings.recordingMaxDurationSeconds, 3600);
  assert.equal(Object.hasOwn(payload.settings, "openaiApiKey"), false);
  assert.equal(payload.skippedSensitiveKeys.includes("openaiApiKey"), true);
});

test("fails closed when ordinary settings writers receive sensitive keys", () => {
  const storage = createMemoryStorage();
  const sensitiveKeys = SETTINGS_SCHEMA_KEYS.filter((key) => SETTINGS_SCHEMA[key].sensitive);

  for (const key of sensitiveKeys) {
    storage.setItem(SETTINGS_SCHEMA[key].storageKey, "stale-secret");
    assert.equal(readStoredAppSetting(key, storage), null, key);
    assert.equal(readAppSetting(key, storage), SETTINGS_SCHEMA[key].defaultValue, key);
    assert.equal(writeAppSetting(key, "secret", storage), false, key);
    assert.equal(storage.getItem(SETTINGS_SCHEMA[key].storageKey), "stale-secret", key);
    storage.removeItem(SETTINGS_SCHEMA[key].storageKey);
  }

  const result = importAppSettingsExportPayload(
    {
      settings: {
        openaiApiKey: "secret",
        recordingMaxDurationSeconds: 9999,
      },
    },
    { storage }
  );

  assert.equal(result.applied, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.invalid, 0);
  assert.equal(storage.getItem("openaiApiKey"), null);
  assert.equal(readAppSetting("recordingMaxDurationSeconds", storage), 3600);
});

test("keeps sensitive settings out of backend sync", () => {
  const sensitiveKeys = SETTINGS_SCHEMA_KEYS.filter((key) => SETTINGS_SCHEMA[key].sensitive);
  assert.ok(sensitiveKeys.length > 0);
  assert.deepEqual([...sensitiveKeys].sort(), Object.keys(credentialKeyBySensitiveSetting).sort());
  assert.deepEqual(CREDENTIAL_KEYS, credentialKeyBySensitiveSetting);

  for (const key of sensitiveKeys) {
    assert.equal(shouldSyncSettingToBackend(key), false, key);
  }
});

test("keeps settings import API free of sensitive import switches", () => {
  const schemaSource = fs.readFileSync(
    path.join(srcRoot, "features/settings/schema/settingsSchema.ts"),
    "utf8"
  );

  assert.doesNotMatch(schemaSource, /\bincludeSensitive\b/);
});

test("keeps sensitive setting mirrors on the credential-store boundary", () => {
  const credentialMigrationSource = fs.readFileSync(
    path.join(srcRoot, "features/settings/credentialMigration.ts"),
    "utf8"
  );
  const useSettingsSource = fs.readFileSync(
    path.join(srcRoot, "features/settings/hooks/useSettings.ts"),
    "utf8"
  );
  const rustSettingsSource = fs.readFileSync(
    path.join(repoRoot, "src-tauri/src/commands/settings.rs"),
    "utf8"
  );

  for (const [settingKey, credentialKey] of Object.entries(credentialKeyBySensitiveSetting)) {
    assert.match(
      credentialMigrationSource,
      new RegExp(`${settingKey}: "${credentialKey}"`),
      `${settingKey} must write through the platform credential store`
    );
    assert.match(
      rustSettingsSource,
      new RegExp(`\\("${settingKey}", "${credentialKey}"\\)`),
      `${settingKey} must be guarded by the Rust settings facade`
    );
  }

  assert.match(credentialMigrationSource, /platform\.runtime\.isTauri\(\)/);
  assert.match(credentialMigrationSource, /for \(const key of SETTINGS_SCHEMA_KEYS\)/);
  assert.match(credentialMigrationSource, /SETTINGS_SCHEMA\[key\]\.sensitive/);
  assert.match(credentialMigrationSource, /platform\.secrets\.get\(key\)/);
  assert.match(credentialMigrationSource, /platform\.secrets\.set\(key, value\)/);
  assert.match(credentialMigrationSource, /storage\.removeItem\(definition\.storageKey\)/);
  assert.match(
    credentialMigrationSource,
    /export async function migrateLegacyCredentialMirrorsToCredentialStore/
  );
  assert.match(useSettingsSource, /hydrateCredentialSetting/);
  assert.match(useSettingsSource, /persistCredentialInBackground/);
  assert.doesNotMatch(useSettingsSource, /const CREDENTIAL_KEYS/);
  assert.doesNotMatch(useSettingsSource, /function readLegacyCredentialMirror/);
  assert.match(rustSettingsSource, /fn credential_key_for_sensitive_setting/);
  assert.match(rustSettingsSource, /fn reject_sensitive_setting_key/);
  assert.match(
    rustSettingsSource,
    /pub fn set_setting_value\([\s\S]*reject_sensitive_setting_key\(&key\)\?;/
  );
  assert.match(
    rustSettingsSource,
    /pub fn get_setting_value\([\s\S]*migrate_sensitive_setting_value\(&app, credential_key, &key\)\?;[\s\S]*return Ok\(None\);/
  );
  assert.match(
    rustSettingsSource,
    /pub fn get_all_settings\([\s\S]*migrate_all_sensitive_settings\(&app\)/
  );
});

test("migrates legacy credential mirrors before mounting the renderer", () => {
  const mainSource = fs.readFileSync(path.join(srcRoot, "main.tsx"), "utf8");
  const migrationIndex = mainSource.indexOf(
    "await migrateLegacyCredentialMirrorsToCredentialStore();"
  );
  const renderIndex = mainSource.indexOf("ReactDOM.createRoot");

  assert.match(
    mainSource,
    /import \{ migrateLegacyCredentialMirrorsToCredentialStore \} from "\.\/features\/settings\/credentialMigration";/
  );
  assert.ok(migrationIndex >= 0, "main.tsx must await credential mirror migration");
  assert.ok(
    renderIndex > migrationIndex,
    "credential mirror migration must run before ReactDOM.createRoot"
  );
  assert.match(mainSource, /void mountApp\(\);/);
});

test("keeps sensitive setting keys out of ordinary settings sources and sinks", () => {
  const sensitiveLiteralKeys = [
    ...Object.keys(credentialKeyBySensitiveSetting),
    ...new Set(Object.values(credentialKeyBySensitiveSetting)),
  ];
  const sourceFiles = walkSourceFiles(srcRoot);

  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");

    for (const key of sensitiveLiteralKeys) {
      const literal = escapeRegExp(key);
      const forbiddenSinks = [
        new RegExp(`platform\\.settings\\.set\\(\\s*["']${literal}["']`),
        new RegExp(`setSetting\\(\\s*["']${literal}["']`),
        new RegExp(`writeAppSetting\\(\\s*["']${literal}["']`),
        new RegExp(`localStorage\\.setItem\\(\\s*["']${literal}["']`),
        new RegExp(`window\\.localStorage\\.setItem\\(\\s*["']${literal}["']`),
      ];
      const forbiddenSources = [
        new RegExp(`platform\\.settings\\.get\\(\\s*["']${literal}["']`),
        new RegExp(`getSetting\\(\\s*["']${literal}["']`),
        new RegExp(`readAppSetting\\(\\s*["']${literal}["']`),
        new RegExp(`readStoredAppSetting\\(\\s*["']${literal}["']`),
        new RegExp(`localStorage\\.getItem\\(\\s*["']${literal}["']`),
        new RegExp(`window\\.localStorage\\.getItem\\(\\s*["']${literal}["']`),
      ];

      for (const sinkPattern of forbiddenSinks) {
        assert.doesNotMatch(
          source,
          sinkPattern,
          `${relativePath} must not write ${key} through an ordinary settings/localStorage sink`
        );
      }

      for (const sourcePattern of forbiddenSources) {
        assert.doesNotMatch(
          source,
          sourcePattern,
          `${relativePath} must not read ${key} through an ordinary settings/localStorage source`
        );
      }
    }
  }
});

test("keeps runtime services off legacy localStorage credential mirrors", () => {
  const runtimeCredentialConsumers = [
    "services/ReasoningService.ts",
    "features/dictation/audio/audioManager.ts",
  ];
  const sensitiveLiteralKeys = [
    ...Object.keys(credentialKeyBySensitiveSetting),
    ...new Set(Object.values(credentialKeyBySensitiveSetting)),
  ];

  for (const relativePath of runtimeCredentialConsumers) {
    const source = fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
    for (const key of sensitiveLiteralKeys) {
      const literal = escapeRegExp(key);
      assert.doesNotMatch(
        source,
        new RegExp(`(?:window\\.)?localStorage\\??\\.getItem\\(\\s*["']${literal}["']`),
        `${relativePath} must read ${key} from platform.secrets instead of localStorage`
      );
    }
  }

  const reasoningServiceSource = fs.readFileSync(
    path.join(srcRoot, "services/ReasoningService.ts"),
    "utf8"
  );
  const audioManagerSource = fs.readFileSync(
    path.join(srcRoot, "features/dictation/audio/audioManager.ts"),
    "utf8"
  );

  assert.match(reasoningServiceSource, /platform\.secrets\.get\("CUSTOM_REASONING_API_KEY"\)/);
  assert.match(reasoningServiceSource, /platform\.secrets\.get\("DEEPSEEK_API_KEY"\)/);
  assert.match(audioManagerSource, /readSecretCredential\("CUSTOM_TRANSCRIPTION_API_KEY"\)/);
  assert.match(audioManagerSource, /readSecretCredential\("VOLCENGINE_ACCESS_TOKEN"\)/);
});

test("keeps transcription base defaults aligned with the provider registry", () => {
  const openaiProvider = modelRegistryData.transcriptionProviders.find(
    (provider) => provider.id === "openai"
  );
  assert.ok(openaiProvider);

  assert.equal(constants.API_ENDPOINTS.TRANSCRIPTION_BASE, openaiProvider.baseUrl);
  assert.equal(SETTINGS_SCHEMA.cloudTranscriptionBaseUrl.defaultValue, openaiProvider.baseUrl);

  const constantsSource = fs.readFileSync(path.join(srcRoot, "config/constants.ts"), "utf8");
  assert.match(constantsSource, /modelRegistryData\.json/);
  assert.match(constantsSource, /getRegistryTranscriptionBaseUrl\("openai"\)/);
  assert.match(
    constantsSource,
    /DEFAULT_TRANSCRIPTION_BASE\s*=\s*computeBaseUrl\([\s\S]*DEFAULT_OPENAI_TRANSCRIPTION_BASE/
  );
  assert.doesNotMatch(
    constantsSource,
    /DEFAULT_TRANSCRIPTION_BASE\s*=\s*computeBaseUrl\([\s\S]*DEFAULT_OPENAI_BASE\s*\)/
  );
});

test("does not expose Volcengine protocol resource id as an app setting", () => {
  const storage = createMemoryStorage();
  const result = importAppSettingsExportPayload(
    {
      settings: {
        volcengineResourceId: "custom-resource",
        VOLCENGINE_RESOURCE_ID: "custom-resource",
      },
    },
    { storage }
  );

  assert.equal(isAppSettingKey("volcengineResourceId"), false);
  assert.equal(Object.hasOwn(SETTINGS_SCHEMA, "volcengineResourceId"), false);
  assert.equal(SETTINGS_SCHEMA_KEYS.includes("volcengineResourceId"), false);
  assert.equal(searchSettingsSchema("resource id").includes("volcengineResourceId"), false);
  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 2);
  assert.equal(storage.getItem("volcengineResourceId"), null);
});

test("keeps Volcengine resource id out of frontend settings persistence", () => {
  const schemaSource = fs.readFileSync(
    path.join(srcRoot, "features/settings/schema/settingsSchema.ts"),
    "utf8"
  );
  const useSettingsSource = fs.readFileSync(
    path.join(srcRoot, "features/settings/hooks/useSettings.ts"),
    "utf8"
  );
  const settingsCommandsSource = fs.readFileSync(
    path.join(srcRoot, "shared/platform/settingsCommands.ts"),
    "utf8"
  );

  assert.doesNotMatch(schemaSource, /\bvolcengineResourceId\b/);
  assert.doesNotMatch(useSettingsSource, /\bvolcengineResourceId\b/);
  assert.doesNotMatch(useSettingsSource, /VOLCENGINE_RESOURCE_ID/);
  assert.doesNotMatch(settingsCommandsSource, /VOLCENGINE_RESOURCE_ID/);
  assert.match(settingsCommandsSource, /getVolcengineResourceId/);
  assert.match(settingsCommandsSource, /saveVolcengineResourceId/);
});

test("exposes backend sync and search metadata for settings UI", () => {
  assert.equal(shouldSyncSettingToBackend("audioQualityProcessingEnabled"), true);
  assert.equal(shouldSyncSettingToBackend("audioQualityNoiseGateEnabled"), true);
  assert.equal(shouldSyncSettingToBackend("audioQualityPreRollMs"), true);
  assert.equal(shouldSyncSettingToBackend("recordingMaxDurationSeconds"), true);
  assert.equal(shouldSyncSettingToBackend("privacyApplicationBlacklist"), true);
  assert.equal(shouldSyncSettingToBackend("privacyPauseHistoryInBlacklistedApps"), true);
  assert.equal(shouldSyncSettingToBackend("privacyPauseClipboardInBlacklistedApps"), true);
  assert.equal(shouldSyncSettingToBackend("privacyAutoDeleteHistoryEnabled"), true);
  assert.equal(shouldSyncSettingToBackend("privacyHistoryRetentionDays"), true);
  assert.equal(searchSettingsSchema("noise gate").includes("audioQualityNoiseGateEnabled"), true);
  assert.equal(searchSettingsSchema("pre-roll").includes("audioQualityPreRollMs"), true);
  assert.equal(searchSettingsSchema("duration").includes("recordingMaxDurationSeconds"), true);
  assert.equal(searchSettingsSchema("auto delete").includes("privacyHistoryRetentionDays"), true);
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

  console.log(`settings schema tests passed (${tests.length})`);
})();
