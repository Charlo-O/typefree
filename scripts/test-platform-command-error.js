#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const commandCorePath = path.join(repoRoot, "src", "shared", "platform", "commandCore.ts");
const reasoningCommandsPath = path.join(
  repoRoot,
  "src",
  "shared",
  "platform",
  "reasoningCommands.ts"
);
const historyCommandsPath = path.join(repoRoot, "src", "shared", "platform", "historyCommands.ts");

function loadCommandCore() {
  const source = fs.readFileSync(commandCorePath, "utf8");
  const output = ts.transpileModule(source, {
    fileName: commandCorePath,
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
    throw new Error(`Failed to transpile platform command core:\n${message}`);
  }

  const compiledModule = new Module(commandCorePath, module);
  compiledModule.filename = commandCorePath;
  compiledModule.paths = Module._nodeModulePaths(path.dirname(commandCorePath));
  compiledModule._compile(output.outputText, commandCorePath);
  return compiledModule.exports;
}

function loadTypeScriptModule(filename, mocks) {
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
  compiledModule._compile(output.outputText, filename);

  return {
    exports: compiledModule.exports,
    restore() {
      Module._load = originalLoad;
    },
  };
}

const commandCore = loadCommandCore();
const { getErrorMessage, normalizeCommandError, TauriCommandError } = commandCore;

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("normalizes typed Tauri command error payloads", () => {
  const error = normalizeCommandError({
    kind: "configuration",
    message: "Unsupported credential key: BAD_KEY",
    retryable: false,
    source: "credential-store",
  });

  assert.equal(error instanceof TauriCommandError, true);
  assert.equal(error.kind, "configuration");
  assert.equal(error.message, "Unsupported credential key: BAD_KEY");
  assert.equal(error.retryable, false);
  assert.equal(error.source, "credential-store");
});

test("preserves Error objects that already carry command metadata", () => {
  const raw = new Error("Credential store is not supported on this platform");
  raw.kind = "configuration";
  raw.retryable = false;
  raw.source = "credential-store";

  const error = normalizeCommandError(raw);
  assert.equal(error.kind, "configuration");
  assert.equal(error.source, "credential-store");
  assert.equal(error.retryable, false);
});

test("falls back plain Error objects to internal errors", () => {
  const error = normalizeCommandError(new Error("boom"));
  assert.equal(error.kind, "internal");
  assert.equal(error.message, "boom");
  assert.equal(error.retryable, false);
});

test("returns normalized messages via getErrorMessage", () => {
  assert.equal(
    getErrorMessage({
      kind: "timeout",
      message: "request timed out",
      retryable: true,
    }),
    "request timed out"
  );
});

test("returns typed history save failure when Tauri runtime is unavailable", async () => {
  const previousWindow = global.window;
  delete global.window;
  const moduleHandle = loadTypeScriptModule(historyCommandsPath, {
    "./commandCore": commandCore,
  });

  try {
    const result = await moduleHandle.exports.saveTranscription("text");

    assert.deepEqual(result, {
      success: false,
      reason: "unavailable",
      error: "Transcription history is not available in this Tauri build",
    });
  } finally {
    moduleHandle.restore();
    global.window = previousWindow;
  }
});

test("returns typed history save success with saved row id", async () => {
  const previousWindow = global.window;
  global.window = { __TAURI_INTERNALS__: {} };
  const invokeCalls = [];
  const moduleHandle = loadTypeScriptModule(historyCommandsPath, {
    "./commandCore": commandCore,
    "@tauri-apps/api/core": {
      invoke: async (command, payload) => {
        invokeCalls.push({ command, payload });
        return 42;
      },
    },
  });

  try {
    const result = await moduleHandle.exports.saveTranscription(
      "processed text",
      "processed text",
      "voice-polish",
      "TypeFree",
      {
        rawText: "raw text",
        sessionId: "session-a",
        provider: "openai",
        outputs: [{ stage: "pipeline", text: "processed text" }],
      }
    );

    assert.deepEqual(result, { success: true, id: 42 });
    assert.deepEqual(invokeCalls, [
      {
        command: "db_save_transcription_record",
        payload: {
          request: {
            text: "raw text",
            processed: "processed text",
            method: "voice-polish",
            agentName: "TypeFree",
            sessionId: "session-a",
            provider: "openai",
            model: undefined,
            language: undefined,
            status: undefined,
            error: undefined,
            outputs: [{ stage: "pipeline", text: "processed text" }],
          },
        },
      },
    ]);
  } finally {
    moduleHandle.restore();
    global.window = previousWindow;
  }
});

test("returns typed history save skip when backend skips history", async () => {
  const previousWindow = global.window;
  global.window = { __TAURI_INTERNALS__: {} };
  const moduleHandle = loadTypeScriptModule(historyCommandsPath, {
    "./commandCore": commandCore,
    "@tauri-apps/api/core": {
      invoke: async () => 0,
    },
  });

  try {
    const result = await moduleHandle.exports.saveTranscription("text");

    assert.deepEqual(result, {
      success: false,
      skipped: true,
      reason: "privacy",
      message: "Transcription history skipped by privacy settings",
    });
  } finally {
    moduleHandle.restore();
    global.window = previousWindow;
  }
});

test("returns typed history save failure for command errors", async () => {
  const previousWindow = global.window;
  const originalWarn = console.warn;
  global.window = { __TAURI_INTERNALS__: {} };
  console.warn = () => undefined;
  const moduleHandle = loadTypeScriptModule(historyCommandsPath, {
    "./commandCore": commandCore,
    "@tauri-apps/api/core": {
      invoke: async () => {
        throw {
          kind: "configuration",
          message: "database unavailable",
          retryable: false,
          source: "database",
        };
      },
    },
  });

  try {
    const result = await moduleHandle.exports.saveTranscription("text");

    assert.deepEqual(result, {
      success: false,
      reason: "command-error",
      error: "database unavailable",
    });
  } finally {
    moduleHandle.restore();
    global.window = previousWindow;
    console.warn = originalWarn;
  }
});

test("wraps Anthropic reasoning invoke arguments in the Rust req contract", async () => {
  const invokeCalls = [];
  const promptCalls = [];
  const nativeResult = { success: true, text: "polished text" };
  const moduleHandle = loadTypeScriptModule(reasoningCommandsPath, {
    "./commandCore": commandCore,
    "./settingsCommands": {
      getAnthropicKey: async () => "sk-ant-test",
    },
    "../../config/prompts": {
      getSystemPrompt: (agentName, promptContext) => {
        promptCalls.push({ agentName, promptContext });
        return "mock-system-prompt";
      },
    },
    "@tauri-apps/api/core": {
      invoke: async (command, payload) => {
        invokeCalls.push({ command, payload });
        return nativeResult;
      },
    },
  });

  try {
    const result = await moduleHandle.exports.processAnthropicReasoning(
      "raw transcript",
      "claude-3-5-sonnet-latest",
      "TypeFree",
      {
        maxTokens: 2048,
        temperature: 0.25,
        promptContext: { selectedText: "existing selection" },
      }
    );

    assert.equal(result, nativeResult);
    assert.deepEqual(promptCalls, [
      {
        agentName: "TypeFree",
        promptContext: { selectedText: "existing selection" },
      },
    ]);
    assert.deepEqual(invokeCalls, [
      {
        command: "process_anthropic_reasoning",
        payload: {
          req: {
            api_key: "sk-ant-test",
            model: "claude-3-5-sonnet-latest",
            system_prompt: "mock-system-prompt",
            text: "raw transcript",
            max_tokens: 2048,
            temperature: 0.25,
          },
        },
      },
    ]);
  } finally {
    moduleHandle.restore();
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

  console.log(`platform command tests passed (${tests.length})`);
})();
