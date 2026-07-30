import { formatDuration } from '@/lib/formatters';
import { otherEventKindLabel } from '@/lib/other-event-tiles';

export type OtherEventDisplay = {
  id: string;
  tSec: number;
  kind: string;
  // The wire value the client sent, stored verbatim.
  isCustom: boolean;
  // The server's routing decision (registry kind AND not custom).
  // This — not `isCustom` — is what actually governs whether the
  // event can reach a public surface, so it's what the badge reflects.
  isPublicEligible: boolean;
};

// Three states, mirroring the close-calls section:
//   supported=false              -> ride predates the feature (pre-v2.0)
//   supported=true, length === 0 -> feature available, nothing logged
//   supported=true, length  > 0  -> the events themselves
export function OtherEventsSection({
  supported,
  events,
}: {
  supported: boolean;
  events: OtherEventDisplay[];
}) {
  if (!supported) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-text-muted">
        This ride predates event logging. Tap{' '}
        <span className="font-medium">Log Event</span> while riding in iOS
        v2.0+ to mark blocked lanes and anything else worth remembering.
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-text-muted">
        No events logged on this ride.
      </div>
    );
  }

  const anyPrivate = events.some((e) => !e.isPublicEligible);

  return (
    <>
      <ol className="overflow-hidden rounded-lg border border-border bg-surface">
        {events.map((e) => (
          <li
            key={e.id}
            className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            <div className="flex items-baseline gap-3">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: OTHER_EVENT_COLOR }}
              />
              <span className="font-mono text-sm tabular-nums text-text-muted">
                {formatDuration(Math.max(0, e.tSec))} in
              </span>
            </div>
            <div className="flex items-baseline gap-3 text-sm">
              <span className="font-medium">{otherEventKindLabel(e.kind)}</span>
              {!e.isPublicEligible && (
                <span
                  className="rounded border border-border-strong px-1.5 py-0.5 text-xs text-text-muted"
                  title={
                    e.isCustom
                      ? 'Your own label — kept to your account and never shown on the public map.'
                      : 'Not one of the event types this server publishes, so it stays private.'
                  }
                >
                  private
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {anyPrivate && (
        <p className="mt-2 text-xs text-text-dim">
          Events marked <span className="text-text-muted">private</span> stay on
          your account — they appear on your own bump map but never on the
          public one, even with sharing turned on.
        </p>
      )}
    </>
  );
}

// Matches the "Event reports" marker color on the public and personal
// bump maps so the same data reads the same everywhere.
const OTHER_EVENT_COLOR = '#22d3ee';
