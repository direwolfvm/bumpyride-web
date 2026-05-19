import { formatDuration } from '@/lib/formatters';

export type CloseCallDisplay = {
  id: string;
  tSec: number;
};

// Three states (see CLOSE_CALLS_WEB_HANDOFF.md):
//   supported=false             -> ride predates the feature (pre-v1.3)
//   supported=true, length === 0 -> feature available, user didn't tap
//   supported=true, length  > 0  -> the close calls themselves
export function CloseCallsSection({
  supported,
  events,
}: {
  supported: boolean;
  events: CloseCallDisplay[];
}) {
  if (!supported) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-text-muted">
        This ride predates close-call reporting. Tap{' '}
        <span className="font-medium">Log Close Call</span> while riding
        in iOS v1.3+ to flag near-misses.
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-text-muted">
        No close calls logged on this ride.
      </div>
    );
  }

  return (
    <ol className="overflow-hidden rounded-lg border border-border bg-surface">
      {events.map((e) => (
        <li
          key={e.id}
          className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
        >
          <div className="flex items-baseline gap-3">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rotate-45"
              style={{ backgroundColor: '#8C40D9' }}
            />
            <span className="font-mono text-sm tabular-nums text-text-muted">
              {formatDuration(Math.max(0, e.tSec))} in
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
