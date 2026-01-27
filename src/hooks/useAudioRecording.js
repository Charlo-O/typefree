import { useState, useEffect, useRef } from "react";
import AudioManager from "../helpers/audioManager";
import { playStartSound, playStopSound, playCompleteSound } from "../helpers/soundFeedback";

export const useAudioRecording = (toast, options = {}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const audioManagerRef = useRef(null);
  const { onToggle } = options;

  useEffect(() => {
    audioManagerRef.current = new AudioManager();

    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing }) => {
        setIsRecording(isRecording);
        setIsProcessing(isProcessing);
      },
      onError: (error) => {
        toast({
          title: error.title,
          description: error.description,
          variant: "destructive",
        });
      },
      onTranscriptionComplete: async (result) => {
        if (result.success) {
          setTranscript(result.text);
          console.log("[Transcription] Complete, text:", result.text?.substring(0, 50));

          // 1. 播放完成提示音
          playCompleteSound();

          // 2. 先隐藏窗口，让焦点回到原来的应用
          console.log("[Transcription] Hiding window...");
          window.electronAPI?.hideWindow?.();

          // 3. 等待焦点切换后再粘贴（增加到 500ms）
          setTimeout(async () => {
            console.log("[Transcription] Pasting text...");
            const pasteResult = await audioManagerRef.current.safePaste(result.text);
            console.log("[Transcription] Paste result:", pasteResult);
            audioManagerRef.current.saveTranscription(result.text);
          }, 500);
        }
      },
    });

    // Set up hotkey listener for tap-to-talk mode
    const handleToggle = () => {
      const currentState = audioManagerRef.current.getState();

      if (!currentState.isRecording && !currentState.isProcessing) {
        // 开始录音：显示窗口 + 播放开始音
        window.electronAPI?.showWindow?.();
        playStartSound();
        audioManagerRef.current.startRecording();
      } else if (currentState.isRecording) {
        // 停止录音：播放停止音
        playStopSound();
        audioManagerRef.current.stopRecording();
      }
    };

    // Set up listener for push-to-talk start
    const handleStart = () => {
      const currentState = audioManagerRef.current.getState();
      if (!currentState.isRecording && !currentState.isProcessing) {
        // 开始录音：显示窗口 + 播放开始音
        window.electronAPI?.showWindow?.();
        playStartSound();
        audioManagerRef.current.startRecording();
      }
    };

    // Set up listener for push-to-talk stop
    const handleStop = () => {
      const currentState = audioManagerRef.current.getState();
      if (currentState.isRecording) {
        // 停止录音：播放停止音
        playStopSound();
        audioManagerRef.current.stopRecording();
      }
    };

    // In Tauri, event listeners typically return a Promise<unlisten>.
    // In Electron, they commonly return an unlisten function directly.
    const toCleanup = (maybeUnlisten) => {
      if (!maybeUnlisten) return null;
      if (typeof maybeUnlisten === "function") {
        return { kind: "fn", fn: maybeUnlisten };
      }
      if (typeof maybeUnlisten.then === "function") {
        return { kind: "promise", promise: maybeUnlisten };
      }
      return null;
    };

    const disposeToggle = toCleanup(
      window.electronAPI?.onToggleDictation?.(() => {
        handleToggle();
        onToggle?.();
      })
    );

    const disposeStart = toCleanup(
      window.electronAPI?.onStartDictation?.(() => {
        handleStart();
        onToggle?.();
      })
    );

    const disposeStop = toCleanup(
      window.electronAPI?.onStopDictation?.(() => {
        handleStop();
        onToggle?.();
      })
    );

    const handleNoAudioDetected = () => {
      toast({
        title: "No Audio Detected",
        description: "The recording contained no detectable audio. Please try again.",
        variant: "default",
      });
    };

    const disposeNoAudio = window.electronAPI.onNoAudioDetected?.(handleNoAudioDetected);

    // Cleanup
    return () => {
      const runCleanup = (cleanup) => {
        if (!cleanup) return;
        if (cleanup.kind === "fn") {
          cleanup.fn?.();
          return;
        }
        cleanup.promise
          .then((fn) => fn?.())
          .catch(() => {
            // ignore
          });
      };

      runCleanup(disposeToggle);
      runCleanup(disposeStart);
      runCleanup(disposeStop);
      disposeNoAudio?.();
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [toast, onToggle]);

  const startRecording = async () => {
    if (audioManagerRef.current) {
      return await audioManagerRef.current.startRecording();
    }
    return false;
  };

  const stopRecording = () => {
    if (audioManagerRef.current) {
      return audioManagerRef.current.stopRecording();
    }
    return false;
  };

  const cancelRecording = () => {
    if (audioManagerRef.current) {
      return audioManagerRef.current.cancelRecording();
    }
    return false;
  };

  const toggleListening = () => {
    if (!isRecording && !isProcessing) {
      // 开始录音：显示窗口 + 播放开始音
      window.electronAPI?.showWindow?.();
      playStartSound();
      startRecording();
    } else if (isRecording) {
      // 停止录音：播放停止音
      playStopSound();
      stopRecording();
    }
  };

  return {
    isRecording,
    isProcessing,
    transcript,
    startRecording,
    stopRecording,
    cancelRecording,
    toggleListening,
  };
};
