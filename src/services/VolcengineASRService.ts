import logger from "../utils/logger";

export interface VolcengineConfig {
  appId: string;
  accessToken: string;
  resourceId: string;
  language?: string;
  model?: string;
}

export async function transcribe(
  audioBlob: Blob,
  credentials: { appId: string; accessToken: string; resourceId: string },
  options: {
    language?: string;
    model?: string;
    onPartialResult?: (text: string) => void;
  } = {}
): Promise<string> {
  const { appId, accessToken, resourceId } = credentials;
  if (!appId || !accessToken) {
    throw new Error("Volcengine APP ID and Access Token are required");
  }

  logger.debug(
    "Volcengine ASR starting (via Tauri backend)",
    {
      model: options.model,
      language: options.language,
      resourceId: resourceId,
    },
    "transcription"
  );

  try {
    // Convert audio to WAV PCM 16kHz mono
    const conversionStart = performance.now();
    console.log(
      "[volcengine] preparing PCM audio, blob size:",
      audioBlob.size,
      "type:",
      audioBlob.type
    );
    const pcmData = await blobToPcm16kMono(audioBlob);
    console.log(
      "[volcengine] PCM data ready, size:",
      pcmData.length,
      "conversionMs:",
      Math.round(performance.now() - conversionStart)
    );

    // Call Tauri backend command (WebSocket with custom headers runs in Rust)
    console.log("[volcengine] calling Tauri invoke transcribe_audio");
    const { invoke } = await import("@tauri-apps/api/core");
    const text: string = await invoke("transcribe_audio", {
      audioData: Array.from(pcmData),
      provider: "volcengine",
      model: options.model || null,
      language: options.language || null,
    });
    console.log("[volcengine] invoke returned, text length:", text?.length);

    if (!text || !text.trim()) {
      throw new Error("Volcengine ASR returned no transcription result");
    }

    logger.debug(
      "Volcengine ASR complete",
      {
        textLength: text.length,
      },
      "transcription"
    );

    return text;
  } catch (err: unknown) {
    console.error(
      "[volcengine] error:",
      err,
      "type:",
      typeof err,
      "constructor:",
      (err as any)?.constructor?.name
    );
    const msg = err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
    throw new Error(msg || "Volcengine ASR failed (unknown error)");
  }
}

async function blobToPcm16kMono(audioBlob: Blob): Promise<Uint8Array> {
  const sourceBytes = new Uint8Array(await audioBlob.arrayBuffer());
  const directPcm = extractPcmFromWav(sourceBytes);
  if (directPcm) {
    return directPcm;
  }

  const wavBlob = await convertToWav(audioBlob);
  const wavBytes = new Uint8Array(await wavBlob.arrayBuffer());
  const pcm = extractPcmFromWav(wavBytes);
  if (!pcm) {
    throw new Error("Failed to convert audio to WAV PCM 16kHz mono");
  }
  return pcm;
}

function extractPcmFromWav(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 12) return null;
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") return null;

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = readU32Le(bytes, offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > bytes.length) return null;

    if (chunkId === "fmt " && chunkSize >= 16) {
      audioFormat = readU16Le(bytes, chunkStart);
      channels = readU16Le(bytes, chunkStart + 2);
      sampleRate = readU32Le(bytes, chunkStart + 4);
      bitsPerSample = readU16Le(bytes, chunkStart + 14);
    }

    if (chunkId === "data") {
      const isExpectedPcm =
        audioFormat === 1 && channels === 1 && sampleRate === 16000 && bitsPerSample === 16;
      if (!isExpectedPcm) return null;
      return bytes.slice(chunkStart, chunkEnd);
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  return null;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let i = 0; i < length; i++) {
    value += String.fromCharCode(bytes[offset + i]);
  }
  return value;
}

function readU16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

async function convertToWav(audioBlob: Blob): Promise<Blob> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const sampleRate = 16000;
  const channels = 1;
  const length = Math.floor(audioBuffer.duration * sampleRate);
  const offlineContext = new OfflineAudioContext(channels, length, sampleRate);

  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start();

  const renderedBuffer = await offlineContext.startRendering();
  return audioBufferToWav(renderedBuffer);
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const length = buffer.length;
  const arrayBuffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(arrayBuffer);
  const sampleRate = buffer.sampleRate;
  const channelData = buffer.getChannelData(0);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

const VolcengineASRService = {
  transcribe,
};

export default VolcengineASRService;
