import { count, max, min, sql } from 'drizzle-orm';
import { db } from '@/db';
import { bumpCells } from '@/db/schema';
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
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Public map
      </h1>
      <p className="mt-2 max-w-3xl text-text-muted">
        Three views of the same 20 ft cell grid, aggregated across every rider
        who&apos;s opted in to public sharing — mounted-sensor data only.
        Switch layers with the tabs below.
      </p>
      <ul className="mt-3 max-w-3xl space-y-1 text-sm text-text-muted">
        <li>
          <strong>Bumpiness</strong> — average pavement roughness in g.
          Continuous heat field colored green → purple.
        </li>
        <li>
          <strong>Hard brakes</strong> — count of iOS-detected braking
          incidents per cell, colored yellow → purple by frequency.
        </li>
        <li>
          <strong>Close calls</strong> — count of rider-tapped near-miss
          markers per cell.
        </li>
      </ul>
      <p className="mt-3 max-w-3xl text-text-muted">
        A cell only appears once at least {MIN_PUBLIC_CELL_USERS} distinct
        riders have contributed to it — so a single rider can&apos;t
        accidentally publish a route by toggling sharing on. Pocket-mode
        rides are excluded; legacy rides predating the mode tag are treated
        as mounted, matching the iOS Bump Map&apos;s default filter. No
        timestamps, no routes, no per-user attribution.
      </p>

      <div className="mt-6">
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

      <p className="mt-4 text-xs text-text-dim">
        Basemap © OpenStreetMap contributors © CARTO · Data © consenting
        BumpyRide users
      </p>
    </div>
  );
}
