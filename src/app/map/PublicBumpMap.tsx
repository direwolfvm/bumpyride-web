'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyleForCurrentTheme } from '@/lib/map-style';
import {
  TILE_BUMP_AGGS,
  TILE_MODES,
  TILE_PERCENTILES,
  type TileBumpAgg,
  type TileMode,
  type TilePercentile,
} from '@/lib/tile-mode';

type LayerId = 'bumps' | 'brakes' | 'close-calls';

const LAYERS: ReadonlyArray<{
  id: LayerId;
  label: string;
  tilesBase: string;
  attribution: string;
}> = [
  {
    id: 'bumps',
    label: 'Bumpiness',
    tilesBase: '/api/tiles/public/{z}/{x}/{y}',
    attribution: 'Bump data: consenting BumpyRide users',
  },
  {
    id: 'brakes',
    label: 'Hard brakes',
    tilesBase: '/api/tiles/public/brakes/{z}/{x}/{y}',
    attribution: 'Brake data: consenting BumpyRide users',
  },
  {
    id: 'close-calls',
    label: 'Close calls',
    tilesBase: '/api/tiles/public/close-calls/{z}/{x}/{y}',
    attribution: 'Close-call data: consenting BumpyRide users',
  },
];

const MODE_LABELS: Record<TileMode, string> = {
  all: 'All data',
  '3mo': 'Last 3 months',
  last10: 'Last 10 observations',
};

const MODE_DESCRIPTIONS: Record<TileMode, string> = {
  all: 'Lifetime aggregate. Stable, slow-moving signal.',
  '3mo':
    'Only data from the last three months. Pavement that recently got patched (or worse) shows up sooner.',
  last10:
    "Only the ten most recent observations per cell. Best read of what each cell looks like *today*.",
};

const PERCENTILE_LABELS: Record<TilePercentile, string> = {
  all: 'All cells',
  top10: 'Best 10%',
  bottom10: 'Worst 10%',
};

const PERCENTILE_DESCRIPTIONS: Record<TilePercentile, string> = {
  all: 'Render every cell that passes the privacy gate.',
  top10:
    'Only the smoothest (lowest bumpiness) or least-active (lowest incident count) 10% of cells across the whole dataset. The on-the-ground "good news" view.',
  bottom10:
    'Only the roughest (highest bumpiness) or most-active (highest incident count) 10% of cells across the whole dataset. The hotspots view.',
};

const BUMP_AGG_LABELS: Record<TileBumpAgg, string> = {
  avg: 'Average',
  median: 'Median',
  max: 'Max',
};

const BUMP_AGG_DESCRIPTIONS: Record<TileBumpAgg, string> = {
  avg: 'Mean bumpiness across all samples in each cell. Default. Stable signal that downweights one-off spikes.',
  median:
    'Middle sample per cell. Resilient to a few huge hits — one giant pothole on an otherwise smooth street stays "smooth".',
  max: 'Worst single sample per cell. Surfaces those rare large hits even where the cell is mostly calm.',
};

function tileUrlFor(
  base: string,
  mode: TileMode,
  percentile: TilePercentile,
  agg: TileBumpAgg,
  isBumps: boolean,
): string {
  const params: string[] = [];
  if (mode !== 'all') params.push(`mode=${mode}`);
  if (percentile !== 'all') params.push(`percentile=${percentile}`);
  // agg only applies to the bumps layer; don't bake it into brake /
  // close-call URLs (those routes don't read it, but skipping the
  // param keeps the URL clean and the tile cache stable for incidents
  // when the user flips agg).
  if (isBumps && agg !== 'avg') params.push(`agg=${agg}`);
  return params.length === 0 ? base : `${base}?${params.join('&')}`;
}

export function PublicBumpMap({
  minLat,
  maxLat,
  minLon,
  maxLon,
}: {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [active, setActive] = useState<LayerId>('bumps');
  const [mode, setMode] = useState<TileMode>('all');
  const [percentile, setPercentile] = useState<TilePercentile>('all');
  const [bumpAgg, setBumpAgg] = useState<TileBumpAgg>('avg');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const map = new maplibregl.Map({
      container: el,
      style: basemapStyleForCurrentTheme(),
      bounds: [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      fitBoundsOptions: { padding: 40, maxZoom: 15 },
    });
    mapRef.current = map;

    map.on('load', () => {
      for (const l of LAYERS) {
        map.addSource(l.id, {
          type: 'raster',
          tiles: [tileUrlFor(l.tilesBase, mode, percentile, bumpAgg, l.id === 'bumps')],
          tileSize: 256,
          attribution: l.attribution,
        });
        map.addLayer({
          id: l.id,
          type: 'raster',
          source: l.id,
          layout: {
            visibility: l.id === 'bumps' ? 'visible' : 'none',
          },
        });
      }
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
    // We intentionally exclude `mode` here — the initial mode is baked
    // in once at map mount, and subsequent changes are pushed via
    // setTiles in the next effect. Re-creating the entire map on every
    // mode flip would wipe the user's pan/zoom state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minLat, maxLat, minLon, maxLon]);

  // Layer-tab visibility toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const l of LAYERS) {
        if (!map.getLayer(l.id)) continue;
        map.setLayoutProperty(
          l.id,
          'visibility',
          l.id === active ? 'visible' : 'none',
        );
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [active]);

  // Mode + percentile + agg toggle. setTiles on each raster source
  // replaces the URL template and invalidates the source's tile cache,
  // so the visible layer refetches immediately and the hidden ones
  // refetch lazily when they're next shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const l of LAYERS) {
        const src = map.getSource(l.id);
        if (!src || src.type !== 'raster') continue;
        // setTiles exists on RasterTileSource in maplibre-gl 5.x.
        (src as maplibregl.RasterTileSource).setTiles([
          tileUrlFor(l.tilesBase, mode, percentile, bumpAgg, l.id === 'bumps'),
        ]);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [mode, percentile, bumpAgg]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          role="tablist"
          aria-label="Map layer"
          className="inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface"
        >
          {LAYERS.map((l) => {
            const isActive = active === l.id;
            return (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(l.id)}
                className={`px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-accent-strong text-white'
                    : 'text-text-muted hover:bg-bg hover:text-text'
                }`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
        <div
          role="tablist"
          aria-label="View mode"
          className="inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface"
        >
          {TILE_MODES.map((m) => {
            const isActive = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setMode(m)}
                title={MODE_DESCRIPTIONS[m]}
                className={`px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-accent-strong text-white'
                    : 'text-text-muted hover:bg-bg hover:text-text'
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            );
          })}
        </div>
        <div
          role="tablist"
          aria-label="Percentile"
          className="inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface"
        >
          {TILE_PERCENTILES.map((p) => {
            const isActive = percentile === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setPercentile(p)}
                title={PERCENTILE_DESCRIPTIONS[p]}
                className={`px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-accent-strong text-white'
                    : 'text-text-muted hover:bg-bg hover:text-text'
                }`}
              >
                {PERCENTILE_LABELS[p]}
              </button>
            );
          })}
        </div>
        {active === 'bumps' && (
          <div
            role="tablist"
            aria-label="Aggregation"
            className="inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface"
          >
            {TILE_BUMP_AGGS.map((a) => {
              const isActive = bumpAgg === a;
              return (
                <button
                  key={a}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setBumpAgg(a)}
                  title={BUMP_AGG_DESCRIPTIONS[a]}
                  className={`px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-accent-strong text-white'
                      : 'text-text-muted hover:bg-bg hover:text-text'
                  }`}
                >
                  {BUMP_AGG_LABELS[a]}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="mb-3 text-xs text-text-muted">
        {active === 'bumps' && bumpAgg !== 'avg'
          ? BUMP_AGG_DESCRIPTIONS[bumpAgg]
          : percentile === 'all'
            ? MODE_DESCRIPTIONS[mode]
            : PERCENTILE_DESCRIPTIONS[percentile]}
      </p>
      <div
        ref={containerRef}
        className="h-[640px] w-full overflow-hidden rounded-lg border border-border"
      />
    </div>
  );
}
