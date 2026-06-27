#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const domainModulePath = path.join(repoRoot, "src-tauri", "src", "transcription", "domain.rs");
const batchServicePath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "transcription",
  "batch_service.rs"
);
const transcriptionCommandPath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "commands",
  "transcription.rs"
);
const dictationCommandPath = path.join(repoRoot, "src-tauri", "src", "commands", "dictation.rs");
const providersModulePath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "transcription",
  "providers.rs"
);
const modelRegistryDataPath = path.join(repoRoot, "src", "models", "modelRegistryData.json");
const assemblyAIProviderPath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "transcription",
  "providers",
  "assemblyai.rs"
);
const openAIProviderPath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "transcription",
  "providers",
  "openai.rs"
);
const groqProviderPath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "transcription",
  "providers",
  "groq.rs"
);
const zaiProviderPath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "transcription",
  "providers",
  "zai.rs"
);
const openAIRealtimePath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "transcription",
  "openai_realtime.rs"
);
const volcengineStreamingPath = path.join(
  repoRoot,
  "src-tauri",
  "src",
  "transcription",
  "volcengine",
  "streaming.rs"
);
const eventCommandsPath = path.join(repoRoot, "src", "shared", "platform", "eventCommands.ts");
const transcriptionCommandsPath = path.join(
  repoRoot,
  "src",
  "shared",
  "platform",
  "transcriptionCommands.ts"
);
const platformTypesPath = path.join(repoRoot, "src", "shared", "platform", "types.ts");
const tauriPlatformPath = path.join(repoRoot, "src", "shared", "platform", "tauriPlatform.ts");
const audioManagerPath = path.join(
  repoRoot,
  "src",
  "features",
  "dictation",
  "audio",
  "audioManager.ts"
);
const overlayPath = path.join(
  repoRoot,
  "src",
  "features",
  "dictation",
  "ui",
  "RecordingOverlay.tsx"
);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

const domainModule = read(domainModulePath);
const batchService = read(batchServicePath);
const transcriptionCommand = read(transcriptionCommandPath);
const dictationCommand = read(dictationCommandPath);
const providersModule = read(providersModulePath);
const modelRegistryData = JSON.parse(read(modelRegistryDataPath));
const assemblyAIProvider = read(assemblyAIProviderPath);
const openAIProvider = read(openAIProviderPath);
const groqProvider = read(groqProviderPath);
const zaiProvider = read(zaiProviderPath);
const openAIRealtime = read(openAIRealtimePath);
const volcengineStreaming = read(volcengineStreamingPath);
const eventCommands = read(eventCommandsPath);
const transcriptionCommands = read(transcriptionCommandsPath);
const platformTypes = read(platformTypesPath);
const tauriPlatform = read(tauriPlatformPath);
const audioManager = read(audioManagerPath);
const overlay = read(overlayPath);

const EXPECTED_TRANSCRIPTION_PROVIDER_POLICY = {
  assemblyai: {
    requiresKey: true,
    supportsEndpointOverride: true,
    capabilities: {
      supportsBatch: true,
      supportsStreaming: false,
      supportsRealtime: false,
    },
  },
  openai: {
    requiresKey: true,
    supportsEndpointOverride: true,
    capabilities: {
      supportsBatch: true,
      supportsStreaming: false,
      supportsRealtime: true,
    },
  },
  groq: {
    requiresKey: true,
    supportsEndpointOverride: true,
    capabilities: {
      supportsBatch: true,
      supportsStreaming: false,
      supportsRealtime: false,
    },
  },
  zai: {
    requiresKey: true,
    supportsEndpointOverride: true,
    capabilities: {
      supportsBatch: true,
      supportsStreaming: false,
      supportsRealtime: false,
    },
  },
  volcengine: {
    requiresKey: true,
    supportsEndpointOverride: false,
    capabilities: {
      supportsBatch: true,
      supportsStreaming: true,
      supportsRealtime: false,
    },
  },
};

function rustStringField(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*"([^"]*)"`));
  assert.ok(match, `missing Rust string field ${fieldName}`);
  return match[1];
}

function rustBoolField(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*(true|false)`));
  assert.ok(match, `missing Rust bool field ${fieldName}`);
  return match[1] === "true";
}

function rustCatalogEntryBlocks(source) {
  const catalogStart = source.indexOf("const BATCH_PROVIDER_CATALOG");
  assert.ok(catalogStart >= 0, "missing Rust batch provider catalog");
  const arrayStart = source.indexOf("[", catalogStart);
  const arrayEnd = source.indexOf("];", arrayStart);
  assert.ok(arrayStart >= 0 && arrayEnd > arrayStart, "missing Rust batch provider catalog array");
  const catalogSource = source.slice(arrayStart, arrayEnd);

  const blocks = [];
  let searchFrom = 0;
  while (true) {
    const entryStart = catalogSource.indexOf("BatchProviderCatalogEntry", searchFrom);
    if (entryStart < 0) break;
    const braceStart = catalogSource.indexOf("{", entryStart);
    assert.ok(braceStart >= 0, "missing Rust catalog entry opening brace");

    let depth = 0;
    for (let index = braceStart; index < catalogSource.length; index += 1) {
      const char = catalogSource[index];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(catalogSource.slice(braceStart + 1, index));
        searchFrom = index + 1;
        break;
      }
    }
  }

  return blocks;
}

function parseRustBatchProviderCatalog(source) {
  return rustCatalogEntryBlocks(source).map((block) => {
    const providerMatch = block.match(/provider:\s*BatchProvider::([A-Za-z0-9_]+)/);
    assert.ok(providerMatch, "missing Rust provider enum variant");

    return {
      variant: providerMatch[1],
      id: rustStringField(block, "id"),
      name: rustStringField(block, "name"),
      requiresKey: rustBoolField(block, "requires_key"),
      defaultBaseUrl: rustStringField(block, "default_base_url"),
      supportsEndpointOverride: rustBoolField(block, "supports_endpoint_override"),
      capabilities: {
        supportsBatch: rustBoolField(block, "supports_batch"),
        supportsStreaming: rustBoolField(block, "supports_streaming"),
        supportsRealtime: rustBoolField(block, "supports_realtime"),
      },
    };
  });
}

function tsBoolField(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*(true|false)`));
  assert.ok(match, `missing TS bool field ${fieldName}`);
  return match[1] === "true";
}

function tsObjectLiteralBody(source, objectName) {
  const objectStart = source.indexOf(`const ${objectName}`);
  assert.ok(objectStart >= 0, `missing TS object ${objectName}`);
  const braceStart = source.indexOf("{", objectStart);
  assert.ok(braceStart >= 0, `missing TS object ${objectName} opening brace`);

  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(braceStart + 1, index);
    }
  }

  throw new Error(`missing TS object ${objectName} closing brace`);
}

function tsTopLevelEntryBlocks(source, objectName) {
  const body = tsObjectLiteralBody(source, objectName);
  const blocks = [];
  let index = 0;

  while (index < body.length) {
    const entryMatch = /\s*([A-Za-z0-9_]+):\s*\{/g;
    entryMatch.lastIndex = index;
    const match = entryMatch.exec(body);
    if (!match) break;

    const key = match[1];
    const braceStart = entryMatch.lastIndex - 1;
    let depth = 0;
    for (let cursor = braceStart; cursor < body.length; cursor += 1) {
      const char = body[cursor];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        blocks.push({ key, block: body.slice(braceStart + 1, cursor) });
        index = cursor + 1;
        break;
      }
    }
  }

  return blocks;
}

function parseAudioManagerFallbackProviderMetadata(source) {
  return tsTopLevelEntryBlocks(source, "FALLBACK_PROVIDER_METADATA").map(({ key, block }) => {
    const idMatch = block.match(/id:\s*"([^"]*)"/);
    assert.ok(idMatch, `missing fallback id for ${key}`);

    const defaultBaseMatch = block.match(
      /default_base_url:\s*getFallbackProviderBaseUrl\("([^"]*)"\)/
    );
    assert.ok(defaultBaseMatch, `missing fallback default base helper for ${key}`);

    return {
      key,
      id: idMatch[1],
      defaultBaseProviderId: defaultBaseMatch[1],
      supportsEndpointOverride: tsBoolField(block, "supports_endpoint_override"),
      capabilities: {
        supportsBatch: tsBoolField(block, "supports_batch"),
        supportsStreaming: tsBoolField(block, "supports_streaming"),
        supportsRealtime: tsBoolField(block, "supports_realtime"),
      },
    };
  });
}

function loadEventCommandExportsForTest() {
  const output = ts.transpileModule(eventCommands, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    console,
    require(request) {
      if (request === "./commandCore") {
        return { hasTauriRuntime: () => false };
      }
      return {};
    },
  };

  vm.runInNewContext(output, sandbox, { filename: "eventCommands.ts" });
  return module.exports;
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("Rust emits unified transcript events while retaining legacy event names", () => {
  assert.match(domainModule, /TRANSCRIPT_EVENT_NAME:\s*&str\s*=\s*"transcript-event"/);
  assert.match(
    domainModule,
    /OPENAI_REALTIME_TRANSCRIPT_EVENT_NAME:\s*&str\s*=\s*"openai-realtime-transcript"/
  );
  assert.match(
    domainModule,
    /VOLCENGINE_STREAMING_TRANSCRIPT_EVENT_NAME:\s*&str\s*=\s*"volcengine-streaming-transcript"/
  );
  assert.match(domainModule, /BATCH_TRANSCRIPT_EVENT_NAME:\s*&str\s*=\s*"batch-transcript"/);
  assert.match(domainModule, /fn batch_final\(/);
  assert.match(domainModule, /app\.emit\(TRANSCRIPT_EVENT_NAME,\s*event\.clone\(\)\)/);
  assert.match(domainModule, /app\.emit\(legacy_event_name,\s*event\)/);
  assert.match(
    batchService,
    /emit_transcript_event\(\s*&app,\s*BATCH_TRANSCRIPT_EVENT_NAME,\s*TranscriptEvent::batch_final/
  );
  assert.match(
    openAIRealtime,
    /emit_transcript_event\(\s*&app,\s*OPENAI_REALTIME_TRANSCRIPT_EVENT_NAME,/
  );
  assert.match(
    volcengineStreaming,
    /emit_transcript_event\(\s*&app,\s*VOLCENGINE_STREAMING_TRANSCRIPT_EVENT_NAME,/
  );
});

test("batch transcription accepts and propagates optional session IDs", () => {
  assert.match(
    transcriptionCommands,
    /export async function transcribeAudio\([\s\S]*sessionId\?: string \| null,[\s\S]*endpointOverride\?: string \| null/
  );
  assert.match(transcriptionCommands, /sessionId:\s*sessionId \|\| null/);
  assert.match(transcriptionCommands, /endpointOverride:\s*endpointOverride \|\| null/);
  assert.match(
    platformTypes,
    /transcribeAudio:\s*\([\s\S]*sessionId\?: string \| null,[\s\S]*endpointOverride\?: string \| null[\s\S]*\) => Promise<string>/
  );
  assert.match(transcriptionCommand, /session_id:\s*Option<String>/);
  assert.match(transcriptionCommand, /endpoint_override:\s*Option<String>/);
  assert.match(domainModule, /pub session_id:\s*Option<String>/);
  assert.match(domainModule, /pub endpoint_override:\s*Option<String>/);
  assert.match(dictationCommand, /Some\(session_id\.clone\(\)\),[\s\S]*None/);
  assert.match(batchService, /fn normalize_batch_session_id/);
  assert.match(batchService, /fn normalize_batch_endpoint_override/);
  assert.match(batchService, /let request_session_id = request\.session_id\.clone\(\)/);
  assert.match(
    audioManager,
    /getSessionId:\s*NonNullable<AudioManagerCallbacks\["getSessionId"\]>/
  );
  assert.match(audioManager, /this\.currentSessionId\("renderer"\)/);
  assert.match(audioManager, /metadata\.sessionId \|\| undefined/);
});

test("builtin batch providers use the platform bridge while custom endpoints stay renderer-owned", () => {
  assert.match(audioManager, /shouldUsePlatformBatchTranscription/);
  assert.match(audioManager, /provider === "custom"[\s\S]*return false/);
  assert.doesNotMatch(audioManager, /cloudTranscriptionBaseUrl[\s\S]{0,200}return false/);
  assert.match(
    audioManager,
    /metadata\?\.capabilities\?\.supports_batch === true[\s\S]*metadata\?\.supports_endpoint_override === true/
  );
  assert.doesNotMatch(
    audioManager,
    /effectiveProvider === "assemblyai"[\s\S]*effectiveProvider === "openai"[\s\S]*effectiveProvider === "groq"[\s\S]*effectiveProvider === "zai"/
  );
  assert.match(audioManager, /zai:\s*"ZAI_API_KEY"/);
  assert.match(audioManager, /async preparePlatformBatchAudioBlob/);
  assert.match(audioManager, /provider !== "zai"[\s\S]*return audioBlob/);
  assert.match(audioManager, /this\.optimizeAudio\(audioBlob\)/);
  assert.match(audioManager, /async processWithPlatformBatchTranscription/);
  assert.match(audioManager, /resolvePlatformBatchEndpointOverride/);
  assert.match(audioManager, /providerMetadata\?\.supports_endpoint_override !== true/);
  assert.match(
    audioManager,
    /processWithPlatformBatchTranscription[\s\S]*this\.platform\.transcription\.transcribeAudio/
  );
  assert.match(
    audioManager,
    /const uploadAudio = await this\.preparePlatformBatchAudioBlob[\s\S]*new Uint8Array\(await uploadAudio\.arrayBuffer\(\)\)/
  );
  assert.match(audioManager, /endpointOverride \|\| undefined/);
  assert.match(
    audioManager,
    /this\.shouldUsePlatformBatchTranscription\([\s\S]*provider,[\s\S]*effectiveProvider,[\s\S]*platformProviderMetadata[\s\S]*this\.resolvePlatformBatchEndpointOverride[\s\S]*this\.processWithPlatformBatchTranscription/
  );
  const zaiDurationGuardIndex = audioManager.indexOf("durationSeconds > 30");
  const platformBatchIndex = audioManager.indexOf("this.shouldUsePlatformBatchTranscription(");
  assert.ok(zaiDurationGuardIndex >= 0, "Z.ai duration guard should exist");
  assert.ok(platformBatchIndex >= 0, "platform batch predicate should exist");
  assert.ok(
    zaiDurationGuardIndex < platformBatchIndex,
    "Z.ai duration guard should run before platform batch"
  );
  assert.doesNotMatch(
    audioManager,
    /this\.platform\.transcription\.transcribeAudio\([\s\S]{0,400}"zai"/
  );
  assert.match(
    audioManager,
    /if \(effectiveProvider === "assemblyai"\)[\s\S]*return this\.processWithAssemblyAI/
  );
  assert.match(domainModule, /detect_audio_part_metadata/);
  assert.match(batchService, /Transcription endpoint override must use HTTPS/);
  assert.match(batchService, /BatchProvider::Volcengine/);
  assert.match(providersModule, /pub\(crate\) fn provider_default_batch_url/);
  assert.match(providersModule, /pub\(crate\) fn provider_batch_url/);
  assert.match(
    providersModule,
    /BatchProvider::OpenAI \| BatchProvider::Groq[\s\S]*append_provider_path\(provider, "\/audio\/transcriptions"\)/
  );
  assert.match(
    providersModule,
    /BatchProvider::Zai[\s\S]*append_provider_path\(provider, "\/paas\/v4\/audio\/transcriptions"\)/
  );
  assert.match(assemblyAIProvider, /assemblyai_base_url/);
  assert.match(
    assemblyAIProvider,
    /provider_batch_url\(BatchProvider::AssemblyAI, endpoint_override\)/
  );
  assert.doesNotMatch(assemblyAIProvider, /https:\/\/api\.assemblyai\.com\/v2"/);
  assert.match(assemblyAIProvider, /format!\("\{base_url\}\/upload"\)/);
  assert.match(openAIProvider, /detect_audio_part_metadata/);
  assert.match(openAIProvider, /openai_transcription_endpoint/);
  assert.match(openAIProvider, /provider_batch_url\(BatchProvider::OpenAI, endpoint_override\)/);
  assert.doesNotMatch(openAIProvider, /https:\/\/api\.openai\.com\/v1\/audio\/transcriptions/);
  assert.match(groqProvider, /detect_audio_part_metadata/);
  assert.match(groqProvider, /groq_transcription_endpoint/);
  assert.match(groqProvider, /provider_batch_url\(BatchProvider::Groq, endpoint_override\)/);
  assert.doesNotMatch(groqProvider, /https:\/\/api\.groq\.com\/openai\/v1\/audio\/transcriptions/);
  assert.match(zaiProvider, /detect_audio_part_metadata/);
  assert.match(zaiProvider, /zai_transcription_endpoint/);
  assert.match(zaiProvider, /provider_batch_url\(BatchProvider::Zai, endpoint_override\)/);
  assert.doesNotMatch(zaiProvider, /https:\/\/api\.z\.ai\/api\/paas\/v4\/audio\/transcriptions/);
  assert.match(zaiProvider, /fn zai_audio_part_metadata/);
  assert.match(zaiProvider, /requires WAV or MP3 audio after renderer preparation/);
  assert.match(zaiProvider, /fn normalize_zai_model/);
  assert.match(zaiProvider, /fn extract_zai_transcript_text/);
});

test("platform bridge listens to the unified transcript event and filters legacy facades", () => {
  assert.match(
    platformTypes,
    /export type TranscriptEventMode = "batch" \| "streaming" \| "realtime"/
  );
  assert.match(eventCommands, /export const TRANSCRIPT_EVENT_NAME = "transcript-event"/);
  assert.match(eventCommands, /export function createTranscriptEventFilter/);
  assert.match(eventCommands, /return listen\(TRANSCRIPT_EVENT_NAME,/);
  assert.match(eventCommands, /export async function onTranscriptEvent/);
  assert.match(
    eventCommands,
    /onVolcengineStreamingTranscript[\s\S]*createTranscriptEventFilter<VolcengineStreamingTranscriptPayload>\([\s\S]*"volcengine"[\s\S]*"streaming"/
  );
  assert.match(
    eventCommands,
    /onOpenAIRealtimeTranscript[\s\S]*createTranscriptEventFilter<OpenAIRealtimeTranscriptPayload>\("openai", "realtime"/
  );
  assert.match(tauriPlatform, /onTranscriptEvent:\s*tauri\.onTranscriptEvent/);
});

test("transcript event legacy facade filters execute against unified payloads", () => {
  const { createTranscriptEventFilter } = loadEventCommandExportsForTest();
  assert.equal(typeof createTranscriptEventFilter, "function");

  const volcengineEvents = [];
  const openaiEvents = [];
  const volcengineFilter = createTranscriptEventFilter("volcengine", "streaming", (payload) => {
    volcengineEvents.push(payload);
  });
  const openaiFilter = createTranscriptEventFilter("openai", "realtime", (payload) => {
    openaiEvents.push(payload);
  });

  const volcengineStreaming = {
    sessionId: "session-streaming",
    provider: "volcengine",
    mode: "streaming",
    text: "stream text",
    isFinal: true,
    audioMs: 120,
    definite: true,
  };
  const volcengineBatch = {
    ...volcengineStreaming,
    mode: "batch",
    text: "batch text",
  };
  const openaiRealtime = {
    sessionId: "session-realtime",
    provider: "openai",
    mode: "realtime",
    text: "hello",
    delta: "lo",
    itemId: "item-1",
    isFinal: false,
    definite: false,
  };
  const openaiStreaming = {
    ...openaiRealtime,
    mode: "streaming",
  };

  for (const payload of [
    volcengineStreaming,
    volcengineBatch,
    openaiRealtime,
    openaiStreaming,
  ]) {
    volcengineFilter(payload);
    openaiFilter(payload);
  }

  assert.deepEqual(volcengineEvents, [volcengineStreaming]);
  assert.deepEqual(openaiEvents, [openaiRealtime]);
});

test("dictation UI consumes unified transcript events", () => {
  assert.match(audioManager, /this\.platform\.transcription\.onTranscriptEvent/);
  assert.doesNotMatch(audioManager, /this\.platform\.transcription\.volcengine\.onTranscript/);
  assert.doesNotMatch(audioManager, /this\.platform\.transcription\.openAIRealtime\.onTranscript/);
  assert.match(overlay, /platform\.transcription\.onTranscriptEvent/);
  assert.match(overlay, /activeSessionIdRef/);
  assert.match(overlay, /platform\.events\.onBackendDictationState/);
  assert.match(overlay, /sessionId !== activeSessionIdRef\.current/);
  assert.doesNotMatch(overlay, /platform\.transcription\.volcengine\.onTranscript/);
});

test("dictation strategy reads provider capabilities from the platform bridge", () => {
  assert.match(tauriPlatform, /getProviders:\s*tauri\.getTranscriptionProviders/);
  assert.match(audioManager, /loadTranscriptionProviderCapabilities/);
  assert.match(audioManager, /this\.platform\.transcription\.getProviders\(\)/);
  assert.match(transcriptionCommand, /default_base_url:\s*String/);
  assert.match(transcriptionCommand, /supports_endpoint_override:\s*bool/);
  assert.match(platformTypes, /default_base_url\?: string \| null/);
  assert.match(platformTypes, /supports_endpoint_override\?: boolean/);
  assert.match(providersModule, /default_base_url:\s*"https:\/\/api\.openai\.com\/v1"/);
  assert.match(providersModule, /supports_endpoint_override:\s*true/);
  assert.match(providersModule, /supports_endpoint_override:\s*false/);
  assert.match(audioManager, /import \{ getTranscriptionProvider \} from/);
  assert.match(
    audioManager,
    /getFallbackProviderBaseUrl\s*=\s*\(providerId: string\)[\s\S]*getTranscriptionProvider\(providerId\)\?\.baseUrl/
  );
  assert.match(audioManager, /default_base_url:\s*getFallbackProviderBaseUrl\("openai"\)/);
  assert.match(audioManager, /supports_endpoint_override:\s*true/);
  assert.match(audioManager, /supports_endpoint_override:\s*false/);
  assert.match(
    audioManager,
    /getTranscriptionEndpoint\(providerMetadata: TranscriptionProviderMetadata \| null = null\)/
  );
  assert.match(audioManager, /cachedEndpointDefaultBaseUrl/);
  assert.match(
    audioManager,
    /resolveProviderDefaultBaseUrl\s*=\s*\([\s\S]*default_base_url[\s\S]*normalizeBaseUrl/
  );
  assert.match(
    audioManager,
    /providerMetadata \|\|[\s\S]*transcriptionProviderCapabilityCache\?\.byProvider\?\.\[currentProvider\][\s\S]*FALLBACK_PROVIDER_METADATA\[currentProvider\]/
  );
  assert.match(
    audioManager,
    /buildTranscriptionEndpointForProvider\(currentProvider, normalizedBase\)/
  );
  assert.match(audioManager, /this\.getTranscriptionEndpoint\(platformProviderMetadata\)/);
  assert.match(audioManager, /capabilities\?\.supports_streaming\s*!==\s*true/);
  assert.match(audioManager, /capabilities\?\.supports_realtime\s*!==\s*true/);
  assert.match(audioManager, /await this\.shouldUseVolcengineStreaming\(\)/);
  assert.match(audioManager, /await this\.shouldUseOpenAIRealtimeStreaming\(\)/);
});

test("audio manager consumes typed history save results", () => {
  assert.match(audioManager, /const saveResult = await this\.platform\.history\.saveTranscription/);
  assert.match(audioManager, /return saveResult/);
});

test("frontend fallback provider capabilities stay aligned with the Rust registry", () => {
  assert.match(
    providersModule,
    /provider:\s*BatchProvider::OpenAI[\s\S]*supports_streaming:\s*false[\s\S]*supports_realtime:\s*true/
  );
  assert.match(
    providersModule,
    /provider:\s*BatchProvider::Volcengine[\s\S]*supports_streaming:\s*true[\s\S]*supports_realtime:\s*false/
  );

  const rustCatalog = parseRustBatchProviderCatalog(providersModule);
  const fallbackCatalog = parseAudioManagerFallbackProviderMetadata(audioManager);
  const registryProviders = modelRegistryData.transcriptionProviders;
  const registryProviderIds = registryProviders.map((provider) => provider.id);
  const rustProviderIds = rustCatalog.map((provider) => provider.id);
  const fallbackProviderIds = fallbackCatalog.map((provider) => provider.id);

  assert.deepEqual(rustProviderIds, registryProviderIds);
  assert.deepEqual(fallbackProviderIds, registryProviderIds);
  assert.deepEqual([...new Set(registryProviderIds)], registryProviderIds);
  assert.deepEqual(Object.keys(EXPECTED_TRANSCRIPTION_PROVIDER_POLICY), registryProviderIds);

  const rustCatalogById = Object.fromEntries(
    rustCatalog.map((provider) => [provider.id, provider])
  );
  const fallbackCatalogById = Object.fromEntries(
    fallbackCatalog.map((provider) => [provider.id, provider])
  );

  for (const registryProvider of registryProviders) {
    const rustProvider = rustCatalogById[registryProvider.id];
    const fallbackProvider = fallbackCatalogById[registryProvider.id];
    const expectedPolicy = EXPECTED_TRANSCRIPTION_PROVIDER_POLICY[registryProvider.id];

    assert.ok(rustProvider, `missing Rust catalog provider ${registryProvider.id}`);
    assert.ok(fallbackProvider, `missing fallback provider ${registryProvider.id}`);
    assert.ok(registryProvider.name.trim(), `missing registry provider name ${registryProvider.id}`);
    assert.ok(rustProvider.name.trim(), `missing Rust provider name ${registryProvider.id}`);
    assert.equal(rustProvider.defaultBaseUrl, registryProvider.baseUrl);
    assert.equal(rustProvider.requiresKey, expectedPolicy.requiresKey);
    assert.equal(
      rustProvider.supportsEndpointOverride,
      expectedPolicy.supportsEndpointOverride
    );
    assert.deepEqual(rustProvider.capabilities, expectedPolicy.capabilities);
    assert.equal(fallbackProvider.key, registryProvider.id);
    assert.equal(fallbackProvider.defaultBaseProviderId, registryProvider.id);
    assert.equal(
      fallbackProvider.supportsEndpointOverride,
      expectedPolicy.supportsEndpointOverride
    );
    assert.deepEqual(fallbackProvider.capabilities, expectedPolicy.capabilities);
  }
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

console.log(`transcript event contract tests passed (${tests.length})`);
