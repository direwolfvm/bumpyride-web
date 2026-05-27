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
