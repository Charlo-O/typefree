/**
 * Sound Feedback Service
 * 使用 Web Audio API 生成提示音，无需额外音频文件
 */

// 音频上下文（延迟初始化）
let audioContext = null;

/**
 * 获取或创建 AudioContext
 */
function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // 如果被挂起，恢复播放
    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
    return audioContext;
}

/**
 * 播放一个简单的音调
 * @param {number} frequency - 频率 (Hz)
 * @param {number} duration - 持续时间 (秒)
 * @param {number} volume - 音量 (0-1)
 * @param {string} type - 波形类型 ('sine', 'square', 'sawtooth', 'triangle')
 */
function playTone(frequency, duration, volume = 0.3, type = "sine") {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = type;
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    // 淡出效果
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
}

/**
 * 播放开始录音提示音 - 上升音调
 */
export function playStartSound() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // 两个快速上升的音调
    playTone(440, 0.1, 0.25, "sine"); // A4
    setTimeout(() => playTone(587, 0.15, 0.3, "sine"), 80); // D5
}

/**
 * 播放停止录音提示音 - 下降音调
 */
export function playStopSound() {
    const ctx = getAudioContext();

    // 两个下降的音调
    playTone(587, 0.1, 0.25, "sine"); // D5
    setTimeout(() => playTone(440, 0.15, 0.3, "sine"), 80); // A4
}

/**
 * 播放完成提示音 - 双音确认
 */
export function playCompleteSound() {
    const ctx = getAudioContext();

    // 三个快速的确认音
    playTone(523, 0.08, 0.2, "sine"); // C5
    setTimeout(() => playTone(659, 0.08, 0.25, "sine"), 70); // E5
    setTimeout(() => playTone(784, 0.15, 0.3, "sine"), 140); // G5
}

/**
 * 播放错误提示音
 */
export function playErrorSound() {
    playTone(220, 0.3, 0.25, "sawtooth"); // 低沉的警告音
}

// 提示音类型常量
export const SOUNDS = {
    START: "start",
    STOP: "stop",
    COMPLETE: "complete",
    ERROR: "error",
};

/**
 * 根据类型播放提示音
 * @param {string} type - 提示音类型
 */
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
