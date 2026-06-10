import type { IncidentMetric, IncidentNorm, TilePercentile } from '@/lib/tile-mode';
import type { IncidentCell } from '@/lib/tile-renderer';

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

// Split a per-cell incident set into (in-bucket colored, out-of-bucket
// coverage). Used by every incident tile route's percentile path so
// they all expose the same "halo-on-coverage" UX.
//
// Rules:
//   - value <= 0: never colored; goes to halo-only so the user
//     sees the bump-coverage cell as context.
//   - value > 0 AND in bucket: colored with the metric ramp.
//   - value > 0 AND out of bucket: halo-only.
//
// Returns `{ colored, haloOnly }` ready to hand to renderIncidentTile.
export function splitIncidentCells(
  allCells: IncidentCell[],
  percentile: TilePercentile,
  threshold: { lo: number; hi: number },
): {
  colored: IncidentCell[];
  haloOnly: ReadonlyArray<{ ix: number; iy: number }>;
} {
  if (percentile === 'all') return { colored: allCells, haloOnly: [] };
  const colored: IncidentCell[] = [];
  const haloOnly: { ix: number; iy: number }[] = [];
  for (const c of allCells) {
    if (c.value <= 0) {
      haloOnly.push({ ix: c.ix, iy: c.iy });
      continue;
    }
    const inBucket =
      percentile === 'top10'
        ? c.value <= threshold.lo
        : c.value >= threshold.hi;
    if (inBucket) colored.push(c);
    else haloOnly.push({ ix: c.ix, iy: c.iy });
  }
  return { colored, haloOnly };
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
