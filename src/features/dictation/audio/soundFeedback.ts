/**
 * Sound feedback utilities built on Web Audio.
 */

import recordEndSoundUrl from "../../../assets/sounds/record-end.wav";
import recordStartSoundUrl from "../../../assets/sounds/record-start.wav";

type AudioContextConstructor = typeof AudioContext;

type AudioWindow = Window & {
  webkitAudioContext?: AudioContextConstructor;
};

type SoundEnvelope = {
  attack?: number;
  release?: number;
  startVolume?: number;
};

let audioContext: AudioContext | null = null;
const sampleBufferCache = new Map<string, Promise<AudioBuffer>>();
const RECORDING_SAMPLE_VOLUME = 0.4;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || (window as AudioWindow).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Web Audio is not available in this runtime.");
    }
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }

  return audioContext;
}

function playTone(
  frequency: number,
  duration: number,
  volume = 0.3,
  type: OscillatorType = "sine",
  envelope: SoundEnvelope = {},
  delay = 0
): void {
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const now = ctx.currentTime + Math.max(0, delay);
  const attack = Math.max(0.01, Math.min(envelope.attack ?? 0.015, duration * 0.5));
  const release = Math.max(0.02, Math.min(envelope.release ?? 0.06, duration));
  const startVolume = Math.max(0.0001, Math.min(envelope.startVolume ?? 0.0001, volume));
  const sustainEnd = Math.max(now + attack, now + duration - release);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.type = type;

  gainNode.gain.setValueAtTime(startVolume, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + attack);
  gainNode.gain.setValueAtTime(volume, sustainEnd);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.start(now);
  oscillator.stop(now + duration);
}

function loadSampleBuffer(url: string): Promise<AudioBuffer> {
  if (!sampleBufferCache.has(url)) {
    const bufferPromise = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load sound: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => getAudioContext().decodeAudioData(arrayBuffer));

    sampleBufferCache.set(url, bufferPromise);
  }

  return sampleBufferCache.get(url)!;
}

function playSampleSound(url: string, fallback: () => void): void {
  const ctx = getAudioContext();

  loadSampleBuffer(url)
    .then((buffer) => {
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      gainNode.gain.value = RECORDING_SAMPLE_VOLUME;
      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start();
    })
    .catch(() => fallback());
}

const START_SOUND_ENVELOPE: SoundEnvelope = {
  attack: 0.08,
  release: 0.22,
};

const STOP_SOUND_ENVELOPE: SoundEnvelope = {
  attack: 0.08,
  release: 0.22,
};

function playGeneratedStartSound(): void {
  playTone(392, 0.28, 0.055, "sine", START_SOUND_ENVELOPE);
  playTone(494, 0.36, 0.082, "sine", START_SOUND_ENVELOPE, 0.14);
}

function playGeneratedStopSound(): void {
  playTone(494, 0.26, 0.08, "sine", STOP_SOUND_ENVELOPE);
  setTimeout(() => playTone(392, 0.34, 0.095, "sine", STOP_SOUND_ENVELOPE), 120);
}

export function playStartSound(): void {
  playSampleSound(recordStartSoundUrl, playGeneratedStartSound);
}

export function playStopSound(): void {
  playSampleSound(recordEndSoundUrl, playGeneratedStopSound);
}

export function playCompleteSound(): void {
  playTone(523, 0.14, 0.11, "sine", {
    attack: 0.055,
    release: 0.08,
  });

  setTimeout(
    () =>
      playTone(659, 0.16, 0.14, "sine", {
        attack: 0.05,
        release: 0.09,
      }),
    95
  );

  setTimeout(
    () =>
      playTone(784, 0.24, 0.18, "sine", {
        attack: 0.06,
        release: 0.12,
      }),
    205
  );
}

export function playErrorSound(): void {
  playTone(220, 0.3, 0.25, "sawtooth");
}

export const SOUNDS = {
  START: "start",
  STOP: "stop",
  COMPLETE: "complete",
  ERROR: "error",
} as const;

export type SoundType = (typeof SOUNDS)[keyof typeof SOUNDS];

export function playFeedbackSound(type: SoundType | string): void {
  switch (type) {
    case SOUNDS.START:
      playStartSound();
      break;
    case SOUNDS.STOP:
      playStopSound();
      break;
    case SOUNDS.COMPLETE:
      playCompleteSound();
      break;
    case SOUNDS.ERROR:
      playErrorSound();
      break;
    default:
      console.warn("Unknown sound type:", type);
  }
}

export default {
  playStartSound,
  playStopSound,
  playCompleteSound,
  playErrorSound,
  playFeedbackSound,
  SOUNDS,
};
