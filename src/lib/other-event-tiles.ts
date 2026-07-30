import { OTHER_EVENT_BUILTIN_KINDS } from '@/lib/other-events';

// Shared helpers for the "other events" map layers (public + personal,
// raster cells + individual events). Holds the kind axis and — more
// importantly — the single definition of the public source, so no
// route can accidentally publish a private event.
//
// See bumpy-ride/docs/OTHER_EVENTS_WEB_HANDOFF.md.

// ---------------------------------------------------------------
// The kind axis
// ---------------------------------------------------------------
// Other events are the first layer with a kind dimension (brakes and
// close calls are single-kind). `blocked-lane` is the only built-in
// today, but the registry is append-only and iOS ships new kinds
// without a schemaVersion bump — so every surface takes an optional
// ?kind= and "all built-in kinds" is the default. Adding a kind to
// the registry lights it up everywhere with no route changes.

export const OTHER_EVENT_KIND_ALL = 'all';

// Human labels for the built-in kinds. Registry ids are wire format
// and never renamed; this is the display layer.
export const OTHER_EVENT_KIND_LABELS: Record<string, string> = {
  'blocked-lane': 'Blocked lane',
};

export function otherEventKindLabel(kind: string): string {
  return OTHER_EVENT_KIND_LABELS[kind] ?? kind;
}

/**
 * Kind options for the public map's picker: "All kinds" plus every
 * built-in, derived from the registry so a new kind appears in the UI
 * the moment it's registered. Sorted for a stable control order.
 */
export const PUBLIC_OTHER_EVENT_KIND_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
}> = [
  { id: OTHER_EVENT_KIND_ALL, label: 'All kinds' },
  ...[...OTHER_EVENT_BUILTIN_KINDS]
    .sort()
    .map((k) => ({ id: k, label: otherEventKindLabel(k) })),
];

/**
 * Public kind filter. Returns a registry kind, or null meaning "every
 * built-in kind". Unknown / custom values collapse to null rather than
 * 400 — a stale or probing client gets the default view, and since the
 * SQL below also filters on is_public_eligible, a bogus kind can never
 * widen what's visible.
 */
export function parsePublicOtherEventKind(
  raw: string | null | undefined,
): string | null {
  if (!raw || raw === OTHER_EVENT_KIND_ALL) return null;
  return OTHER_EVENT_BUILTIN_KINDS.has(raw) ? raw : null;
}

/**
 * Personal kind filter. The owner may filter on their own custom
 * labels too, so any bounded string is accepted verbatim (the query
 * is scoped to their user_id regardless). Returns null for "all".
 */
export function parseOwnOtherEventKind(
  raw: string | null | undefined,
): string | null {
  if (!raw || raw === OTHER_EVENT_KIND_ALL) return null;
  return raw.length > 0 && raw.length <= 64 ? raw : null;
}

// ---------------------------------------------------------------
// Source predicates
// ---------------------------------------------------------------

/**
 * The public-visibility predicate for other_events, as a SQL fragment
 * on alias `oe`. `kindParam` is the placeholder of a bound TEXT
 * parameter ('$5', …) carrying the kind or NULL for all built-ins.
 *
 * `is_public_eligible` is the ONLY flag a public surface may filter
 * on — never `kind` or `is_custom` directly. It's computed at ingest
 * as (registry membership ∧ NOT isCustom), so:
 *   - a rider's custom label is never published, and
 *   - registry skew (a built-in from a newer iOS than this server)
 *     degrades toward privacy instead of publishing an unvetted kind.
 * Keeping the predicate here — rather than inline in each route —
 * means a new public surface can't forget it. The kind filter can
 * only ever narrow this; it is never the thing keeping data private.
 */
export function publicOtherEventsPredicate(kindParam: string): string {
  return `oe.is_public_eligible = TRUE
      AND (${kindParam}::text IS NULL OR oe.kind = ${kindParam})`;
}

/**
 * The owner's own view: every event they logged, custom labels
 * included. "Owner-only forever" means the owner does see them — the
 * restriction is against cross-account exposure, not against showing
 * riders their own data on their own map. Callers must scope the
 * query to the owner's user_id themselves.
 */
export function ownOtherEventsPredicate(kindParam: string): string {
  return `(${kindParam}::text IS NULL OR oe.kind = ${kindParam})`;
}
