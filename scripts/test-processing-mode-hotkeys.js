#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const helper = read("src/config/processingModeHotkeys.ts");
const schema = read("src/features/settings/schema/settingsSchema.ts");
const bridge = read("src/shared/platform/hotkeyCommands.ts");
const rust = read("src-tauri/src/commands/hotkey.rs");
const events = read("src/shared/platform/eventCommands.ts");
const recording = read("src/features/dictation/hooks/useAudioRecording.ts");
const settings = read("src/features/settings/ui/SettingsPage.tsx");

for (const mode of ["direct", "voice-polish", "command", "translate-en", "prompt-optimize"]) {
  assert.match(helper, new RegExp(`PROCESSING_MODE_IDS`));
  assert.match(rust, new RegExp(`\\"${mode}\\"`));
  assert.match(settings, new RegExp(`mode.id`));
}
assert.match(schema, /processingModeHotkeys/);
assert.match(bridge, /processingModeHotkeys/);
assert.match(rust, /processingModes/);
assert.match(rust, /processingModeId/);
assert.match(events, /normalizeDictationHotkeyPayload/);
assert.match(recording, /applyHotkeyProcessingMode/);
assert.match(settings, /handleProcessingModeHotkeyChange/);

console.log("processing mode hotkey contract tests passed");
