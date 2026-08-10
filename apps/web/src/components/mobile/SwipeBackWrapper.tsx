"use client";

import { useRef, useCallback } from "react";

interface SwipeBackWrapperProps {
  onSwipeBack: () => void;
  children: React.ReactNode;
  threshold?: number;
  className?: string;
}

export default function SwipeBackWrapper({
  onSwipeBack,
  children,
  threshold = 50,
  className = "",
}: SwipeBackWrapperProps) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const deltaX = e.changedTouches[0].clientX - touchStartX.current;
      const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartY.current);

      // Only trigger if horizontal swipe from left edge area and mostly horizontal
      if (
        deltaX > threshold &&
        deltaY < deltaX * 0.7 &&
        touchStartX.current < 40
      ) {
        onSwipeBack();
      }
    },
    [onSwipeBack, threshold]
  );

  return (
    <div
      className={className}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </div>
  );
}
