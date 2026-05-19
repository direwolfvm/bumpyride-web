import { formatDuration } from '@/lib/formatters';

export type BrakeEventDisplay = {
  id: string;
  tSec: number;
  peakG: number;
  peakMps2: number;
  durationSeconds: number;
};

// Three states (see iOS handoff doc):
//   processed=false                 -> detector hasn't run yet
//   processed=true, events.length=0 -> ran, no hard brakes
//   processed=true, events.length>0 -> the list
export function BrakeEventsSection({
  processed,
  events,
}: {
  processed: boolean;
  events: BrakeEventDisplay[];
}) {
  if (!processed) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-text-muted">
        Brake detection is still pending for this ride. The iOS app
        reprocesses rides in the background — check back after your
        next sync.
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-text-muted">
        No hard brakes detected on this ride.
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
              className="inline-block h-2.5 w-2.5 rounded-full bg-danger"
            />
            <span className="font-mono text-sm tabular-nums text-text-muted">
              {formatDuration(Math.max(0, e.tSec))} in
            </span>
          </div>
          <div className="flex items-baseline gap-4 text-sm tabular-nums">
            <span>
              <strong>{e.peakG.toFixed(2)} g</strong>
              <span className="ml-1 text-text-muted">
                ({e.peakMps2.toFixed(1)} m/s²)
              </span>
            </span>
            <span className="text-text-muted">
              {e.durationSeconds.toFixed(1)} s
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
