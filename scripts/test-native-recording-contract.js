#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const tauriRoot = path.join(repoRoot, "src-tauri");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertIncludes(source, snippet) {
  assert.equal(source.includes(snippet), true, snippet);
}

function assertMatches(source, pattern, label = String(pattern)) {
  assert.match(source, pattern, label);
}

const recordingRs = read(path.join(tauriRoot, "src", "commands", "recording.rs"));
const cargoToml = read(path.join(tauriRoot, "Cargo.toml"));
const libRs = read(path.join(tauriRoot, "src", "lib.rs"));
const recordingCommands = read(path.join(srcRoot, "shared", "platform", "recordingCommands.ts"));
const platformTypes = read(path.join(srcRoot, "shared", "platform", "types.ts"));
const tauriPlatform = read(path.join(srcRoot, "shared", "platform", "tauriPlatform.ts"));
const audioManager = read(path.join(srcRoot, "features", "dictation", "audio", "audioManager.ts"));
const developerSection = read(
  path.join(srcRoot, "features", "settings", "ui", "DeveloperSection.tsx")
);
const packageJson = JSON.parse(read(path.join(repoRoot, "package.json")));

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("native recorder exposes one capability contract through a trait facade", () => {
  assertMatches(recordingRs, /pub struct NativeRecordingCapabilities \{[\s\S]*supported: bool/);
  assertMatches(recordingRs, /pub struct NativeRecordingCapabilities \{[\s\S]*platform: String/);
  assertMatches(recordingRs, /pub struct NativeRecordingCapabilities \{[\s\S]*backend: String/);
  assertMatches(recordingRs, /pub struct NativeRecordingCapabilities \{[\s\S]*status: String/);
  assertMatches(
    recordingRs,
    /pub struct NativeRecordingCapabilities \{[\s\S]*reason: Option<String>/
  );
  assertMatches(recordingRs, /pub struct NativeRecordingCapabilities \{[\s\S]*active: bool/);
  assertIncludes(recordingRs, '#[serde(rename_all = "camelCase")]');

  assertMatches(recordingRs, /trait AudioRecorder: Sync \{[\s\S]*fn backend\(&self\)/);
  assertMatches(recordingRs, /trait AudioRecorder: Sync \{[\s\S]*fn capabilities\(&self\)/);
  assertMatches(recordingRs, /supported: self\.is_supported\(\)/);
  assertMatches(recordingRs, /platform: platform_name\(\)\.to_string\(\)/);
  assertMatches(recordingRs, /backend: self\.backend\(\)\.to_string\(\)/);
  assertMatches(recordingRs, /active: self\.is_active\(\)/);

  assertMatches(recordingRs, /#\[cfg\(target_os = "macos"\)\][\s\S]*return &macos::RECORDER/);
  assertMatches(
    recordingRs,
    /#\[cfg\(target_os = "windows"\)\][\s\S]*return &windows_recorder::RECORDER/
  );
  assertMatches(
    recordingRs,
    /#\[cfg\(target_os = "linux"\)\][\s\S]*return &linux_recorder::RECORDER/
  );
  assertMatches(recordingRs, /return &unsupported_recorder::RECORDER/);
});

test("Tauri recording commands use typed command errors and the selected recorder", () => {
  assertIncludes(
    recordingRs,
    'CommandError::from_message(message.into()).with_source("recording")'
  );
  assertMatches(
    recordingRs,
    /pub fn get_native_recording_capabilities\(\) -> NativeRecordingCapabilities \{[\s\S]*selected_recorder\(\)\.capabilities\(\)/
  );
  assertMatches(
    recordingRs,
    /pub async fn start_native_recording\(\) -> CommandResult<bool> \{[\s\S]*selected_recorder\(\)[\s\S]*\.start\(\)[\s\S]*\.map_err\(recording_error\)/
  );
  assertMatches(
    recordingRs,
    /pub async fn stop_native_recording\(\) -> CommandResult<NativeRecordingResult> \{[\s\S]*selected_recorder\(\)\.stop\(\)\.map_err\(recording_error\)/
  );
  assertMatches(
    recordingRs,
    /pub async fn cancel_native_recording\(\) -> CommandResult<bool> \{[\s\S]*selected_recorder\(\)[\s\S]*\.cancel\(\)[\s\S]*\.map_err\(recording_error\)/
  );
  assertMatches(libRs, /recording::start_native_recording/);
  assertMatches(libRs, /recording::stop_native_recording/);
  assertMatches(libRs, /recording::cancel_native_recording/);
  assertMatches(libRs, /recording::get_native_recording_capabilities/);
  assert.doesNotMatch(libRs, /Native recording commands \(macOS only/);
});

test("macOS backend records CoreAudio-compatible mono WAV through AVFoundation", () => {
  assertMatches(recordingRs, /#\[cfg\(target_os = "macos"\)\]\s*mod macos/);
  assertIncludes(recordingRs, "AVAudioRecorder");
  assertIncludes(recordingRs, "K_AUDIO_FORMAT_LINEAR_PCM");
  assertIncludes(recordingRs, "16_000.0");
  assertIncludes(recordingRs, "NSNumber::initWithUnsignedInt(NSNumber::alloc(), 1)");
  assertIncludes(recordingRs, "NSNumber::initWithUnsignedInt(NSNumber::alloc(), 16)");
  assertMatches(recordingRs, /fn read_wav_with_retry\(path: &PathBuf\)[\s\S]*is_wav_header/);
  assertIncludes(recordingRs, '"macos-avfoundation-coreaudio"');
  assertMatches(recordingRs, /impl AudioRecorder for MacosAudioRecorder/);
});

test("Windows backend captures WASAPI input and returns 16k mono WAV", () => {
  assertMatches(cargoToml, /\[target\.'cfg\(target_os = "windows"\)'\.dependencies\]/);
  assertIncludes(cargoToml, '"Win32_Media_Audio"');
  assertMatches(recordingRs, /#\[cfg\(target_os = "windows"\)\]\s*mod windows_recorder/);
  assertIncludes(recordingRs, "IAudioCaptureClient");
  assertIncludes(recordingRs, "GetDefaultAudioEndpoint(eCapture, eConsole)");
  assertIncludes(recordingRs, "const OUTPUT_SAMPLE_RATE: u32 = 16_000;");
  assertIncludes(recordingRs, "const OUTPUT_CHANNELS: u16 = 1;");
  assertIncludes(recordingRs, "read_pcm_sample");
  assertIncludes(recordingRs, "read_float_sample");
  assertIncludes(recordingRs, "resample_linear");
  assertIncludes(recordingRs, "write_wav_mono_i16");
  assertIncludes(recordingRs, '"typefree-windows-wasapi-recorder"');
  assertIncludes(recordingRs, '"windows-wasapi"');
  assertMatches(recordingRs, /impl AudioRecorder for WindowsWasapiRecorder/);
});

test("Linux backend prefers PipeWire and falls back to PulseAudio recorders", () => {
  assertMatches(recordingRs, /#\[cfg\(target_os = "linux"\)\]\s*mod linux_recorder/);
  assertIncludes(recordingRs, 'LinuxCaptureTool::PipeWire => "pw-record"');
  assertIncludes(recordingRs, 'LinuxCaptureTool::PulseAudioRecord => "parecord"');
  assertIncludes(recordingRs, 'LinuxCaptureTool::PulseAudioCat => "parec"');
  assertIncludes(recordingRs, '"--rate"');
  assertIncludes(recordingRs, '"16000"');
  assertIncludes(recordingRs, '"--channels"');
  assertIncludes(recordingRs, '"1"');
  assertIncludes(recordingRs, '"--file-format=wav"');
  assertIncludes(recordingRs, "fn send_interrupt(child: &Child)");
  assertIncludes(recordingRs, 'Command::new("kill")');
  assertIncludes(recordingRs, "wait_for_exit(&mut recorder_state.child, Duration::from_secs(2))");
  assertIncludes(recordingRs, '"linux-pipewire-pulseaudio"');
  assertIncludes(recordingRs, "renderer MediaRecorder remains the fallback");
  assertMatches(recordingRs, /impl AudioRecorder for LinuxPipewirePulseRecorder/);
});

test("unsupported platforms fail closed while preserving cancel idempotency", () => {
  assertMatches(recordingRs, /mod unsupported_recorder \{[\s\S]*UnsupportedAudioRecorder/);
  assertIncludes(recordingRs, '"unsupported"');
  assertIncludes(recordingRs, '"unavailable"');
  assertIncludes(recordingRs, "Native recording is not available on this platform.");
  assertMatches(recordingRs, /fn cancel\(&self\) -> Result<\(\), String> \{[\s\S]*Ok\(\(\)\)/);
});

test("frontend platform bridge consumes capabilities and falls back to browser recording", () => {
  assertMatches(
    platformTypes,
    /export type NativeRecordingCapabilities = \{[\s\S]*supported: boolean/
  );
  assertMatches(
    platformTypes,
    /export type NativeRecordingCapabilities = \{[\s\S]*backend: string/
  );
  assertMatches(
    platformTypes,
    /export type NativeRecordingCapabilities = \{[\s\S]*active: boolean/
  );
  assertMatches(platformTypes, /recording:\s*\{[\s\S]*getNativeCapabilities/);
  assertIncludes(recordingCommands, 'backend: "browser-mediarecorder"');
  assertIncludes(
    recordingCommands,
    'invoke<NativeRecordingCapabilities>("get_native_recording_capabilities")'
  );
  assertIncludes(recordingCommands, 'return invoke("start_native_recording")');
  assertIncludes(recordingCommands, 'await invoke("stop_native_recording")');
  assertIncludes(recordingCommands, "result?.audio_data || result?.audioData || []");
  assertIncludes(recordingCommands, 'return invoke("cancel_native_recording")');
  assertMatches(
    tauriPlatform,
    /recording:\s*\{[\s\S]*getNativeCapabilities: tauri\.getNativeRecordingCapabilities/
  );
  assertMatches(tauriPlatform, /recording:\s*\{[\s\S]*startNative: tauri\.startNativeRecording/);
});

test("audio manager prefers native recording only when capabilities prove support", () => {
  assertMatches(
    audioManager,
    /async loadNativeRecordingCapabilities\(\)[\s\S]*getNativeCapabilities/
  );
  assertMatches(
    audioManager,
    /async shouldUseNativeRecording\(\)[\s\S]*capabilities\?\.supported === true/
  );
  assertMatches(
    audioManager,
    /if \(await this\.shouldUseNativeRecording\(\)\) \{[\s\S]*startNative\(\)/
  );
  assertMatches(audioManager, /this\.armRecordingMaxDurationTimer\("native"\)/);
  assertMatches(
    audioManager,
    /stopNativeRecordingInternal\(\)[\s\S]*this\.platform\.recording\.stopNative\(\)/
  );
  assertMatches(audioManager, /new Blob\(\[audioBytes\.buffer\], \{ type: mimeType \}\)/);
  assertMatches(
    audioManager,
    /cancelNativeRecordingInternal\(\)[\s\S]*this\.platform\.recording\.cancelNative\(\)/
  );
  assertMatches(
    audioManager,
    /Compatibility fallback for older bridges that predate recorder capabilities/
  );
});

test("native recording smoke captures a bounded sample without STT or paste", () => {
  assertIncludes(developerSection, "TYPEFREE_NATIVE_RECORDING_SMOKE_RESULT");
  assertIncludes(developerSection, "VITE_TYPEFREE_NATIVE_RECORDING_SMOKE_AUTORUN");
  assertMatches(developerSection, /function shouldAutorunNativeRecordingSmoke\(\): boolean/);
  assertMatches(developerSection, /function nativeRecordingSmokeDurationMs\(\): number/);
  assertMatches(developerSection, /function isWavAudioData\(audioData\?: Uint8Array \| null\)/);
  assertMatches(
    developerSection,
    /const handleRunNativeRecordingSmoke = useCallback\(async \(\) =>/
  );
  assertMatches(
    developerSection,
    /await platform\.recording\.getNativeCapabilities\(\)[\s\S]*await platform\.recording\.startNative\(\)[\s\S]*await platform\.recording\.stopNative\(\)/
  );
  assertMatches(developerSection, /await platform\.recording\.cancelNative\(\)/);
  assertMatches(developerSection, /audioBytes >= 44 && wav/);
  assertMatches(developerSection, /label: "native-recording\.smoke"/);
  assertMatches(developerSection, /emitNativeRecordingSmokeResult/);

  const handlerMatch = developerSection.match(
    /const handleRunNativeRecordingSmoke = useCallback\(async \(\) => \{[\s\S]*?\n\s{2}const handleRunDictationPipelineSmoke/
  );
  assert.ok(handlerMatch, "native recording smoke handler not found");
  const handler = handlerMatch[0];

  for (const forbidden of [
    "transcribeAudio",
    "runDictationCompletionPipeline",
    "postprocess",
    "pasteText",
    "writeClipboard",
  ]) {
    assert.doesNotMatch(handler, new RegExp(forbidden), forbidden);
  }
});

test("native recording contract is part of Tauri verification", () => {
  assert.equal(
    packageJson.scripts["test:native-recording-contract"],
    "node scripts/test-native-recording-contract.js"
  );
  assert.equal(
    packageJson.scripts["smoke:native-recording"],
    "node scripts/run-tauri-dev-smoke.js --native-recording-smoke"
  );
  assert.match(packageJson.scripts["verify:tauri"], /npm run test:native-recording-contract/);
  assert.doesNotMatch(packageJson.scripts["verify:tauri"], /npm run smoke:native-recording/);
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

  console.log(`native recording contract tests passed (${tests.length})`);
})();
