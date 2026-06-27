#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const stateMachinePath = path.join(
  repoRoot,
  "src",
  "features",
  "dictation",
  "state",
  "dictationSessionMachine.ts"
);

function loadStateMachine() {
  const source = fs.readFileSync(stateMachinePath, "utf8");
  const output = ts.transpileModule(source, {
    fileName: stateMachinePath,
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
    throw new Error(`Failed to transpile dictation session machine:\n${message}`);
  }

  const compiledModule = new Module(stateMachinePath, module);
  compiledModule.filename = stateMachinePath;
  compiledModule.paths = Module._nodeModulePaths(path.dirname(stateMachinePath));
  compiledModule._compile(output.outputText, stateMachinePath);
  return compiledModule.exports;
}

const {
  canTransitionDictationSession,
  createInitialDictationSession,
  isDictationProcessingPhase,
  isDictationRecordingPhase,
  isDictationTerminalPhase,
  reduceDictationSession,
} = loadStateMachine();

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function reduceMany(initialState, events) {
  return events.reduce((state, event) => reduceDictationSession(state, event), initialState);
}

test("derives UI recording and processing state from phases", () => {
  assert.equal(isDictationRecordingPhase("recording"), true);
  assert.equal(isDictationRecordingPhase("transcribing"), false);

  assert.equal(isDictationProcessingPhase("transcribing"), true);
  assert.equal(isDictationProcessingPhase("postprocessing"), true);
  assert.equal(isDictationProcessingPhase("inserting"), true);
  assert.equal(isDictationProcessingPhase("completed"), false);

  assert.equal(isDictationTerminalPhase("idle"), true);
  assert.equal(isDictationTerminalPhase("completed"), true);
  assert.equal(isDictationTerminalPhase("failed"), true);
  assert.equal(isDictationTerminalPhase("recording"), false);
});

test("runs the renderer happy path through the full state machine", () => {
  const state = reduceMany(createInitialDictationSession(), [
    { type: "start", sessionId: "renderer-a" },
    { type: "transcribing", sessionId: "renderer-a" },
    { type: "postprocessing", sessionId: "renderer-a" },
    { type: "inserting", sessionId: "renderer-a" },
    { type: "completed", sessionId: "renderer-a", text: "done" },
  ]);

  assert.equal(state.sessionId, "renderer-a");
  assert.equal(state.phase, "completed");
  assert.equal(state.lastText, "done");
  assert.equal(state.error, null);
});

test("rejects stale events from another session while active", () => {
  const active = reduceMany(createInitialDictationSession(), [
    { type: "start", sessionId: "renderer-a" },
    { type: "transcribing", sessionId: "renderer-a" },
  ]);

  assert.equal(
    canTransitionDictationSession(active, {
      type: "backend-state",
      sessionId: "backend-late",
      phase: "completed",
      text: "stale",
    }),
    false
  );

  const next = reduceDictationSession(active, {
    type: "backend-state",
    sessionId: "backend-late",
    phase: "completed",
    text: "stale",
  });

  assert.equal(next, active);
  assert.equal(next.sessionId, "renderer-a");
  assert.equal(next.phase, "transcribing");
  assert.equal(next.lastText, "");
});

test("rejects stale terminal events after a completed session", () => {
  const completed = reduceMany(createInitialDictationSession(), [
    { type: "start", sessionId: "renderer-a" },
    { type: "transcribing", sessionId: "renderer-a" },
    { type: "completed", sessionId: "renderer-a", text: "current" },
  ]);

  const staleCompleted = reduceDictationSession(completed, {
    type: "backend-state",
    sessionId: "backend-late",
    phase: "completed",
    text: "late",
  });
  assert.equal(staleCompleted, completed);
  assert.equal(staleCompleted.lastText, "current");

  const newSession = reduceDictationSession(completed, {
    type: "backend-state",
    sessionId: "backend-b",
    phase: "recording",
  });
  assert.equal(newSession.sessionId, "backend-b");
  assert.equal(newSession.phase, "recording");
  assert.equal(newSession.lastText, "");
});

test("rejects same-session phase regressions", () => {
  const transcribing = reduceMany(createInitialDictationSession(), [
    { type: "start", sessionId: "renderer-a" },
    { type: "transcribing", sessionId: "renderer-a" },
  ]);

  const regressed = reduceDictationSession(transcribing, {
    type: "backend-state",
    sessionId: "renderer-a",
    phase: "recording",
  });

  assert.equal(regressed, transcribing);
  assert.equal(regressed.phase, "transcribing");
});

test("keeps cancelled sessions closed to late completion", () => {
  const cancelled = reduceMany(createInitialDictationSession(), [
    { type: "start", sessionId: "renderer-a" },
    { type: "cancelled", sessionId: "renderer-a" },
  ]);

  assert.equal(cancelled.phase, "idle");
  assert.equal(cancelled.cancelledSessionId, "renderer-a");

  const lateCompletion = reduceDictationSession(cancelled, {
    type: "completed",
    sessionId: "renderer-a",
    text: "should not land",
  });
  assert.equal(lateCompletion, cancelled);
  assert.equal(lateCompletion.lastText, "");

  const newSession = reduceDictationSession(cancelled, {
    type: "recording",
    sessionId: "renderer-b",
  });
  assert.equal(newSession.sessionId, "renderer-b");
  assert.equal(newSession.phase, "recording");
  assert.equal(newSession.cancelledSessionId, null);
});

test("allows insertion to fail when final history or paste fails", () => {
  const failed = reduceMany(createInitialDictationSession(), [
    { type: "start", sessionId: "renderer-a" },
    { type: "transcribing", sessionId: "renderer-a" },
    { type: "postprocessing", sessionId: "renderer-a" },
    { type: "inserting", sessionId: "renderer-a" },
    {
      type: "failed",
      sessionId: "renderer-a",
      error: "Dictation history save failed",
    },
  ]);

  assert.equal(failed.sessionId, "renderer-a");
  assert.equal(failed.phase, "failed");
  assert.equal(failed.error, "Dictation history save failed");
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

console.log(`dictation session machine tests passed (${tests.length})`);
