import { useEffect, useRef, useState } from "react";
import ParticleDictationCard from "./ParticleDictationCard";
import type { MoundPhase, MoundTheme, MoundVariant } from "./moundEngine";

/**
 * Dev-only harness (`?overlayPreview=true[&variant=dots][&theme=dark]`) that drives the particle card with a
 * simulated speech envelope and streaming transcript, so the overlay can be checked in a browser.
 */
const SAMPLE =
  "Remind me to call Maya tomorrow morning, then book a quiet table for two by the river.";

export default function ParticleCardPreview() {
  const params = new URLSearchParams(window.location.search);
  const variant: MoundVariant = params.get("variant") === "dots" ? "dots" : "ascii";
  const theme: MoundTheme = params.get("theme") === "dark" ? "dark" : "light";
  const levelRef = useRef<number | null>(0);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<MoundPhase>("recording");
  const [startedAt, setStartedAt] = useState(() => performance.now());

  useEffect(() => {
    const words = SAMPLE.split(" ");
    let index = 0;
    let timer = 0;
    const tick = () => {
      if (index < words.length) {
        index += 1;
        setText(words.slice(0, index).join(" "));
        timer = window.setTimeout(tick, 380 + Math.random() * 260);
      } else {
        setPhase("thinking");
        timer = window.setTimeout(() => {
          setText("");
          setPhase("recording");
          setStartedAt(performance.now());
          index = 0;
          timer = window.setTimeout(tick, 1200);
        }, 2400);
      }
    };
    timer = window.setTimeout(tick, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = (ms: number) => {
      const t = ms / 1000;
      const syllables = Math.max(0, Math.sin(t * 9) * 0.5 + Math.sin(t * 3.3) * 0.5);
      levelRef.current = phase === "recording" ? 0.25 + syllables * 0.65 : 0;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  return (
    <div
      className={[
        "flex h-screen w-screen items-center justify-center",
        theme === "dark" ? "bg-neutral-900" : "bg-neutral-200",
      ].join(" ")}
    >
      <ParticleDictationCard
        variant={variant}
        theme={theme}
        phase={phase}
        visible
        text={text}
        levelRef={levelRef}
        recordingStartedAt={startedAt}
        listeningLabel="Listening..."
        thinkingLabel="thinking"
      />
    </div>
  );
}
