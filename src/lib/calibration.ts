// Tuning constants mirrored from BumpyRide/CalibrationStore.swift.
// Server-side only enforces the validation clamp on PUT and the
// confidence floor on aggregation — the median / clamp computation
// itself lives in iOS.

export const GAIN_MIN = 0.5;
export const GAIN_MAX = 5.0;

/**
 * Apply the gain to a pocket-mode bumpiness sample only when the rider
 * has at least this many qualifying cells in their iOS-side median.
 * Same threshold the iOS app gates on, so device and server agree on
 * when correction is in effect.
 */
export const CONFIDENCE_FLOOR = 3;

export function calibrationActive(confidence: number): boolean {
  return confidence >= CONFIDENCE_FLOOR;
}
