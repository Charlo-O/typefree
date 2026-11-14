#!/usr/bin/env node

// Contract checks for the Codex-backed voice agent: command registration, the platform bridge,
// the panel route, settings sync, and the safety boundaries the backend must keep.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const lib = read("src-tauri/src/lib.rs");
const commands = read("src-tauri/src/commands/agent.rs");
const runtime = read("src-tauri/src/agent/runtime.rs");
const codex = read("src-tauri/src/agent/codex.rs");
const dictation = read("src-tauri/src/commands/dictation.rs");
const bridge = read("src/shared/platform/agentCommands.ts");
const platformCommands = read("src/shared/platform/platformCommands.ts");
const tauriPlatform = read("src/shared/platform/tauriPlatform.ts");
const types = read("src/shared/platform/types.ts");
const router = read("src/AppRouter.tsx");
const schema = read("src/features/settings/schema/settingsSchema.ts");
const translations = read("src/i18n/translations.ts");
const processingModes = read("src/config/processingModes.ts");

const commandNames = [
  "agent_get_status",
  "agent_get_current_task",
  "agent_start_task",
  "agent_cancel_task",
  "agent_respond_approval",
  "agent_insert_result",
  "agent_dismiss_panel",
  "agent_resize_panel",
];
for (const name of commandNames) {
  assert.match(commands, new RegExp(`pub (?:async )?fn ${name}\\(`), `${name} is implemented`);
  assert.match(lib, new RegExp(`commands::agent::${name},`), `${name} is registered`);
  assert.match(bridge, new RegExp(`"${name}"`), `${name} has a typed wrapper`);
}
assert.match(commands, /CommandResult</, "agent commands return CommandResult");

for (const wrapper of ["agentStartTask", "agentRespondApproval", "onAgentTaskUpdated"]) {
  assert.match(platformCommands, new RegExp(wrapper), `${wrapper} is re-exported`);
}
assert.match(types, /agent: \{/, "PlatformBridge exposes an agent namespace");
assert.match(tauriPlatform, /agent: \{/, "tauri platform implements the agent namespace");
assert.match(bridge, /"agent-task-updated"/, "renderer listens to the backend task event");
assert.match(runtime, /AGENT_TASK_EVENT: &str = "agent-task-updated"/);

assert.match(router, /agentPanel=true/, "agent panel window has a renderer route");

for (const key of ["agentCodexPath", "agentWorkingDirectory", "agentSafetyLevel"]) {
  assert.match(schema, new RegExp(`${key}: (?:stringSetting|enumSetting)`), `${key} is in schema`);
  assert.match(runtime, new RegExp(`"${key}"`), `${key} is read by the backend`);
}
assert.match(
  schema,
  /agentCodexPath: stringSetting\("agentCodexPath", "", \{\s*syncToBackend: true/
);

// Safety boundaries.
assert.match(codex, /"ephemeral": true/, "agent threads do not pollute Codex history");
assert.match(codex, /Strict => "read-only"/, "strict level uses the read-only sandbox");
assert.match(codex, /Balanced => "workspace-write"/, "balanced level never disables the sandbox");
assert.doesNotMatch(codex, /danger-full-access/, "TypeFree never requests full access");
assert.doesNotMatch(
  codex,
  /dangerously-bypass-approvals-and-sandbox/,
  "TypeFree never bypasses Codex approvals"
);
assert.match(
  codex,
  /"item\/permissions\/requestApproval" => \{\s*ServerRequest::AutoAnswer\(json!\(\{ "permissions": \{\}/,
  "extra sandbox permissions are never granted"
);
assert.match(runtime, /APPROVAL_TIMEOUT/, "unanswered approvals are declined after a timeout");

// The existing command mode stays text-only; the agent is a separate, explicit path.
assert.match(processingModes, /Never execute shell, file, application, network/);
assert.doesNotMatch(processingModes, /id: "agent"/, "agent is not a persisted processing mode");
assert.match(
  dictation,
  /fn hand_off_to_agent\(/,
  "macOS backend dictation hands off agent sessions"
);
assert.match(dictation, /crate::agent::runtime::prewarm\(app\)/, "agent recordings prewarm Codex");

for (const key of [
  "agent.panel.status.awaitingApproval",
  "agent.panel.approval.accept",
  "agent.panel.notice.busy",
  "agent.settings.title",
]) {
  const occurrences = translations.split(`"${key}"`).length - 1;
  assert.equal(occurrences, 2, `${key} is translated in English and Chinese`);
}

console.log("voice agent contract tests passed");
