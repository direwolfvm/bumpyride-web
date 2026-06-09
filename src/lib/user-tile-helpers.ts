// Per-user tile helpers. Shared between the bumpiness, brakes, and
// close-calls personal tile routes so the rides-filter and time-
// window plumbing stays consistent across all three.

export const RIDES_FILTERS = ['mounted', 'pocket', 'all'] as const;
export type RidesFilter = (typeof RIDES_FILTERS)[number];

// Three-option filter mirroring the iOS Bump Map's segmented control:
//   mounted (default): pocket_mode IS DISTINCT FROM TRUE (mounted + legacy null)
//   pocket:            pocket_mode = TRUE
//   all:               every ride regardless of mode
//
// Default is `mounted` — matches iOS. Legacy rides whose mode wasn't
// captured bucket with mounted (early users almost universally had
// handlebar mounts).
export function parseRidesFilter(raw: string | null | undefined): RidesFilter {
  if (!raw) return 'mounted';
  return (RIDES_FILTERS as readonly string[]).includes(raw)
    ? (raw as RidesFilter)
    : 'mounted';
}

export function ridesFilterSql(rides: RidesFilter): string {
  if (rides === 'all') return '';
  if (rides === 'pocket') return 'AND r.pocket_mode = TRUE';
  // mounted (default)
  return 'AND r.pocket_mode IS DISTINCT FROM TRUE';
}
