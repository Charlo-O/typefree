#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const privacyRustPath = path.join(repoRoot, "src-tauri", "src", "commands", "privacy.rs");
const privacyCommandsPath = path.join(srcRoot, "shared", "platform", "privacyCommands.ts");
const commandCorePath = path.join(srcRoot, "shared", "platform", "commandCore.ts");
const desktopTypesPath = path.join(srcRoot, "types", "desktop.ts");
const developerSectionPath = path.join(
  srcRoot,
  "features",
  "settings",
  "ui",
  "DeveloperSection.tsx"
);
const translationsPath = path.join(srcRoot, "i18n", "translations.ts");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function compileTypeScript(filename) {
  const output = ts.transpileModule(read(filename), {
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

  return output.outputText;
}

function loadTypeScriptModule(filename, mocks = {}) {
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  const compiledModule = new Module(filename, module);
  compiledModule.filename = filename;
  compiledModule.paths = Module._nodeModulePaths(path.dirname(filename));
  compiledModule._compile(compileTypeScript(filename), filename);

  return {
    exports: compiledModule.exports,
    restore() {
      Module._load = originalLoad;
    },
  };
}

function createMemoryStorage(values = {}) {
  const store = new Map(Object.entries(values));
  return {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
  };
}

const privacyRust = read(privacyRustPath);
const desktopTypes = read(desktopTypesPath);
const developerSection = read(developerSectionPath);
const translations = read(translationsPath);

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("Rust privacy diagnostics exposes active and detected decision inputs", () => {
  for (const field of [
    "detected_foreground",
    "active_foreground",
    "application_blacklist",
    "detected_candidates",
    "active_candidates",
    "detected_application_blacklisted",
    "active_application_blacklisted",
    "pause_history_in_blacklisted_apps",
    "pause_clipboard_in_blacklisted_apps",
    "auto_delete_history_enabled",
    "history_retention_days",
    "effective_history_retention_days",
    "would_skip_transcription_history",
    "would_skip_clipboard_capture",
    "detection_error",
  ]) {
    assert.match(privacyRust, new RegExp(`pub ${field}:`), field);
  }

  assert.match(
    privacyRust,
    /would_skip_transcription_history:\s*pause_history_in_blacklisted_apps\s*&&\s*active_application_blacklisted/
  );
  assert.match(
    privacyRust,
    /would_skip_clipboard_capture:\s*pause_clipboard_in_blacklisted_apps\s*&&\s*detected_application_blacklisted/
  );
  assert.match(
    privacyRust,
    /pub fn should_skip_transcription_history[\s\S]*active_foreground_application\(app\)/
  );
  assert.match(
    privacyRust,
    /pub fn should_skip_clipboard_capture[\s\S]*detect_foreground_application\(\)/
  );
});

test("TypeScript PrivacyDiagnostics mirrors the Rust payload", () => {
  for (const field of [
    "detectedForeground",
    "activeForeground",
    "applicationBlacklist",
    "detectedCandidates",
    "activeCandidates",
    "detectedApplicationBlacklisted",
    "activeApplicationBlacklisted",
    "pauseHistoryInBlacklistedApps",
    "pauseClipboardInBlacklistedApps",
    "autoDeleteHistoryEnabled",
    "historyRetentionDays",
    "effectiveHistoryRetentionDays",
    "wouldSkipTranscriptionHistory",
    "wouldSkipClipboardCapture",
    "detectionError",
  ]) {
    assert.match(desktopTypes, new RegExp(`${field}:`), field);
  }
});

test("browser privacy diagnostics fallback preserves settings and explicit detection errors", async () => {
  const previousWindow = global.window;
  global.window = {
    localStorage: createMemoryStorage({
      privacyApplicationBlacklist: "Secret App;Other App",
      privacyPauseHistoryInBlacklistedApps: "false",
      privacyPauseClipboardInBlacklistedApps: "true",
      privacyAutoDeleteHistoryEnabled: "true",
      privacyHistoryRetentionDays: "90",
    }),
  };

  const commandCore = loadTypeScriptModule(commandCorePath);
  const privacyModule = loadTypeScriptModule(privacyCommandsPath, {
    "./commandCore": commandCore.exports,
  });

  try {
    const diagnostics = await privacyModule.exports.getPrivacyDiagnostics();

    assert.deepEqual(diagnostics.applicationBlacklist, ["other-app", "secret-app"]);
    assert.equal(diagnostics.pauseHistoryInBlacklistedApps, false);
    assert.equal(diagnostics.pauseClipboardInBlacklistedApps, true);
    assert.equal(diagnostics.autoDeleteHistoryEnabled, true);
    assert.equal(diagnostics.historyRetentionDays, 90);
    assert.equal(diagnostics.effectiveHistoryRetentionDays, 90);
    assert.equal(diagnostics.wouldSkipTranscriptionHistory, false);
    assert.equal(diagnostics.wouldSkipClipboardCapture, false);
    assert.equal(diagnostics.detectionError, "Tauri runtime not available");
  } finally {
    privacyModule.restore();
    commandCore.restore();
    global.window = previousWindow;
  }
});

test("DeveloperSection renders the privacy diagnostics decision surface", () => {
  for (const snippet of [
    "privacyDiagnostics?.wouldSkipTranscriptionHistory",
    "privacyDiagnostics?.wouldSkipClipboardCapture",
    "privacyDiagnostics?.activeApplicationBlacklisted",
    "privacyDiagnostics?.detectedApplicationBlacklisted",
    "privacyDiagnostics?.detectedForeground",
    "privacyDiagnostics?.activeForeground",
    "privacyDiagnostics.applicationBlacklist",
    "privacyDiagnostics.detectedCandidates",
    "privacyDiagnostics.activeCandidates",
    "privacyDiagnostics?.effectiveHistoryRetentionDays",
    "privacyDiagnostics?.detectionError",
  ]) {
    assert.match(developerSection, new RegExp(snippet.replace(/[?.]/g, "\\$&")), snippet);
  }

  for (const label of [
    "developer.privacy.foreground",
    "developer.privacy.active",
    "developer.privacy.blacklist",
    "developer.privacy.detectedCandidates",
    "developer.privacy.activeCandidates",
    "developer.privacy.retention",
    "developer.privacy.detectionError",
  ]) {
    assert.match(developerSection, new RegExp(label), label);
  }
});

test("privacy diagnostics strings are localized in English and Chinese", () => {
  for (const key of [
    "developer.privacy.historySkipped",
    "developer.privacy.historyRecorded",
    "developer.privacy.clipboardSkipped",
    "developer.privacy.clipboardCaptured",
    "developer.privacy.activeMatched",
    "developer.privacy.detectedMatched",
    "developer.privacy.foreground",
    "developer.privacy.active",
    "developer.privacy.detectedCandidates",
    "developer.privacy.activeCandidates",
    "developer.privacy.detectionError",
  ]) {
    const occurrences = translations.match(new RegExp(`"${key}"`, "g")) || [];
    assert.equal(occurrences.length, 2, key);
  }
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

  console.log(`privacy diagnostics tests passed (${tests.length})`);
})();
