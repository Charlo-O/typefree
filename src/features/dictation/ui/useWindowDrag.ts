import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { platform } from "../../../shared/platform";

export type UseWindowDragResult = {
  isDragging: boolean;
  handleMouseDown: (event: MouseEvent<HTMLElement>) => void;
  handleMouseUp: () => void;
  handleClick: (event: MouseEvent<HTMLElement>) => void;
};

export const useWindowDrag = (): UseWindowDragResult => {
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button === 0) {
      // Left mouse button
      setIsDragging(true);
      void platform.window.startDrag();
      event.preventDefault();
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      void platform.window.stopDrag();
    }
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    // Prevent any click actions - use hotkey only
    event.preventDefault();
  };

  // Set up global mouse up listener when dragging
  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseUp = () => {
        setIsDragging(false);
        void platform.window.stopDrag();
      };

      document.addEventListener("mouseup", handleGlobalMouseUp);

      return () => {
        document.removeEventListener("mouseup", handleGlobalMouseUp);
      };
    }
  }, [isDragging]);

  return {
    isDragging,
    handleMouseDown,
    handleMouseUp,
    handleClick,
  };
};
