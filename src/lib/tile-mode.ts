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
