/**
 * Sound feedback utilities built on Web Audio.
 */

let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

function playTone(frequency, duration, volume = 0.3, type = "sine", envelope = {}) {
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const now = ctx.currentTime;
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

const START_SOUND_ENVELOPE = {
  attack: 0.16,
  release: 0.24,
};

const STOP_SOUND_ENVELOPE = {
  attack: 0.08,
  release: 0.22,
};

export function playStartSound() {
  playTone(330, 0.38, 0.065, "sine", START_SOUND_ENVELOPE);
  setTimeout(() => playTone(494, 0.46, 0.115, "sine", START_SOUND_ENVELOPE), 190);
}

export function playStopSound() {
  playTone(494, 0.26, 0.08, "sine", STOP_SOUND_ENVELOPE);
  setTimeout(() => playTone(392, 0.34, 0.095, "sine", STOP_SOUND_ENVELOPE), 120);
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
