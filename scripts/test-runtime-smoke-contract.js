#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

const developerSection = read(
  path.join(srcRoot, "features", "settings", "ui", "DeveloperSection.tsx")
);
const platformTypes = read(path.join(srcRoot, "shared", "platform", "types.ts"));
const translations = read(path.join(srcRoot, "i18n", "translations.ts"));
const packageJson = JSON.parse(read(path.join(repoRoot, "package.json")));

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("Developer runtime probe calls the runtime smoke chain", () => {
  assert.match(developerSection, /type RuntimeProbeStatus = "passed" \| "warning" \| "failed"/);
  assert.match(developerSection, /const \[runtimeProbeChecks, setRuntimeProbeChecks\]/);
  assert.match(developerSection, /const handleRunRuntimeProbe = useCallback\(async \(\) =>/);
  assert.match(
    developerSection,
    /createDictationTimelineSession\(probeSessionId, "developer-smoke"\)/
  );
  assert.match(developerSection, /platform\.runtime\.isTauri\(\)/);
  assert.match(developerSection, /await platform\.runtime\.getPlatform\(\)/);
  assert.match(developerSection, /await platform\.recording\.getNativeCapabilities\(\)/);
  assert.match(developerSection, /id: "native-recording"/);
  assert.match(developerSection, /nativeRecordingProbeStatus\(capabilities\)/);
  assert.match(developerSection, /formatRuntimeProbeTimelineDetail\(checks\)/);
  assert.match(developerSection, /createRuntimeProbeTimelineMeta\(checks\)/);
  assert.match(developerSection, /TYPEFREE_RUNTIME_PROBE_RESULT/);
  assert.match(developerSection, /emitRuntimeProbeResult/);
  assert.match(developerSection, /platform\.logging\.write/);
  assert.match(developerSection, /developer\.runtimeProbe\.nativeRecordingReady/);
  assert.match(developerSection, /developer\.runtimeProbe\.nativeRecordingFallback/);
  assert.match(developerSection, /developer\.runtimeProbe\.nativeRecordingActive/);
  assert.match(developerSection, /await syncVocabularySettingsToBackend\(\)/);
  assert.match(developerSection, /await platform\.app\.syncForegroundApplicationVocabulary\(\)/);
  assert.match(developerSection, /await loadVocabularySettings\(\)/);
  assert.match(developerSection, /await platform\.debug\.getPrivacyDiagnostics\(\)/);
  assert.match(
    developerSection,
    /recordDictationTimelineEvent\(probeSessionId,\s*\{[\s\S]*label: "runtime\.probe"/
  );
  assert.match(
    developerSection,
    /recordDictationTimelineEvent\(probeSessionId,\s*\{[\s\S]*detail: formatRuntimeProbeTimelineDetail\(checks\)/
  );
  assert.match(
    developerSection,
    /recordDictationTimelineEvent\(probeSessionId,\s*\{[\s\S]*meta: createRuntimeProbeTimelineMeta\(checks\)/
  );
  assert.match(developerSection, /flushDictationTimelinePersistence/);
  assert.match(
    developerSection,
    /recordDictationTimelineEvent\(probeSessionId,\s*\{[\s\S]*label: "runtime\.probe"[\s\S]*\}\);\s*await flushDictationTimelinePersistence\(\);\s*await loadTimelineSessions\(\);/
  );
  assert.match(developerSection, /loadTimelineSessions\(\)/);
});

test("Developer runtime probe can autorun for scripted Tauri smoke", () => {
  const controlPanel = read(path.join(srcRoot, "components", "ControlPanel.tsx"));

  assert.match(developerSection, /VITE_TYPEFREE_RUNTIME_PROBE_AUTORUN/);
  assert.match(developerSection, /function shouldAutorunRuntimeProbe\(\): boolean/);
  assert.match(developerSection, /runtimeProbeAutorunRef/);
  assert.match(
    developerSection,
    /window\.setTimeout\(\(\) => \{\s*runtimeProbeAutorunRef\.current = true;\s*void handleRunRuntimeProbe\(\);/
  );
  assert.match(controlPanel, /VITE_TYPEFREE_RUNTIME_PROBE_AUTORUN/);
  assert.match(
    controlPanel,
    /runtimeProbeAutorun \|\|[\s\S]*nativeRecordingSmokeAutorun \|\|[\s\S]*dictationPipelineSmokeAutorun \|\|[\s\S]*cloudTranscriptionSmokeAutorun/
  );
  assert.match(
    controlPanel,
    /if \(\s*runtimeProbeAutorun \|\|[\s\S]*nativeRecordingSmokeAutorun \|\|[\s\S]*dictationPipelineSmokeAutorun \|\|[\s\S]*cloudTranscriptionSmokeAutorun/
  );
});

test("Developer runtime probe persists native recorder detail in timeline", () => {
  assert.match(developerSection, /meta\?: Record<string, unknown>/);
  assert.match(developerSection, /function formatNativeRecordingMeta\(value: unknown\): string/);
  assert.match(
    developerSection,
    /const nativeRecording = formatNativeRecordingMeta\(meta\.nativeRecording\)/
  );
  assert.match(developerSection, /parts\.push\(nativeRecording\)/);
  assert.match(
    developerSection,
    /function formatRuntimeProbeTimelineDetail\(checks: RuntimeProbeCheck\[\]\): string/
  );
  assert.match(
    developerSection,
    /check\.id === "native-recording"[\s\S]*`\$\{check\.id\}:\$\{check\.status\}:\$\{check\.detail\}`/
  );
  assert.match(
    developerSection,
    /function createRuntimeProbeTimelineMeta\(checks: RuntimeProbeCheck\[\]\): Record<string, unknown>/
  );
  assert.match(developerSection, /meta: check\.meta \|\| null/);
  assert.match(developerSection, /const nativeRecording = checks\.find/);
  assert.match(developerSection, /\.\.\.\(nativeRecording\.meta \|\| \{\}\)/);
  assert.match(developerSection, /nativeRecording:\s*nativeRecording/);
  assert.match(developerSection, /detail: nativeRecording\.detail/);
  assert.match(developerSection, /const nativeRecordingMeta = \{/);
  assert.match(developerSection, /backend,[\s\S]*platform: recorderPlatform/);
  assert.match(developerSection, /recorderStatus: status/);
  assert.match(developerSection, /reason,[\s\S]*supported: capabilities\.supported/);
  assert.match(developerSection, /active: capabilities\.active/);
  assert.match(developerSection, /meta: nativeRecordingMeta/);
});

test("Developer runtime probe compares synchronized active app state", () => {
  assert.match(developerSection, /vocabularySettings\.layers\.activeApplicationId \|\| null/);
  assert.match(developerSection, /diagnostics\.activeForeground\?\.id \|\| null/);
  assert.match(developerSection, /foregroundApplication\?\.id \|\| null/);
  assert.match(developerSection, /activeApplicationMismatch/);
  assert.match(developerSection, /foregroundApplication = null;[\s\S]*status: "failed"/);
});

test("Developer runtime probe stays outside recording, STT, and paste flows", () => {
  const handlerMatch = developerSection.match(
    /const handleRunRuntimeProbe = useCallback\(async \(\) => \{[\s\S]*?\n\s{2}const handleRunNativeRecordingSmoke/
  );
  assert.ok(handlerMatch, "runtime probe handler not found");
  const handler = handlerMatch[0];

  for (const forbidden of [
    "transcribeAudio",
    "startNative",
    "stopNative",
    "cancelNative",
    "startNativeRecording",
    "startRecording",
    "pasteText",
    "writeClipboard",
  ]) {
    assert.doesNotMatch(handler, new RegExp(forbidden), forbidden);
  }
});

test("Developer runtime probe renders a runnable diagnostics panel", () => {
  for (const snippet of [
    "developer.runtimeProbe.title",
    "developer.runtimeProbe.subtitle",
    "developer.runtimeProbe.run",
    "developer.runtimeProbe.running",
    "developer.runtimeProbe.empty",
    "developer.runtimeProbe.runtime",
    "developer.runtimeProbe.nativeRecording",
    "developer.runtimeProbe.foreground",
    "developer.runtimeProbe.vocabulary",
    "developer.runtimeProbe.privacy",
  ]) {
    assert.match(developerSection, new RegExp(snippet), snippet);
  }

  assert.match(developerSection, /<ProbeRow key=\{check\.id\} check=\{check\} \/>/);
  assert.match(developerSection, /disabled=\{isRuntimeProbeRunning\}/);
});

test("Platform bridge exposes runtime smoke dependencies", () => {
  assert.match(platformTypes, /runtime:\s*\{[\s\S]*isTauri:\s*\(\) => boolean/);
  assert.match(platformTypes, /runtime:\s*\{[\s\S]*getPlatform:\s*\(\) => Promise<string>/);
  assert.match(
    platformTypes,
    /recording:\s*\{[\s\S]*getNativeCapabilities:\s*\(\) => Promise<NativeRecordingCapabilities>/
  );
  assert.match(
    platformTypes,
    /app:\s*\{[\s\S]*syncForegroundApplicationVocabulary:\s*\(\) => Promise<ForegroundApplication \| null>/
  );
  assert.match(
    platformTypes,
    /debug:\s*\{[\s\S]*getPrivacyDiagnostics:\s*\(\) => Promise<PrivacyDiagnostics>/
  );
});

test("Runtime probe strings are localized in English and Chinese", () => {
  for (const key of [
    "developer.runtimeProbe.title",
    "developer.runtimeProbe.subtitle",
    "developer.runtimeProbe.run",
    "developer.runtimeProbe.running",
    "developer.runtimeProbe.empty",
    "developer.runtimeProbe.runtime",
    "developer.runtimeProbe.nativeRecording",
    "developer.runtimeProbe.foreground",
    "developer.runtimeProbe.vocabulary",
    "developer.runtimeProbe.privacy",
    "developer.runtimeProbe.platform",
    "developer.runtimeProbe.browser",
    "developer.runtimeProbe.nativeRecordingReady",
    "developer.runtimeProbe.nativeRecordingFallback",
    "developer.runtimeProbe.nativeRecordingActive",
    "developer.runtimeProbe.unknown",
    "developer.runtimeProbe.foregroundNone",
    "developer.runtimeProbe.activeApplication",
    "developer.runtimeProbe.activeApplicationMismatch",
    "developer.runtimeProbe.settingsSynced",
  ]) {
    const occurrences = translations.match(new RegExp(`"${key}"`, "g")) || [];
    assert.equal(occurrences.length, 2, key);
  }
});

test("Runtime probe contract is part of frontend verification", () => {
  assert.equal(
    packageJson.scripts["test:runtime-smoke"],
    "node scripts/test-runtime-smoke-contract.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:runtime-smoke/);
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

console.log(`runtime smoke contract tests passed (${tests.length})`);
