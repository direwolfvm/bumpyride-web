import { count, max, min, sql } from 'drizzle-orm';
import { db } from '@/db';
import { bumpCells } from '@/db/schema';
import { ExportControls } from '@/components/ExportControls';
import { PublicBumpMap } from './PublicBumpMap';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';

export const dynamic = 'force-dynamic';

const MIN_PUBLIC_CELL_USERS = Math.max(
  1,
  Number.parseInt(
    process.env.PUBLIC_BUMPMAP_MIN_USERS ??
      process.env.PUBLIC_BUMPMAP_MIN_COUNT ??
      '3',
    10,
  ) || 3,
);

export default async function PublicMapPage() {
  // bump_cells is the broadest of the three datasets (every sample, not
  // just incidents), so it's the right source for the initial viewport.
  // Brake and close-call layers share the same grid math; their data
  // is a subset of locations users have ridden through.
  const [bbox] = await db
    .select({
      minIx: min(bumpCells.ix),
      maxIx: max(bumpCells.ix),
      minIy: min(bumpCells.iy),
      maxIy: max(bumpCells.iy),
      cellsAboveThreshold: count(),
    })
    .from(bumpCells)
    .where(sql`${bumpCells.count} >= ${MIN_PUBLIC_CELL_USERS}`);

  const hasData =
    bbox &&
    bbox.minIx !== null &&
    bbox.maxIx !== null &&
    bbox.minIy !== null &&
    bbox.maxIy !== null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Public map
        </h1>
        {hasData && (
          <ExportControls
            endpoint="/api/public-map/export"
            kindHelp={{
              raw: 'Per-cell aggregates only. Bumpiness sum + count per cell, brake counts per cell, close-call counts per cell. Per-event records are deliberately omitted — they would compromise the 3-distinct-rider privacy gate.',
              display: 'Same per-cell numbers, plus average bumpiness and the rendered color bin (yellow → purple) so consumers can reproduce the on-screen color.',
            }}
          />
        )}
      </div>

      <div className="mt-4">
        {hasData ? (
          <PublicBumpMap
            minLat={bbox!.minIy! * CELL_LAT_DEG}
            maxLat={(bbox!.maxIy! + 1) * CELL_LAT_DEG}
            minLon={bbox!.minIx! * CELL_LON_DEG}
            maxLon={(bbox!.maxIx! + 1) * CELL_LON_DEG}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center text-text-muted">
            No public map data yet. Riders are opting in but no 20 ft cell
            has accumulated enough samples to publish. Check back as coverage
            grows.
          </div>
        )}
      </div>

      {/* Descriptive content moved below the map: new visitors see the
          data immediately, but the legend is still available for anyone
          who scrolls down. */}
      <section className="mt-8 max-w-3xl space-y-4 text-text-muted">
        <p>
          Three views of the same 20 ft cell grid, aggregated across every
          rider who&apos;s opted in to public sharing — mounted-sensor data
          only. Switch layers with the first tab strip; switch time windows
          with the second.
        </p>

        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-text">
            Layers
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              <strong className="text-text">Bumpiness</strong> — average
              pavement roughness in g. Continuous heat field colored green
              → purple.
            </li>
            <li>
              <strong className="text-text">Hard brakes</strong> — count of
              iOS-detected braking incidents per cell, colored yellow →
              purple by frequency.
            </li>
            <li>
              <strong className="text-text">Close calls</strong> — count of
              rider-tapped near-miss markers per cell.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-text">
            Time windows
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              <strong className="text-text">All data</strong> — the
              lifetime aggregate. Stable, slow-moving signal.
            </li>
            <li>
              <strong className="text-text">Last 3 months</strong> — only
              data recorded in the last three calendar months. Surfaces
              newly-patched (or newly-worn) pavement and recent incident
              hotspots.
            </li>
            <li>
              <strong className="text-text">Last 10 observations</strong>{' '}
              — only the ten most recent samples per cell, regardless of
              when they were recorded. Best read on what each cell looks
              like right now.
            </li>
          </ul>
        </div>

        <p>
          A cell only appears once at least {MIN_PUBLIC_CELL_USERS} distinct
          riders have contributed to it — so a single rider can&apos;t
          accidentally publish a route by toggling sharing on. Pocket-mode
          rides are excluded; legacy rides predating the mode tag are
          treated as mounted, matching the iOS Bump Map&apos;s default
          filter. No timestamps, no routes, no per-user attribution.
        </p>
      </section>

      <p className="mt-6 text-xs text-text-dim">
        Basemap © OpenStreetMap contributors © CARTO · Data © consenting
        BumpyRide users
      </p>
    </div>
  );
}
