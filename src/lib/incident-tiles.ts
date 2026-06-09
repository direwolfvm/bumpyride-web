import type { IncidentMetric, IncidentNorm } from '@/lib/tile-mode';

// Shared helpers for the brake + close-call tile routes. Holds the
// color-bucket thresholds for each (metric, norm) combination and
// the per-metric SQL expression so route files don't repeat the
// math.

// Standard gravity (m/s²). Used to convert peak deceleration into
// gs for the intensity formula: intensity = Σ(peak_g × duration).
export const G_MPS2 = 9.80665;

// Color-bucket thresholds for renderIncidentTile. Length 4 — the
// renderer interprets these as upper bounds for green / yellow /
// orange / red, with anything above the last threshold rendering
// as purple. See lib/tile-renderer.ts for the bucket semantics.
//
// Default count-style thresholds (raw event counts, integer):
//   value = 0          → green
//   0 < value ≤ 1      → yellow
//   1 < value ≤ 3      → orange
//   3 < value ≤ 5      → red
//   value > 5          → purple
//
// Freq (events per ride that touched the cell): ratio in [0, 1+].
//   thresholds chosen so "always brake here" cells (≥ 50%) read
//   purple and "occasionally" (≥ 10%) reads yellow.
//
// Intensity (Σ peak_g × duration, units of g·s). Calibrated to a
// firm brake being ~0.5 g·s and a panic stop ~1.5–2 g·s.
//
// These are starting values — they'll need tuning as we accumulate
// real-world data. Adjusting them shifts only colour buckets, not
// the underlying SQL.
export const INCIDENT_THRESHOLDS: Record<
  IncidentMetric,
  Record<IncidentNorm, readonly [number, number, number, number]>
> = {
  count: {
    raw: [0, 1, 3, 5],
    freq: [0, 0.1, 0.25, 0.5],
  },
  intensity: {
    raw: [0, 0.5, 1.5, 3],
    freq: [0, 0.1, 0.3, 0.6],
  },
};

// Per-cell metric SQL fragment. Takes column aliases for the metric
// CTE's per-cell `n` (count) and `intensity` (sum of g·s) plus the
// rides-through-cell count `rides`, and produces the final value
// the renderer color-codes.
//
// For norm=freq we divide by rides (always > 0 since coverage came
// from those rides). For metric=count + freq the result is a rate
// in [0, 1+]. For metric=intensity + freq, units are g·s per ride.
export function incidentValueExpr(
  metric: IncidentMetric,
  norm: IncidentNorm,
): string {
  const num = metric === 'intensity' ? 'COALESCE(m.intensity, 0)' : 'COALESCE(m.n, 0)::float8';
  return norm === 'freq' ? `${num} / cov.rides` : num;
}

// SQL fragment that produces (n, intensity) per cell from a source
// table aliased `src` whose rows expose `peak_deceleration_mps2` +
// `duration_seconds`. Used by the brake routes; close-calls only
// project n (intensity is undefined for close-call events).
export function brakeMetricsAgg(srcAlias: string): string {
  return `
    count(*)::int                                                      AS n,
    SUM(${srcAlias}.peak_deceleration_mps2 / ${G_MPS2} * ${srcAlias}.duration_seconds)::float8 AS intensity
  `;
}
