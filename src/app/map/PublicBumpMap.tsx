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

const INCIDENT_METRIC_LABELS: Record<IncidentMetric, string> = {
  count: 'Count',
  intensity: 'Intensity',
};
const INCIDENT_METRIC_DESCRIPTIONS: Record<IncidentMetric, string> = {
  count: 'Number of brake events in the cell. Default.',
  intensity:
    'Sum of (peak g × duration) over every brake event in the cell. Weights firmer / longer brakes more than light taps.',
};

const INCIDENT_NORM_LABELS: Record<IncidentNorm, string> = {
  raw: 'Raw sum',
  freq: 'Frequency',
};
const INCIDENT_NORM_DESCRIPTIONS: Record<IncidentNorm, string> = {
  raw: 'The raw value for the cell — total events or total intensity. Default.',
  freq:
    'Divided by the number of distinct rides that touched the cell. Normalizes for popular streets — a busy corridor with many brakes might read calmer than a quiet street where every rider brakes.',
};

// Incident view mode. Both brakes and close-calls can be shown as
// cell-aggregated heat or as individual event markers. Events are
// gated by the same privacy rule the raster route uses for counts
// (≥3 distinct contributors per cell, OR eager).
type IncidentView = 'cells' | 'events';
const INCIDENT_VIEWS: readonly IncidentView[] = ['cells', 'events'];
const INCIDENT_VIEW_LABELS: Record<IncidentView, string> = {
  cells: 'Cells',
  events: 'Events',
};
const INCIDENT_VIEW_DESCRIPTIONS: Record<IncidentView, string> = {
  cells: 'Aggregate by 20 ft cell. Default. Privacy-gated by ≥3 contributors per cell.',
  events:
    'One marker per event. Only shown in cells that pass the privacy gate. A translucent purple halo of cells passing the bumpiness gate keeps the spatial context.',
};

const EVENTS_SOURCE_ID = 'incident-events';
const EVENTS_LAYER_ID = 'incident-events';
const COVERAGE_HALO_SOURCE_ID = 'coverage-halo';
const COVERAGE_HALO_LAYER_ID = 'coverage-halo';

function coverageHaloUrl(mode: TileMode): string {
  const params: string[] = ['style=halo'];
  if (mode !== 'all') params.push(`mode=${mode}`);
  return `/api/tiles/public/{z}/{x}/{y}?${params.join('&')}`;
}

function eventsEndpointFor(layer: LayerId): string | null {
  if (layer === 'brakes') return '/api/public/brakes/events';
  if (layer === 'close-calls') return '/api/public/close-calls/events';
  return null;
}

function tileUrlFor(
  layerId: LayerId,
  base: string,
  mode: TileMode,
  percentile: TilePercentile,
  agg: TileBumpAgg,
  metric: IncidentMetric,
  norm: IncidentNorm,
): string {
  const params: string[] = [];
  if (mode !== 'all') params.push(`mode=${mode}`);
  if (percentile !== 'all') params.push(`percentile=${percentile}`);
  // Each layer only consumes the URL params relevant to it. Skipping
  // the others keeps the tile cache stable when the user flips a
  // toggle that doesn't apply to the currently-rendered layer.
  if (layerId === 'bumps' && agg !== 'avg') params.push(`agg=${agg}`);
  if (layerId === 'brakes' && metric !== 'count') params.push(`metric=${metric}`);
  if ((layerId === 'brakes' || layerId === 'close-calls') && norm !== 'raw') {
    params.push(`norm=${norm}`);
  }
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
  const [metric, setMetric] = useState<IncidentMetric>('count');
  const [norm, setNorm] = useState<IncidentNorm>('raw');
  const [mode, setMode] = useState<TileMode>('all');
  const [percentile, setPercentile] = useState<TilePercentile>('all');
  const [bumpAgg, setBumpAgg] = useState<TileBumpAgg>('avg');
  const [incidentView, setIncidentView] = useState<IncidentView>('cells');
  const [eventsCount, setEventsCount] = useState<number | null>(null);
  const [eventsTruncated, setEventsTruncated] = useState(false);

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
          tiles: [tileUrlFor(l.id, l.tilesBase, mode, percentile, bumpAgg, metric, norm)],
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
      // Coverage halo backdrop — translucent purple halo over every
      // bumpiness-gate-passing cell. Visible only in events mode so
      // sparse markers have spatial context.
      map.addSource(COVERAGE_HALO_SOURCE_ID, {
        type: 'raster',
        tiles: [coverageHaloUrl(mode)],
        tileSize: 256,
      });
      map.addLayer({
        id: COVERAGE_HALO_LAYER_ID,
        type: 'raster',
        source: COVERAGE_HALO_SOURCE_ID,
        layout: { visibility: 'none' },
        // Kept deliberately faint — the backdrop should hint at
        // coverage without competing with the event markers for
        // attention.
        paint: { 'raster-opacity': 0.25 },
      });
      // Events overlay — GeoJSON circle layer on top.
      map.addSource(EVENTS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: EVENTS_LAYER_ID,
        type: 'circle',
        source: EVENTS_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 3,
            15, 6,
            18, 10,
          ],
          'circle-color': '#ff6b6b',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.85,
        },
      });
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

  // Layer-tab visibility toggle. Brakes / close-calls + events mode
  // swaps the active raster incident layer for the GeoJSON markers
  // and shows the coverage halo backdrop for context.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const isIncident = active === 'brakes' || active === 'close-calls';
    const showEvents = isIncident && incidentView === 'events';
    const apply = () => {
      for (const l of LAYERS) {
        if (!map.getLayer(l.id)) continue;
        const shouldShow =
          l.id === active && !(showEvents && (l.id === 'brakes' || l.id === 'close-calls'));
        map.setLayoutProperty(
          l.id,
          'visibility',
          shouldShow ? 'visible' : 'none',
        );
      }
      if (map.getLayer(EVENTS_LAYER_ID)) {
        map.setLayoutProperty(
          EVENTS_LAYER_ID,
          'visibility',
          showEvents ? 'visible' : 'none',
        );
      }
      if (map.getLayer(COVERAGE_HALO_LAYER_ID)) {
        map.setLayoutProperty(
          COVERAGE_HALO_LAYER_ID,
          'visibility',
          showEvents ? 'visible' : 'none',
        );
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [active, incidentView]);

  // Incident events fetcher. See PrivateBumpMap for the mirror.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const isIncident = active === 'brakes' || active === 'close-calls';
    const showEvents = isIncident && incidentView === 'events';
    const endpoint = showEvents ? eventsEndpointFor(active) : null;
    if (!endpoint) {
      setEventsCount(null);
      setEventsTruncated(false);
      return;
    }

    let cancelled = false;
    async function refresh() {
      if (!map || !endpoint) return;
      const b = map.getBounds();
      const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
      const params: string[] = [`bbox=${encodeURIComponent(bbox)}`];
      if (mode === '3mo') params.push('mode=3mo');
      try {
        const res = await fetch(`${endpoint}?${params.join('&')}`);
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as GeoJSON.FeatureCollection;
        const src = map.getSource(EVENTS_SOURCE_ID);
        if (src && 'setData' in src) {
          (src as maplibregl.GeoJSONSource).setData(json);
        }
        setEventsCount(json.features.length);
        setEventsTruncated(res.headers.get('X-Truncated') === 'true');
      } catch (err) {
        if (!cancelled) console.error('public events fetch failed', err);
      }
    }

    refresh();
    const onMoveEnd = () => refresh();
    map.on('moveend', onMoveEnd);
    return () => {
      cancelled = true;
      map.off('moveend', onMoveEnd);
    };
  }, [active, incidentView, mode]);

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
          tileUrlFor(l.id, l.tilesBase, mode, percentile, bumpAgg, metric, norm),
        ]);
      }
      const haloSrc = map.getSource(COVERAGE_HALO_SOURCE_ID);
      if (haloSrc && haloSrc.type === 'raster') {
        (haloSrc as maplibregl.RasterTileSource).setTiles([coverageHaloUrl(mode)]);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [mode, percentile, bumpAgg, metric, norm]);

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
        {active === 'brakes' && incidentView === 'cells' && (
          <div
            role="tablist"
            aria-label="Metric"
            className="inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface"
          >
            {INCIDENT_METRICS.map((m) => {
              const isActive = metric === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setMetric(m)}
                  title={INCIDENT_METRIC_DESCRIPTIONS[m]}
                  className={`px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-accent-strong text-white'
                      : 'text-text-muted hover:bg-bg hover:text-text'
                  }`}
                >
                  {INCIDENT_METRIC_LABELS[m]}
                </button>
              );
            })}
          </div>
        )}
        {/* Normalization applies only to cell-aggregated incident
            views (both brakes and close-calls). In events mode
            there's nothing to normalize per-event. */}
        {(active === 'brakes' || active === 'close-calls') &&
          incidentView === 'cells' && (
          <div
            role="tablist"
            aria-label="Normalization"
            className="inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface"
          >
            {INCIDENT_NORMS.map((n) => {
              const isActive = norm === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setNorm(n)}
                  title={INCIDENT_NORM_DESCRIPTIONS[n]}
                  className={`px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-accent-strong text-white'
                      : 'text-text-muted hover:bg-bg hover:text-text'
                  }`}
                >
                  {INCIDENT_NORM_LABELS[n]}
                </button>
              );
            })}
          </div>
        )}
        {(active === 'brakes' || active === 'close-calls') && (
          <div
            role="tablist"
            aria-label="View"
            className="inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface"
          >
            {INCIDENT_VIEWS.map((v) => {
              const isActive = incidentView === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setIncidentView(v)}
                  title={INCIDENT_VIEW_DESCRIPTIONS[v]}
                  className={`px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-accent-strong text-white'
                      : 'text-text-muted hover:bg-bg hover:text-text'
                  }`}
                >
                  {INCIDENT_VIEW_LABELS[v]}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="mb-3 text-xs text-text-muted">
        {(active === 'brakes' || active === 'close-calls') &&
        incidentView === 'events' &&
        eventsCount !== null
          ? `Showing ${eventsCount.toLocaleString()} event${eventsCount === 1 ? '' : 's'}${eventsTruncated ? ' (capped — zoom in for full set)' : ''}.`
          : active === 'bumps' && bumpAgg !== 'avg'
            ? BUMP_AGG_DESCRIPTIONS[bumpAgg]
            : (active === 'brakes' || active === 'close-calls') &&
                incidentView === 'events'
              ? INCIDENT_VIEW_DESCRIPTIONS.events
              : active === 'brakes' && metric !== 'count'
                ? INCIDENT_METRIC_DESCRIPTIONS[metric]
                : (active === 'brakes' || active === 'close-calls') && norm !== 'raw'
                  ? INCIDENT_NORM_DESCRIPTIONS[norm]
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
