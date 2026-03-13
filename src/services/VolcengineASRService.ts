import logger from "../utils/logger";

// Volcengine binary protocol constants
const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE = 0b0001; // 1 * 4 bytes = 4 bytes
const MSG_TYPE_FULL_CLIENT_REQUEST = 0b0001;
const MSG_TYPE_AUDIO_ONLY = 0b0010;
const MSG_TYPE_FULL_SERVER_RESPONSE = 0b1001;
const MSG_TYPE_SERVER_ACK = 0b1011;
const MSG_TYPE_SERVER_ERROR = 0b1111;

const MSG_TYPE_FLAGS_NONE = 0b0000;
const MSG_TYPE_FLAGS_LAST_AUDIO = 0b0010;

const SERIALIZATION_NONE = 0b0000;
const SERIALIZATION_JSON = 0b0001;

const COMPRESSION_NONE = 0b0000;
const COMPRESSION_GZIP = 0b0001;

export interface VolcengineConfig {
  appId: string;
  accessToken: string;
  resourceId: string;
  language?: string;
  model?: string;
}

export interface VolcengineResponse {
  text: string;
  utterances?: Array<{
    text: string;
    definite: boolean;
    start_time?: number;
    end_time?: number;
  }>;
  isDefinite: boolean;
  sequence: number;
}

function buildHeader(
  msgType: number,
  flags: number,
  serialization: number,
  compression: number
): Uint8Array {
  const header = new Uint8Array(4);
  header[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE;
  header[1] = (msgType << 4) | flags;
  header[2] = (serialization << 4) | compression;
  header[3] = 0x00; // reserved
  return header;
}

async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) as any);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new Uint8Array(value));
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) as any);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new Uint8Array(value));
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function buildFullClientRequest(config: VolcengineConfig): Promise<Uint8Array> {
  const isBigmodelAsync = !config.model || config.model === "volcengine-bigmodel-async";

  const payload: Record<string, unknown> = {
    app: {
      appid: config.appId,
      cluster: config.resourceId || "volc.bigasr.sauc.duration",
      token: config.accessToken,
    },
    user: {
      uid: "openwhispr-user",
    },
    request: {
      reqid: crypto.randomUUID(),
      nbest: 1,
      workflow: isBigmodelAsync ? "audio_in,restext" : "audio_in,restext",
      sequence: 1,
      show_utterances: true,
      result_type: isBigmodelAsync ? "single" : "single",
    },
    audio: {
      format: "wav",
      rate: 16000,
      bits: 16,
      channel: 1,
      language: config.language && config.language !== "auto" ? config.language : "zh-CN",
    },
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await gzipCompress(jsonBytes);

  const header = buildHeader(
    MSG_TYPE_FULL_CLIENT_REQUEST,
    MSG_TYPE_FLAGS_NONE,
    SERIALIZATION_JSON,
    COMPRESSION_GZIP
  );

  const sizeBytes = new Uint8Array(4);
  new DataView(sizeBytes.buffer).setUint32(0, compressed.length, false);

  const packet = new Uint8Array(header.length + sizeBytes.length + compressed.length);
  packet.set(header, 0);
  packet.set(sizeBytes, header.length);
  packet.set(compressed, header.length + sizeBytes.length);

  return packet;
}

function buildAudioPacket(audioData: Uint8Array, isLast: boolean): Uint8Array {
  const header = buildHeader(
    MSG_TYPE_AUDIO_ONLY,
    isLast ? MSG_TYPE_FLAGS_LAST_AUDIO : MSG_TYPE_FLAGS_NONE,
    SERIALIZATION_NONE,
    COMPRESSION_NONE
  );

  const sizeBytes = new Uint8Array(4);
  new DataView(sizeBytes.buffer).setUint32(0, audioData.length, false);

  const packet = new Uint8Array(header.length + sizeBytes.length + audioData.length);
  packet.set(header, 0);
  packet.set(sizeBytes, header.length);
  packet.set(audioData, header.length + sizeBytes.length);

  return packet;
}

async function parseResponse(data: ArrayBuffer): Promise<VolcengineResponse | null> {
  const view = new DataView(data);
  if (data.byteLength < 4) return null;

  const headerByte1 = view.getUint8(1);
  const headerByte2 = view.getUint8(2);
  const msgType = (headerByte1 >> 4) & 0x0f;
  const serialization = (headerByte2 >> 4) & 0x0f;
  const compression = headerByte2 & 0x0f;

  const headerSizeQuads = view.getUint8(0) & 0x0f;
  const headerByteLen = headerSizeQuads * 4;

  if (msgType === MSG_TYPE_SERVER_ACK) {
    // Ack packet, no payload to parse
    return null;
  }

  if (msgType === MSG_TYPE_SERVER_ERROR) {
    // Error response
    if (data.byteLength > headerByteLen + 4) {
      const errorPayloadSize = view.getUint32(headerByteLen, false);
      if (errorPayloadSize > 0) {
        const rawErrorBytes = new Uint8Array(data, headerByteLen + 4, errorPayloadSize);
        const errorPayload = compression === COMPRESSION_GZIP
          ? await gzipDecompress(rawErrorBytes)
          : rawErrorBytes;
        const errorText = new TextDecoder().decode(errorPayload);
        logger.error("Volcengine server error", { error: errorText }, "transcription");
        throw new Error(`Volcengine ASR error: ${errorText}`);
      }
    }
    throw new Error("Volcengine ASR server returned an error");
  }

  if (msgType !== MSG_TYPE_FULL_SERVER_RESPONSE) {
    return null;
  }

  if (data.byteLength <= headerByteLen + 4) {
    return null;
  }

  // Read sequence number (4 bytes after header)
  const sequence = view.getUint32(headerByteLen, false);

  // Payload size is after the sequence number
  if (data.byteLength <= headerByteLen + 8) {
    return null;
  }
  const payloadSize = view.getUint32(headerByteLen + 4, false);
  if (payloadSize === 0) return null;

  const rawPayloadBytes = new Uint8Array(data, headerByteLen + 8, payloadSize);
  const payloadBytes = compression === COMPRESSION_GZIP
    ? await gzipDecompress(rawPayloadBytes)
    : rawPayloadBytes;

  if (serialization !== SERIALIZATION_JSON) {
    return null;
  }

  const jsonStr = new TextDecoder().decode(payloadBytes);

  try {
    const parsed = JSON.parse(jsonStr);
    const utterances = parsed.result?.utterances || parsed.utterances || [];
    const text =
      parsed.result?.text ||
      parsed.text ||
      utterances
        .map((u: { text: string }) => u.text)
        .join("")
        .trim();
    const isDefinite = utterances.length > 0 ? utterances.every((u: { definite: boolean }) => u.definite) : false;

    return {
      text,
      utterances,
      isDefinite,
      sequence,
    };
  } catch (e) {
    logger.error("Failed to parse Volcengine response JSON", { error: String(e), jsonStr }, "transcription");
    return null;
  }
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

  const config: VolcengineConfig = {
    appId,
    accessToken,
    resourceId: resourceId || "volc.bigasr.sauc.duration",
    language: options.language,
    model: options.model,
  };

  const isBigmodelAsync = !config.model || config.model === "volcengine-bigmodel-async";
  const wsUrl = isBigmodelAsync
    ? "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
    : "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel";

  logger.debug("Volcengine ASR starting", {
    wsUrl,
    model: config.model,
    language: config.language,
    resourceId: config.resourceId,
  }, "transcription");

  // Convert audio to WAV PCM 16kHz mono
  const wavBlob = await convertToWav(audioBlob);
  const wavArrayBuffer = await wavBlob.arrayBuffer();
  // Skip WAV header (44 bytes) to get raw PCM data
  const pcmData = new Uint8Array(wavArrayBuffer, 44);

  return new Promise<string>((resolve, reject) => {
    let accumulatedText = "";
    let wsOpened = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    // Timeout protection: 60 seconds
    timeoutId = setTimeout(() => {
      logger.error("Volcengine ASR timeout", {}, "transcription");
      cleanup();
      if (accumulatedText) {
        resolve(accumulatedText);
      } else {
        reject(new Error("Volcengine ASR transcription timed out"));
      }
    }, 60000);

    ws.onopen = async () => {
      wsOpened = true;
      logger.debug("Volcengine WebSocket connected", {}, "transcription");

      try {
        // Send full client request (config)
        const configPacket = await buildFullClientRequest(config);
        ws.send(configPacket);

        // Split PCM into ~200ms chunks (16000 Hz * 2 bytes * 0.2s = 6400 bytes)
        const chunkSize = 6400;
        const totalChunks = Math.ceil(pcmData.length / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, pcmData.length);
          const chunk = pcmData.slice(start, end);
          const isLast = i === totalChunks - 1;

          const audioPacket = buildAudioPacket(chunk, isLast);

          if (ws.readyState !== WebSocket.OPEN) {
            break;
          }

          ws.send(audioPacket);

          // Small delay between chunks to simulate real-time streaming
          if (!isLast) {
            await new Promise((r) => setTimeout(r, 20));
          }
        }

        logger.debug("Volcengine audio sent", { totalChunks, pcmBytes: pcmData.length }, "transcription");
      } catch (e) {
        logger.error("Volcengine send error", { error: String(e) }, "transcription");
        cleanup();
        reject(e);
      }
    };

    ws.onmessage = async (event) => {
      try {
        const response = await parseResponse(event.data as ArrayBuffer);
        if (!response) return;

        logger.debug("Volcengine response", {
          text: response.text,
          isDefinite: response.isDefinite,
          sequence: response.sequence,
        }, "transcription");

        if (response.text) {
          accumulatedText = response.text;
          options.onPartialResult?.(response.text);
        }

        // For bigmodel_async, the final result has all definite utterances
        if (response.isDefinite && response.text) {
          accumulatedText = response.text;
        }
      } catch (e) {
        logger.error("Volcengine parse error", { error: String(e) }, "transcription");
        cleanup();
        reject(e);
      }
    };

    ws.onerror = (event) => {
      logger.error("Volcengine WebSocket error", { event: String(event) }, "transcription");
      if (!wsOpened) {
        cleanup();
        reject(new Error("Failed to connect to Volcengine ASR service"));
      }
    };

    ws.onclose = (event) => {
      clearTimeout(timeoutId);
      logger.debug("Volcengine WebSocket closed", {
        code: event.code,
        reason: event.reason,
        accumulatedTextLength: accumulatedText.length,
      }, "transcription");

      if (accumulatedText) {
        resolve(accumulatedText);
      } else {
        reject(new Error("Volcengine ASR returned no transcription result"));
      }
    };
  });
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
