// "Other events" built-in kind registry + privacy helpers.
// Mirror of `OtherEvent.builtinKinds` in the iOS app; see
// bumpy-ride/docs/OTHER_EVENTS_WEB_HANDOFF.md.
//
// Append-only. Identifiers are wire format and are never renamed.

export const OTHER_EVENT_BUILTIN_KINDS: ReadonlySet<string> = new Set([
  'blocked-lane', // Blocked Lane — iOS v2.0
]);

// Server-side mirror of the iOS caps (enforced at ingest).
export const OTHER_EVENT_KIND_MAX_CHARS = 40;
export const OTHER_EVENT_MAX_CUSTOM_KINDS_PER_ACCOUNT = 20;

/**
 * Whether an event may ever appear on a public / cross-account
 * surface. TRUE only when the client marked it built-in AND we
 * recognise the kind. A client that knows a newer registry than us
 * sends isCustom=false with an unknown kind — that skew degrades
 * toward privacy (not eligible) rather than publishing unvetted
 * kinds into public tiles.
 *
 * Note this is a ROUTING decision, computed and stored at ingest
 * (other_events.is_public_eligible). The wire `isCustom` value is
 * stored verbatim and round-trips untouched so an iOS restore gets
 * back exactly what it uploaded.
 */
export function isPublicEligible(kind: string, isCustom: boolean): boolean {
  return !isCustom && OTHER_EVENT_BUILTIN_KINDS.has(kind);
}
