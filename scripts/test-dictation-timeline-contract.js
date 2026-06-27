#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const compiledRoot = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-timeline-tests-"));

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

global.window = {
  localStorage: createMemoryStorage(),
};
global.localStorage = global.window.localStorage;

const timelinePersistenceCalls = [];
const persistedTimelineSessions = [];

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function appendPersistedTimelineEvents(sessionId, source, events) {
  const now = new Date().toISOString();
  let session = persistedTimelineSessions.find((item) => item.sessionId === sessionId);
  if (!session) {
    session = {
      sessionId,
      source: source || "unknown",
      startedAt: events[0]?.at || now,
      updatedAt: now,
      events: [],
    };
    persistedTimelineSessions.unshift(session);
  }

  session.source = session.source || source || "unknown";
  for (const event of events) {
    session.events.push({
      id: String(session.events.length + 1),
      sessionId,
      at: event.at || now,
      elapsedMs: normalizeNumber(event.elapsedMs),
      kind: event.kind || "backend",
      label: event.label || "backend.event",
      status: event.status || "info",
      phase: event.phase ?? null,
      source: event.source ?? source ?? null,
      durationMs: event.durationMs ?? null,
      detail: event.detail ?? null,
      meta: event.meta ?? null,
    });
  }
  session.updatedAt = session.events.at(-1)?.at || now;
}

async function defaultSaveDictationTimelineEvents(sessionId, source, events) {
  timelinePersistenceCalls.push([sessionId, source, events]);
  appendPersistedTimelineEvents(sessionId, source, events);
  return { success: true };
}

const platformStub = {
  history: {
    saveDictationTimelineEvents: defaultSaveDictationTimelineEvents,
    getDictationTimelineSessions: async (limit = 25) => persistedTimelineSessions.slice(0, limit),
  },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "../../../shared/platform") {
    return {
      __esModule: true,
      default: platformStub,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

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

  const outputPath = path.join(compiledRoot, relativePath).replace(/\.tsx?$/, ".cjs");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output.outputText, "utf8");
  return outputPath;
}

const timeline = require(compileSourceFile("features/dictation/timeline/sessionTimeline.ts"));

const platformTypes = read(path.join(srcRoot, "shared", "platform", "types.ts"));
const eventCommands = read(path.join(srcRoot, "shared", "platform", "eventCommands.ts"));
const historyCommands = read(path.join(srcRoot, "shared", "platform", "historyCommands.ts"));
const tauriPlatform = read(path.join(srcRoot, "shared", "platform", "tauriPlatform.ts"));
const useAudioRecording = read(
  path.join(srcRoot, "features", "dictation", "hooks", "useAudioRecording.ts")
);
const sessionTimelineSource = read(
  path.join(srcRoot, "features", "dictation", "timeline", "sessionTimeline.ts")
);
const developerSection = read(
  path.join(srcRoot, "features", "settings", "ui", "DeveloperSection.tsx")
);
const databaseRs = read(path.join(repoRoot, "src-tauri", "src", "commands", "database.rs"));
const dictationRs = read(path.join(repoRoot, "src-tauri", "src", "commands", "dictation.rs"));
const libRs = read(path.join(repoRoot, "src-tauri", "src", "lib.rs"));
const packageJson = JSON.parse(read(path.join(repoRoot, "package.json")));

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function resetTimelineTestState() {
  global.localStorage.clear();
  timelinePersistenceCalls.length = 0;
  persistedTimelineSessions.length = 0;
  platformStub.history.saveDictationTimelineEvents = defaultSaveDictationTimelineEvents;
}

test("session timeline persists bounded events with durations and pipeline steps", () => {
  resetTimelineTestState();

  timeline.createDictationTimelineSession("timeline-session", "test");
  timeline.recordDictationTimelineEvent("timeline-session", {
    kind: "transcription",
    label: "transcription.completed",
    status: "completed",
    durationMs: 123.6,
    meta: { provider: "openai" },
  });
  timeline.recordDictationPipelineSteps("timeline-session", "completion", [
    { name: "insert", status: "completed", durationMs: 12 },
    { name: "db-history", status: "completed", durationMs: 9 },
  ]);

  const sessions = timeline.readDictationTimelineSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, "timeline-session");
  assert.deepEqual(
    sessions[0].events.map((event) => event.label),
    ["session.start", "transcription.completed", "completion.insert", "completion.db-history"]
  );
  assert.equal(sessions[0].events[1].durationMs, 124);
  assert.equal(sessions[0].events[2].kind, "insert");
  assert.equal(sessions[0].events[3].kind, "history");
  assert.equal(timelinePersistenceCalls.length, 4);
  assert.equal(timelinePersistenceCalls[0][0], "timeline-session");
  assert.equal(timelinePersistenceCalls[0][1], "test");
  assert.equal(timelinePersistenceCalls[1][2][0].durationMs, 124);
  assert.equal(typeof timelinePersistenceCalls[1][2][0].at, "string");
  assert.equal(typeof timelinePersistenceCalls[1][2][0].elapsedMs, "number");
});

test("session timeline merge prefers richer persisted sessions", () => {
  const merged = timeline.mergeDictationTimelineSessions(
    [
      {
        sessionId: "same-session",
        source: "renderer",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        events: [
          {
            id: "local-1",
            sessionId: "same-session",
            at: "2026-01-01T00:00:01.000Z",
            elapsedMs: 1,
            kind: "state",
            label: "local",
            status: "info",
          },
        ],
      },
    ],
    [
      {
        sessionId: "same-session",
        source: "backend",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
        events: [
          {
            id: "db-1",
            sessionId: "same-session",
            at: "2026-01-01T00:00:01.000Z",
            elapsedMs: 1,
            kind: "backend",
            label: "db.one",
            status: "info",
          },
          {
            id: "db-2",
            sessionId: "same-session",
            at: "2026-01-01T00:00:02.000Z",
            elapsedMs: 2,
            kind: "history",
            label: "db.two",
            status: "completed",
          },
        ],
      },
    ]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "backend");
  assert.equal(merged[0].events.length, 2);
});

test("renderer timeline persistence skips backend echo events", () => {
  resetTimelineTestState();

  timeline.createDictationTimelineSession("backend-created-session", "backend");
  timeline.recordDictationTimelineEvent("backend-session", {
    kind: "backend",
    label: "backend.recording",
    status: "started",
    source: "backend",
  });
  timeline.recordDictationPipelineSteps(
    "backend-session",
    "postprocessing",
    [{ name: "reasoning", status: "completed", durationMs: 18 }],
    { source: "backend" }
  );
  timeline.recordDictationTimelineEvent("renderer-session", {
    kind: "state",
    label: "recording.started",
    status: "started",
    source: "renderer",
  });

  assert.equal(timelinePersistenceCalls.length, 1);
  assert.equal(timelinePersistenceCalls[0][0], "renderer-session");
  assert.equal(timelinePersistenceCalls[0][1], "renderer");
});

test("timeline persistence failures do not break local diagnostics", () => {
  resetTimelineTestState();

  const originalSave = platformStub.history.saveDictationTimelineEvents;
  platformStub.history.saveDictationTimelineEvents = () => {
    throw new Error("simulated persistence failure");
  };

  assert.doesNotThrow(() => {
    timeline.recordDictationTimelineEvent("resilient-session", {
      kind: "state",
      label: "recording.started",
      status: "started",
      source: "renderer",
    });
  });

  platformStub.history.saveDictationTimelineEvents = originalSave;

  const sessions = timeline.readDictationTimelineSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, "resilient-session");
  assert.equal(sessions[0].events[0].label, "recording.started");
});

test("timeline persistence flush waits for pending save commands", async () => {
  resetTimelineTestState();

  const originalSave = platformStub.history.saveDictationTimelineEvents;
  let resolveSave;
  platformStub.history.saveDictationTimelineEvents = async (...args) => {
    timelinePersistenceCalls.push(args);
    return new Promise((resolve) => {
      resolveSave = resolve;
    });
  };

  timeline.recordDictationTimelineEvent("flush-session", {
    kind: "state",
    label: "recording.started",
    status: "started",
    source: "renderer",
  });

  let flushed = false;
  const flushPromise = timeline.flushDictationTimelinePersistence().then(() => {
    flushed = true;
  });

  await Promise.resolve();
  assert.equal(flushed, false);
  resolveSave({ success: true });
  await flushPromise;
  assert.equal(flushed, true);
  assert.equal(timelinePersistenceCalls.length, 1);

  platformStub.history.saveDictationTimelineEvents = originalSave;
});

test("developer runtime probe event round-trips through persisted timeline sessions", async () => {
  resetTimelineTestState();

  timeline.createDictationTimelineSession("developer-smoke-contract", "developer-smoke");
  timeline.recordDictationTimelineEvent("developer-smoke-contract", {
    kind: "backend",
    label: "runtime.probe",
    status: "completed",
    source: "developer-smoke",
    detail: "native-recording:passed:ready, privacy:passed",
    meta: {
      nativeRecording: {
        backend: "windows-wasapi",
        platform: "windows",
        status: "passed",
        detail: "ready",
      },
    },
  });
  await timeline.flushDictationTimelinePersistence();

  const persisted = await platformStub.history.getDictationTimelineSessions(5);
  const merged = timeline.mergeDictationTimelineSessions(
    timeline.readDictationTimelineSessions(),
    persisted
  );
  const session = merged.find((item) => item.sessionId === "developer-smoke-contract");
  assert.ok(session, "developer smoke session was not persisted");
  assert.equal(session.source, "developer-smoke");

  const runtimeProbe = session.events.find((event) => event.label === "runtime.probe");
  assert.ok(runtimeProbe, "runtime.probe event was not persisted");
  assert.equal(runtimeProbe.source, "developer-smoke");
  assert.equal(runtimeProbe.status, "completed");
  assert.match(runtimeProbe.detail, /native-recording:passed/);
  assert.equal(runtimeProbe.meta.nativeRecording.backend, "windows-wasapi");
  assert.equal(typeof runtimeProbe.elapsedMs, "number");
  assert.equal(timelinePersistenceCalls.at(-1)[0], "developer-smoke-contract");
  assert.equal(timelinePersistenceCalls.at(-1)[1], "developer-smoke");
});

test("backend state payload carries timeline events through the platform bridge", () => {
  assert.match(platformTypes, /timelineEvents\?: BackendTimelineEvent\[\]/);
  assert.match(platformTypes, /export type BackendTimelineEvent = \{/);
  assert.match(eventCommands, /const timelineEvents = Array\.isArray\(payload\.timelineEvents\)/);
  assert.match(eventCommands, /durationMs:[\s\S]*Number\(event\.durationMs\)/);
  assert.match(eventCommands, /timelineEvents,/);
  assert.match(useAudioRecording, /payload\.timelineEvents\?\.length/);
  assert.match(useAudioRecording, /recordTimelineEvent\(payload\.sessionId,[\s\S]*timelineEvent/);
});

test("timeline persistence is registered across SQLite, Tauri, platform bridge, and UI", () => {
  for (const snippet of [
    "dictation_timeline_sessions",
    "dictation_timeline_events",
    "fn migration_4_dictation_timeline_events",
    "pub fn db_save_dictation_timeline_events",
    "pub fn db_get_dictation_timeline_sessions",
    "timeline_sessions_deleted",
  ]) {
    assert.match(databaseRs, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(libRs, /database::db_save_dictation_timeline_events/);
  assert.match(libRs, /database::db_get_dictation_timeline_sessions/);
  assert.match(platformTypes, /PersistedDictationTimelineSession/);
  assert.match(platformTypes, /timelineSessionsDeleted\?: number/);
  assert.match(historyCommands, /db_save_dictation_timeline_events/);
  assert.match(historyCommands, /db_get_dictation_timeline_sessions/);
  assert.match(tauriPlatform, /saveDictationTimelineEvents: tauri\.saveDictationTimelineEvents/);
  assert.match(tauriPlatform, /getDictationTimelineSessions: tauri\.getDictationTimelineSessions/);
  assert.match(sessionTimelineSource, /export function mergeDictationTimelineSessions/);
  assert.match(sessionTimelineSource, /saveDictationTimelineEvents/);
  assert.match(sessionTimelineSource, /source \|\| "renderer"/);
  assert.match(sessionTimelineSource, /!== "backend"/);
  assert.match(sessionTimelineSource, /sourceFromMeta/);
  assert.match(sessionTimelineSource, /flushDictationTimelinePersistence/);
  assert.match(sessionTimelineSource, /at: event\.at/);
  assert.match(platformTypes, /elapsedMs\?: number/);
  assert.match(developerSection, /platform\.history\.getDictationTimelineSessions/);
  assert.match(developerSection, /mergeDictationTimelineSessions/);
});

test("macOS backend dictation emits duration-bearing timeline events for core stages", () => {
  for (const snippet of [
    "timeline_events: Option<Vec<BackendTimelineEvent>>",
    "fn emit_backend_state_with_timeline",
    "persist_backend_timeline_events",
    "fn elapsed_ms",
    "recording.stopped",
    "audio-quality.completed",
    "audio-quality.skipped",
    "transcription.completed",
    "postprocessing.completed",
    "insert.completed",
    "history.db.completed",
  ]) {
    assert.match(dictationRs, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(dictationRs, /duration_ms: Option<u64>/);
  assert.match(
    dictationRs,
    /let transcription_duration_ms = elapsed_ms\(transcription_started_at\)/
  );
  assert.match(dictationRs, /Some\(transcription_duration_ms\)/);
  assert.match(dictationRs, /let paste_duration_ms = elapsed_ms\(paste_started_at\)/);
  assert.match(dictationRs, /Some\(paste_duration_ms\)/);
  assert.match(dictationRs, /let history_duration_ms = elapsed_ms\(history_started_at\)/);
  assert.match(dictationRs, /Some\(history_duration_ms\)/);
});

test("timeline contract is part of frontend verification", () => {
  assert.equal(
    packageJson.scripts["test:dictation-timeline"],
    "node scripts/test-dictation-timeline-contract.js"
  );
  assert.match(packageJson.scripts["verify:frontend"], /npm run test:dictation-timeline/);
});

async function run() {
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

  console.log(`dictation timeline contract tests passed (${tests.length})`);
}

void run();
