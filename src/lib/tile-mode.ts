// View-mode toggle shared by all three public-map tile routes.
//
//   all      — the lifetime aggregate. Default.
//   3mo      — restrict to events / points in the last three months.
//   last10   — only the ten most recent events / points per cell.
//
// Parsed from ?mode= on every tile request. Unknown values quietly
// fall back to "all" so a stale client never breaks the map.

export const TILE_MODES = ['all', '3mo', 'last10'] as const;
export type TileMode = (typeof TILE_MODES)[number];

export function parseTileMode(raw: string | null | undefined): TileMode {
  if (!raw) return 'all';
  return (TILE_MODES as readonly string[]).includes(raw)
    ? (raw as TileMode)
    : 'all';
}

// Per-cell value filter, also shared across tile routes.
//
//   all      — render every cell that passes the privacy gate.
//   top10    — only cells in the best-10% bucket of their layer.
//              For bumpiness, smaller avg = smoother = "better".
//              For incidents, smaller count = fewer incidents = "better".
//              So top10 means avg/count <= percentile_cont(0.10).
//   bottom10 — only cells in the worst-10% bucket. avg/count >=
//              percentile_cont(0.90).
//
// Cutoffs are computed across the full dataset for the current
// layer + mode + privacy gate (NOT just the visible bbox), so the
// "best 10%" claim holds globally rather than relative to the
// current viewport.

export const TILE_PERCENTILES = ['all', 'top10', 'bottom10'] as const;
export type TilePercentile = (typeof TILE_PERCENTILES)[number];

export function parseTilePercentile(
  raw: string | null | undefined,
): TilePercentile {
  if (!raw) return 'all';
  return (TILE_PERCENTILES as readonly string[]).includes(raw)
    ? (raw as TilePercentile)
    : 'all';
}

// Brake metric. Only the brake layer uses this — close calls don't
// carry an intensity payload.
//
//   count     — number of brake events in the cell. Default.
//   intensity — SUM(peak g × duration) over every brake event in the
//               cell. A unit-of-velocity-change-like proxy that
//               weights firmer / longer brakes more than light taps.

export const INCIDENT_METRICS = ['count', 'intensity'] as const;
export type IncidentMetric = (typeof INCIDENT_METRICS)[number];

export function parseIncidentMetric(
  raw: string | null | undefined,
): IncidentMetric {
  if (!raw) return 'count';
  return (INCIDENT_METRICS as readonly string[]).includes(raw)
    ? (raw as IncidentMetric)
    : 'count';
}

// Per-cell normalization for incident layers (brakes + close calls):
//
//   raw  — the raw sum (count or intensity). Default — "how many" or
//          "how hard" total at this cell.
//   freq — divided by the number of distinct rides that touched the
//          cell. "How often" — a hotspot you ride every day reads
//          differently from a hotspot you've only ridden once.

export const INCIDENT_NORMS = ['raw', 'freq'] as const;
export type IncidentNorm = (typeof INCIDENT_NORMS)[number];

export function parseIncidentNorm(
  raw: string | null | undefined,
): IncidentNorm {
  if (!raw) return 'raw';
  return (INCIDENT_NORMS as readonly string[]).includes(raw)
    ? (raw as IncidentNorm)
    : 'raw';
}

// Per-cell bumpiness aggregation. Only the bumpiness layer uses this
// — brakes and close calls are inherently per-event counts.
//
//   avg     — mean of bumpiness samples in the cell. Default. Stable,
//             but masks the worst hits in a cell that's mostly smooth.
//   median  — middle sample. Resilient to a couple of huge spikes; a
//             cell with one giant pothole on an otherwise calm street
//             still reads "calm".
//   max     — single worst sample. Surfaces those rare big hits even
//             if the cell is mostly smooth.

export const TILE_BUMP_AGGS = ['avg', 'median', 'max'] as const;
export type TileBumpAgg = (typeof TILE_BUMP_AGGS)[number];

export function parseTileBumpAgg(
  raw: string | null | undefined,
): TileBumpAgg {
  if (!raw) return 'avg';
  return (TILE_BUMP_AGGS as readonly string[]).includes(raw)
    ? (raw as TileBumpAgg)
    : 'avg';
}
