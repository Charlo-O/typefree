/**
 * Sound feedback utilities built on Web Audio.
 */

import recordEndSoundUrl from "../assets/sounds/record-end.wav";
import recordStartSoundUrl from "../assets/sounds/record-start.wav";

let audioContext = null;
const sampleBufferCache = new Map();
const RECORDING_SAMPLE_VOLUME = 0.4;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

function playTone(frequency, duration, volume = 0.3, type = "sine", envelope = {}, delay = 0) {
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

function loadSampleBuffer(url) {
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

  return sampleBufferCache.get(url);
}

function playSampleSound(url, fallback) {
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
    .catch(() => fallback?.());
}

const START_SOUND_ENVELOPE = {
  attack: 0.08,
  release: 0.22,
};

const STOP_SOUND_ENVELOPE = {
  attack: 0.08,
  release: 0.22,
};

function playGeneratedStartSound() {
  playTone(392, 0.28, 0.055, "sine", START_SOUND_ENVELOPE);
  playTone(494, 0.36, 0.082, "sine", START_SOUND_ENVELOPE, 0.14);
}

function playGeneratedStopSound() {
  playTone(494, 0.26, 0.08, "sine", STOP_SOUND_ENVELOPE);
  setTimeout(() => playTone(392, 0.34, 0.095, "sine", STOP_SOUND_ENVELOPE), 120);
}

export function playStartSound() {
  playSampleSound(recordStartSoundUrl, playGeneratedStartSound);
}

export function playStopSound() {
  playSampleSound(recordEndSoundUrl, playGeneratedStopSound);
}

export function playCompleteSound() {
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

export function playErrorSound() {
  playTone(220, 0.3, 0.25, "sawtooth");
}

export const SOUNDS = {
  START: "start",
  STOP: "stop",
  COMPLETE: "complete",
  ERROR: "error",
};

export function playFeedbackSound(type) {
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
