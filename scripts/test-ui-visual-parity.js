#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const visualSurfaces = [
  "src/components/ControlPanel.tsx",
  "src/components/OnboardingFlow.tsx",
  "src/features/dictation/ui/FloatingDictationApp.tsx",
  "src/features/dictation/ui/RecordingOverlay.tsx",
  "src/features/settings/ui/SettingsPage.tsx",
  "src/features/clipboardCenter/ui/ClipboardSettings.tsx",
  "src/features/vocabulary/ui/VocabularySettings.tsx",
  "src/features/promptStudio/ui/PromptStudio.tsx",
];

for (const file of visualSurfaces) {
  const source = read(file);
  assert.doesNotMatch(
    source,
    /@astryxdesign\/core|astryxCard|astryxFormControls/,
    `${file} must keep its TypeFree layout and consume Astryx through compatibility primitives`
  );
}

const css = read("src/index.css");
for (const marker of [
  "--color-primary: #0a0a0a",
  ".recording-waveform__bar",
  ".typefree-dialog",
  ".typefree-toggle",
  ".typefree-input-shell",
]) {
  assert.ok(css.includes(marker), `visual parity CSS marker is missing: ${marker}`);
}

const adapterExpectations = new Map([
  ["src/components/ui/button.tsx", "@astryxdesign/core/Button"],
  ["src/components/ui/input.tsx", "@astryxdesign/core/TextInput"],
  ["src/components/ui/textarea.tsx", "@astryxdesign/core/TextArea"],
  ["src/components/ui/card.tsx", "@astryxdesign/core/Card"],
  ["src/components/ui/toggle.tsx", "@astryxdesign/core/Switch"],
  ["src/components/ui/tooltip.tsx", "@astryxdesign/core/Tooltip"],
  ["src/components/ui/astryxDialog.tsx", "@astryxdesign/core/Dialog"],
]);

for (const [file, importMarker] of adapterExpectations) {
  assert.ok(read(file).includes(importMarker), `${file} must delegate to ${importMarker}`);
}

assert.doesNotMatch(
  read("src/features/dictation/ui/RecordingWaveform.tsx"),
  /@astryxdesign|astryx-/,
  "RecordingWaveform remains outside the UI framework migration"
);

console.log(`ui visual parity tests passed (${visualSurfaces.length} surfaces, ${adapterExpectations.size} adapters)`);
