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
  // Bounding box of currently-publishable cells, so the map opens centred
  // on real data. Cells below the public threshold are excluded — the map
  // shouldn't auto-fit to data that won't render.
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
    <div style={{ maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Bump map</h1>
      <p style={{ color: '#9a9aac' }}>
        Average pavement roughness aggregated across every rider who&apos;s
        opted in to public sharing. Cells are 20 ft squares; we only show a
        cell once it has at least {MIN_PUBLIC_CELL_COUNT} samples, so a
        single rider can&apos;t accidentally publish a route by toggling
        sharing on. No timestamps, no routes, no per-user attribution.
      </p>
      {hasData ? (
        <PublicBumpMap
          minLat={bbox!.minIy! * CELL_LAT_DEG}
          maxLat={(bbox!.maxIy! + 1) * CELL_LAT_DEG}
          minLon={bbox!.minIx! * CELL_LON_DEG}
          maxLon={(bbox!.maxIx! + 1) * CELL_LON_DEG}
        />
      ) : (
        <PublicBumpMapEmpty />
      )}
      <p style={{ color: '#9a9aac', fontSize: 13, marginTop: '1rem' }}>
        Basemap © OpenStreetMap contributors © CARTO. Bump data ©{' '}
        consenting BumpyRide users.
      </p>
    </div>
  );
}

function PublicBumpMapEmpty() {
  return (
    <div
      style={{
        padding: '2rem',
        border: '1px solid #22222c',
        borderRadius: 6,
        background: '#101019',
        color: '#9a9aac',
      }}
    >
      No public bump-map data yet. Riders are opting in but no 20 ft cell has
      accumulated enough samples to publish. Check back as coverage grows.
    </div>
  );
}
