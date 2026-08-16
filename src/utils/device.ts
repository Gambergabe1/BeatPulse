export interface SliderDeviceSignals {
  coarsePointer: boolean;
  noHover: boolean;
  maxTouchPoints: number;
  viewportWidth: number;
}

export const usesMovingSlidersForDevice = (signals: SliderDeviceSignals) =>
  signals.coarsePointer || (
    signals.noHover &&
    signals.maxTouchPoints > 0 &&
    signals.viewportWidth <= 1280
  );

/**
 * Moving sliders are reserved for touch-first mobile and tablet play.
 * Fine-pointer computers receive single-lane holds, including touch laptops.
 */
export const prefersMovingSliders = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return usesMovingSlidersForDevice({
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    noHover: window.matchMedia?.('(hover: none)').matches ?? false,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    viewportWidth: window.innerWidth,
  });
};
