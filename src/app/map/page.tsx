import { count, max, min, sql } from 'drizzle-orm';
import { db } from '@/db';
import { bumpCells } from '@/db/schema';
import { PublicBumpMap } from './PublicBumpMap';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';

export const dynamic = 'force-dynamic';

const MIN_PUBLIC_CELL_COUNT = Math.max(
  1,
  Number.parseInt(process.env.PUBLIC_BUMPMAP_MIN_COUNT ?? '3', 10) || 3,
);

export default async function PublicMapPage() {
  const [bbox] = await db
    .select({
      minIx: min(bumpCells.ix),
      maxIx: max(bumpCells.ix),
      minIy: min(bumpCells.iy),
      maxIy: max(bumpCells.iy),
      cellsAboveThreshold: count(),
    })
    .from(bumpCells)
    .where(sql`${bumpCells.count} >= ${MIN_PUBLIC_CELL_COUNT}`);

  const hasData =
    bbox &&
    bbox.minIx !== null &&
    bbox.maxIx !== null &&
    bbox.minIy !== null &&
    bbox.maxIy !== null;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Bump map
      </h1>
      <p className="mt-2 max-w-3xl text-text-muted">
        Average pavement roughness aggregated across every rider who&apos;s
        opted in to public sharing — calibrated mounted-sensor data only.
        Pocket-mode rides are excluded so the readings here aren&apos;t damped
        by phone-on-body cushioning. Cells are 20 ft squares; we only show a
        cell once it has at least {MIN_PUBLIC_CELL_COUNT} samples, so a single
        rider can&apos;t accidentally publish a route by toggling sharing on.
        No timestamps, no routes, no per-user attribution.
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
            No public bump-map data yet. Riders are opting in but no 20 ft cell
            has accumulated enough samples to publish. Check back as coverage
            grows.
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-text-dim">
        Basemap © OpenStreetMap contributors © CARTO · Bump data ©
        consenting BumpyRide users
      </p>
    </div>
  );
}
