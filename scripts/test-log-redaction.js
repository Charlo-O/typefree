#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const loggerPath = path.join(repoRoot, "src", "utils", "logger.ts");
const transcriptionPipelinePath = path.join(
  repoRoot,
  "src",
  "features",
  "dictation",
  "pipeline",
  "transcriptionPipeline.ts"
);
const completionPipelinePath = path.join(
  repoRoot,
  "src",
  "features",
  "dictation",
  "pipeline",
  "completionPipeline.ts"
);
const audioManagerPath = path.join(
  repoRoot,
  "src",
  "features",
  "dictation",
  "audio",
  "audioManager.ts"
);
const reasoningServicePath = path.join(repoRoot, "src", "services", "ReasoningService.ts");
const loggingRustPath = path.join(repoRoot, "src-tauri", "src", "commands", "logging.rs");
const volcengineBatchPath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "transcription",
  "volcengine",
  "batch.rs"
);

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

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("renderer logger redacts secret and dictated text payloads before writing", async () => {
  let capturedPayload = null;
  const loggerModule = loadTypeScriptModule(loggerPath, {
    "../shared/platform": {
      platform: {
        logging: {
          getLevel: async () => "debug",
          write: async (payload) => {
            capturedPayload = payload;
          },
        },
      },
    },
  });

  try {
    const payload = loggerModule.exports.redactLogPayload({
      level: "debug",
      message: "request failed with Bearer abc.def.ghi",
      meta: {
        apiKey: "sk-test-secret",
        accessToken: "volc-token",
        keyPreview: "sk-test-...",
        rawText: "private dictated sentence",
        textPreview: "private dictated sentence".slice(0, 12),
        resultPreview: "cleaned private transcript".slice(0, 12),
        prompt: "rewrite this private paragraph",
        selectedText: "selected private text",
        systemPrompt: "system prompt with private context",
        userPrompt: "user prompt with dictated content",
        requestBody: JSON.stringify({ messages: [{ content: "private request body" }] }),
        fullResponse: JSON.stringify({ output: "private model output" }),
        response: JSON.stringify({ message: "private response" }),
        textLength: 25,
        nested: {
          model: "glm-asr-2512",
          errorText: "provider returned private payload",
        },
      },
      scope: "privacy",
      source: "renderer",
    });

    assert.equal(payload.message, "request failed with [REDACTED_SECRET]");
    assert.equal(payload.meta.apiKey, "[REDACTED_SECRET]");
    assert.equal(payload.meta.accessToken, "[REDACTED_SECRET]");
    assert.equal(payload.meta.keyPreview, "[REDACTED_SECRET]");
    assert.equal(payload.meta.rawText, "[REDACTED_TEXT length=25]");
    assert.equal(payload.meta.textPreview, "[REDACTED_TEXT length=12]");
    assert.equal(payload.meta.resultPreview, "[REDACTED_TEXT length=12]");
    assert.equal(payload.meta.prompt, "[REDACTED_TEXT length=30]");
    assert.equal(payload.meta.selectedText, "[REDACTED_TEXT length=21]");
    assert.equal(payload.meta.systemPrompt, "[REDACTED_TEXT length=34]");
    assert.equal(payload.meta.userPrompt, "[REDACTED_TEXT length=33]");
    assert.match(payload.meta.requestBody, /^\[REDACTED_TEXT length=\d+\]$/);
    assert.match(payload.meta.fullResponse, /^\[REDACTED_TEXT length=\d+\]$/);
    assert.match(payload.meta.response, /^\[REDACTED_TEXT length=\d+\]$/);
    assert.equal(payload.meta.nested.errorText, "[REDACTED_TEXT length=33]");
    assert.equal(payload.meta.nested.model, "glm-asr-2512");
    assert.equal(payload.meta.textLength, 25);

    await loggerModule.exports.default.debug(
      "provider failed with Bearer abc.def.ghi",
      {
        processedText: "cleaned private transcript",
        authorization: "Bearer abc.def.ghi",
        requestBody: JSON.stringify({ prompt: "private request body" }),
        fullResponse: JSON.stringify({ text: "private response body" }),
      },
      "transcription"
    );

    assert.equal(capturedPayload.message, "provider failed with [REDACTED_SECRET]");
    assert.equal(capturedPayload.meta.processedText, "[REDACTED_TEXT length=26]");
    assert.equal(capturedPayload.meta.authorization, "[REDACTED_SECRET]");
    assert.match(capturedPayload.meta.requestBody, /^\[REDACTED_TEXT length=\d+\]$/);
    assert.match(capturedPayload.meta.fullResponse, /^\[REDACTED_TEXT length=\d+\]$/);
  } finally {
    loggerModule.restore();
  }
});

test("reasoning and post-processing preview log keys are redacted", () => {
  const loggerSource = read(loggerPath);
  const transcriptionPipeline = read(transcriptionPipelinePath);
  const reasoningService = read(reasoningServicePath);

  for (const key of [
    "textpreview",
    "resultpreview",
    "requestbody",
    "fullresponse",
    "response",
    "systemprompt",
    "userprompt",
    "selectedtext",
    "clipboardtext",
  ]) {
    assert.match(loggerSource, new RegExp(`"${key}"`), `${key} should be a text payload key`);
  }
  assert.match(loggerSource, /"keypreview"/);
  assert.match(transcriptionPipeline, /textPreview:\s*preview\(normalizedText\)/);
  assert.match(transcriptionPipeline, /resultPreview:\s*preview\(result\)/);
  assert.match(reasoningService, /keyPreview:/);
  assert.match(reasoningService, /requestBody:\s*JSON\.stringify\(requestBody\)/);
  assert.match(reasoningService, /fullResponse:\s*JSON\.stringify\(jsonResponse\)/);
  assert.match(reasoningService, /response:\s*JSON\.stringify\(response\)/);
});

test("dictation completion logs no transcript preview", () => {
  const source = read(completionPipelinePath);

  assert.doesNotMatch(source, /Complete,\s*text:/);
  assert.doesNotMatch(source, /text\.substring\(0,\s*50\)/);
  assert.match(source, /text redacted by privacy settings/);
  assert.match(source, /length:\s*normalizedText\.length/);
});

test("Volcengine debug output avoids token and transcript previews", () => {
  const source = read(audioManagerPath);

  assert.doesNotMatch(source, /\[volcengine-am\]/);
  assert.doesNotMatch(source, /"token:"/);
  assert.match(source, /hasAccessToken:\s*!!volcToken/);
  assert.match(source, /Volcengine ASR service returned/);
  assert.match(source, /textLength:\s*rawText\?\.length \|\| 0/);
});

test("backend renderer log command redacts persisted payloads", () => {
  const source = read(loggingRustPath);

  for (const expected of [
    "fn redact_log_value",
    "fn redact_freeform_text",
    "is_sensitive_key",
    "is_text_payload_key",
    '"keypreview"',
    '"textpreview"',
    '"resultpreview"',
    '"requestbody"',
    '"fullresponse"',
    '"response"',
    "entry.meta.map(|meta| redact_log_value(None, meta))",
    "RENDERER_LOG",
  ]) {
    assert.match(source, new RegExp(expected.replace(/[()|]/g, "\\$&")), expected);
  }
});

test("native Volcengine batch logs response summaries instead of payloads", () => {
  const source = read(volcengineBatchPath);

  assert.match(source, /response summary/);
  assert.match(source, /text_chars=/);
  assert.match(source, /payload_keys/);
  assert.doesNotMatch(source, /response payload/);
  assert.doesNotMatch(source, /serde_json::to_string\(&response\.payload\)/);
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

  console.log(`log redaction tests passed (${tests.length})`);
})();
