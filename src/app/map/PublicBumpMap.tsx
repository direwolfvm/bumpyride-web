'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyleForCurrentTheme } from '@/lib/map-style';
import { TILE_MODES, type TileMode } from '@/lib/tile-mode';

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

function tileUrlFor(base: string, mode: TileMode): string {
  // Default mode lives on the base URL without a query string so any
  // edge cache key we might add stays clean for the most common case.
  return mode === 'all' ? base : `${base}?mode=${mode}`;
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
          tiles: [tileUrlFor(l.tilesBase, mode)],
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

  // Mode toggle. setTiles on each raster source replaces the URL
  // template and invalidates the source's tile cache, so the visible
  // layer refetches immediately and the hidden ones refetch lazily
  // when they're next shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const l of LAYERS) {
        const src = map.getSource(l.id);
        if (!src || src.type !== 'raster') continue;
        // setTiles exists on RasterTileSource in maplibre-gl 5.x.
        (src as maplibregl.RasterTileSource).setTiles([
          tileUrlFor(l.tilesBase, mode),
        ]);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [mode]);

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
      </div>
      <p className="mb-3 text-xs text-text-muted">{MODE_DESCRIPTIONS[mode]}</p>
      <div
        ref={containerRef}
        className="h-[640px] w-full overflow-hidden rounded-lg border border-border"
      />
    </div>
  );
}
