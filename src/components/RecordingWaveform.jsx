import React from "react";

const WAVE_BARS = [6, 11, 16, 9, 18, 12, 15, 8, 10];

export default function RecordingWaveform() {
  return (
    <span className="recording-waveform" aria-hidden="true">
      {WAVE_BARS.map((height, index) => (
        <span
          key={`${height}-${index}`}
          className="recording-waveform__bar"
          style={{
            "--wave-height": `${height}px`,
            "--wave-delay": `${index * 72}ms`,
            "--wave-duration": `${820 + (index % 3) * 110}ms`,
          }}
        />
      ))}
    </span>
  );
}
