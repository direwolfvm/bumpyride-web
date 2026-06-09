'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyleForCurrentTheme } from '@/lib/map-style';
import {
  INCIDENT_METRICS,
  INCIDENT_NORMS,
  TILE_BUMP_AGGS,
  TILE_MODES,
  TILE_PERCENTILES,
  type IncidentMetric,
  type IncidentNorm,
  type TileBumpAgg,
  type TileMode,
  type TilePercentile,
} from '@/lib/tile-mode';

// Personal bump map. Three layers (bumpiness / brakes / close-calls)
// share the same map; switching is a layer-visibility flip and a
// URL-template rebind, identical to the public map at /map.
//
// Two filter axes mirror the public map (time window, percentile)
// plus one personal-only axis (rides filter — mounted/pocket/all)
// that the public map can't expose because it would leak ride mode
// onto a public aggregate.

type LayerId = 'bumps' | 'brakes' | 'close-calls';
type RidesFilter = 'mounted' | 'pocket' | 'all';

const LAYERS: ReadonlyArray<{
  id: LayerId;
  label: string;
  tilesBase: string;
  attribution: string;
}> = [
  {
    id: 'bumps',
    label: 'Bumpiness',
    tilesBase: '/api/tiles/user/{z}/{x}/{y}',
    attribution: 'Your bump data',
  },
  {
    id: 'brakes',
    label: 'Hard brakes',
    tilesBase: '/api/tiles/user/brakes/{z}/{x}/{y}',
    attribution: 'Your brake events',
  },
  {
    id: 'close-calls',
    label: 'Close calls',
    tilesBase: '/api/tiles/user/close-calls/{z}/{x}/{y}',
    attribution: 'Your close calls',
  },
];

const RIDES_LABELS: Record<RidesFilter, string> = {
  all: 'All',
  mounted: 'Mounted',
  pocket: 'Pocket',
};
const RIDES_HELP: Record<RidesFilter, string> = {
  all: 'Every ride you’ve synced regardless of how the phone was carried.',
  mounted:
    'Rides where the phone was on a bike mount (plus legacy rides recorded before the mode tag existed). Default — matches the iOS Bump Map.',
  pocket: 'Rides where the phone was in your pocket / pack / on-body.',
};

const MODE_LABELS: Record<TileMode, string> = {
  all: 'All data',
  '3mo': 'Last 3 months',
  last10: 'Last 10 observations',
};
const MODE_HELP: Record<TileMode, string> = {
  all: 'Lifetime aggregate. Stable, slow-moving signal.',
  '3mo':
    'Only data from the last three months. Recently-patched pavement (or newly-worn) shows up sooner.',
  last10:
    'Only the ten most recent observations per cell. Best read on what each cell looks like right now.',
};

const PERCENTILE_LABELS: Record<TilePercentile, string> = {
  all: 'All cells',
  top10: 'Best 10%',
  bottom10: 'Worst 10%',
};
const PERCENTILE_HELP: Record<TilePercentile, string> = {
  all: 'Every cell you’ve mapped.',
  top10:
    'Only the smoothest 10% of bumpiness cells, or the least-incident 10% of brake / close-call cells, against your own dataset.',
  bottom10:
    'Only the roughest 10% of bumpiness cells, or the highest-count 10% of brake / close-call cells.',
};

const BUMP_AGG_LABELS: Record<TileBumpAgg, string> = {
  avg: 'Average',
  median: 'Median',
  max: 'Max',
};
const BUMP_AGG_HELP: Record<TileBumpAgg, string> = {
  avg: 'Mean bumpiness across the samples in each cell. Default.',
  median:
    'Middle sample per cell — resilient to one-off spikes. A cell with a single huge pothole on otherwise smooth pavement still reads "smooth".',
  max: 'Worst single sample per cell. Surfaces those rare big hits even where the cell is mostly calm.',
};

const INCIDENT_METRIC_LABELS: Record<IncidentMetric, string> = {
  count: 'Count',
  intensity: 'Intensity',
};
const INCIDENT_METRIC_HELP: Record<IncidentMetric, string> = {
  count: 'Number of brake events in the cell. Default.',
  intensity:
    'Sum of (peak g × duration) over every brake event in the cell. Weights firmer / longer brakes more than light taps.',
};

const INCIDENT_NORM_LABELS: Record<IncidentNorm, string> = {
  raw: 'Raw sum',
  freq: 'Frequency',
};
const INCIDENT_NORM_HELP: Record<IncidentNorm, string> = {
  raw: 'The raw value for the cell — total events or total intensity. Default.',
  freq:
    'Divided by the number of distinct rides that touched the cell. Normalizes for "how often I ride here" — a hotspot you ride every day reads differently from a hotspot you’ve only ridden once.',
};

// localStorage keys. Migrated from the old `bumpmap.mode` key
// (which used to hold mounted|pocket|all — now the rides axis).
const STORE_RIDES = 'bumpmap.rides';
const STORE_LEGACY = 'bumpmap.mode';

function readStoredRides(): RidesFilter {
  try {
    const v = localStorage.getItem(STORE_RIDES) ?? localStorage.getItem(STORE_LEGACY);
    if (v === 'all' || v === 'mounted' || v === 'pocket') return v;
  } catch {}
  return 'mounted';
}

function tileUrlFor(
  layerId: LayerId,
  base: string,
  rides: RidesFilter,
  mode: TileMode,
  percentile: TilePercentile,
  agg: TileBumpAgg,
  metric: IncidentMetric,
  norm: IncidentNorm,
): string {
  const params: string[] = [`rides=${rides}`];
  if (mode !== 'all') params.push(`mode=${mode}`);
  if (percentile !== 'all') params.push(`percentile=${percentile}`);
  // Each layer only consumes the URL params relevant to it. Skipping
  // the others keeps the tile cache stable when the user flips a
  // toggle that doesn't apply to the currently-rendered layer (e.g.
  // flipping metric while looking at bumps shouldn't re-fetch tiles).
  if (layerId === 'bumps' && agg !== 'avg') params.push(`agg=${agg}`);
  if (layerId === 'brakes' && metric !== 'count') params.push(`metric=${metric}`);
  if ((layerId === 'brakes' || layerId === 'close-calls') && norm !== 'raw') {
    params.push(`norm=${norm}`);
  }
  return `${base}?${params.join('&')}`;
}

export function PrivateBumpMap({
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
  const [rides, setRides] = useState<RidesFilter>('mounted');
  const [mode, setMode] = useState<TileMode>('all');
  const [percentile, setPercentile] = useState<TilePercentile>('all');
  const [bumpAgg, setBumpAgg] = useState<TileBumpAgg>('avg');
  const [metric, setMetric] = useState<IncidentMetric>('count');
  const [norm, setNorm] = useState<IncidentNorm>('raw');

  // SSR-safe rides hydration on mount.
  useEffect(() => {
    setRides(readStoredRides());
  }, []);

  // Persist rides changes (the other axes are transient).
  function selectRides(next: RidesFilter) {
    setRides(next);
    try {
      localStorage.setItem(STORE_RIDES, next);
      // Don't bother clearing the old key — readStoredRides falls
      // back to it gracefully and a write to the new key wins on
      // next read.
    } catch {}
  }

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
          tiles: [tileUrlFor(l.id, l.tilesBase, rides, mode, percentile, bumpAgg, metric, norm)],
          tileSize: 256,
          attribution: l.attribution,
        });
        map.addLayer({
          id: l.id,
          type: 'raster',
          source: l.id,
          layout: { visibility: l.id === 'bumps' ? 'visible' : 'none' },
        });
      }
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
    // Initial URL is baked in once; subsequent param changes are
    // pushed via setTiles below to preserve pan/zoom.
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

  // Rides / mode / percentile / agg changes → retile every layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const l of LAYERS) {
        const src = map.getSource(l.id);
        if (!src || src.type !== 'raster') continue;
        (src as maplibregl.RasterTileSource).setTiles([
          tileUrlFor(l.id, l.tilesBase, rides, mode, percentile, bumpAgg, metric, norm),
        ]);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [rides, mode, percentile, bumpAgg, metric, norm]);

  // Live caption beneath the tab strips. Layer-specific axes win
  // (agg for bumps; metric/norm for incidents); then the global
  // axes (percentile > mode > rides).
  const caption =
    active === 'bumps' && bumpAgg !== 'avg'
      ? BUMP_AGG_HELP[bumpAgg]
      : active === 'brakes' && metric !== 'count'
        ? INCIDENT_METRIC_HELP[metric]
        : (active === 'brakes' || active === 'close-calls') && norm !== 'raw'
          ? INCIDENT_NORM_HELP[norm]
          : percentile !== 'all'
            ? PERCENTILE_HELP[percentile]
            : mode !== 'all'
              ? MODE_HELP[mode]
              : RIDES_HELP[rides];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <TabStrip
          ariaLabel="Map layer"
          values={LAYERS.map((l) => ({ id: l.id, label: l.label, help: '' }))}
          current={active}
          onChange={(v) => setActive(v as LayerId)}
        />
        <TabStrip
          ariaLabel="Rides"
          values={(['mounted', 'pocket', 'all'] as RidesFilter[]).map((r) => ({
            id: r,
            label: RIDES_LABELS[r],
            help: RIDES_HELP[r],
          }))}
          current={rides}
          onChange={(v) => selectRides(v as RidesFilter)}
        />
        <TabStrip
          ariaLabel="View mode"
          values={TILE_MODES.map((m) => ({
            id: m,
            label: MODE_LABELS[m],
            help: MODE_HELP[m],
          }))}
          current={mode}
          onChange={(v) => setMode(v as TileMode)}
        />
        <TabStrip
          ariaLabel="Percentile"
          values={TILE_PERCENTILES.map((p) => ({
            id: p,
            label: PERCENTILE_LABELS[p],
            help: PERCENTILE_HELP[p],
          }))}
          current={percentile}
          onChange={(v) => setPercentile(v as TilePercentile)}
        />
        {active === 'bumps' && (
          <TabStrip
            ariaLabel="Aggregation"
            values={TILE_BUMP_AGGS.map((a) => ({
              id: a,
              label: BUMP_AGG_LABELS[a],
              help: BUMP_AGG_HELP[a],
            }))}
            current={bumpAgg}
            onChange={(v) => setBumpAgg(v as TileBumpAgg)}
          />
        )}
        {active === 'brakes' && (
          <TabStrip
            ariaLabel="Metric"
            values={INCIDENT_METRICS.map((m) => ({
              id: m,
              label: INCIDENT_METRIC_LABELS[m],
              help: INCIDENT_METRIC_HELP[m],
            }))}
            current={metric}
            onChange={(v) => setMetric(v as IncidentMetric)}
          />
        )}
        {(active === 'brakes' || active === 'close-calls') && (
          <TabStrip
            ariaLabel="Normalization"
            values={INCIDENT_NORMS.map((n) => ({
              id: n,
              label: INCIDENT_NORM_LABELS[n],
              help: INCIDENT_NORM_HELP[n],
            }))}
            current={norm}
            onChange={(v) => setNorm(v as IncidentNorm)}
          />
        )}
      </div>
      <p className="mb-3 text-xs text-text-muted">{caption}</p>
      <div
        ref={containerRef}
        className="h-[640px] w-full overflow-hidden rounded-lg border border-border"
      />
    </div>
  );
}

function TabStrip({
  ariaLabel,
  values,
  current,
  onChange,
}: {
  ariaLabel: string;
  values: ReadonlyArray<{ id: string; label: string; help: string }>;
  current: string;
  onChange: (next: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface"
    >
      {values.map((v) => {
        const isActive = current === v.id;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(v.id)}
            title={v.help || undefined}
            className={`px-3 py-2 text-sm font-medium transition ${
              isActive
                ? 'bg-accent-strong text-white'
                : 'text-text-muted hover:bg-bg hover:text-text'
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
