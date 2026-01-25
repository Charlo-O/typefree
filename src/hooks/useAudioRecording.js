import { useState, useEffect, useRef } from "react";
import AudioManager from "../helpers/audioManager";

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

          await audioManagerRef.current.safePaste(result.text);

          audioManagerRef.current.saveTranscription(result.text);
        }
      },
    });

    // Set up hotkey listener for tap-to-talk mode
    const handleToggle = () => {
      const currentState = audioManagerRef.current.getState();

      if (!currentState.isRecording && !currentState.isProcessing) {
        audioManagerRef.current.startRecording();
      } else if (currentState.isRecording) {
        audioManagerRef.current.stopRecording();
      }
    };

    // Set up listener for push-to-talk start
    const handleStart = () => {
      const currentState = audioManagerRef.current.getState();
      if (!currentState.isRecording && !currentState.isProcessing) {
        audioManagerRef.current.startRecording();
      }
    };

    // Set up listener for push-to-talk stop
    const handleStop = () => {
      const currentState = audioManagerRef.current.getState();
      if (currentState.isRecording) {
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
      startRecording();
    } else if (isRecording) {
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
