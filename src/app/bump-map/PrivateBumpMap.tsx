'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyleForCurrentTheme } from '@/lib/map-style';
import {
  CircleMarkerSwatch,
  ColorSquareSwatch,
  HaloSwatch,
  MapLegend,
  type LegendItem,
} from '@/components/MapLegend';
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

// Personal bump map. Multi-layer model — any combination of layers
// can be visible simultaneously, controlled by a floating legend
// overlay. The tab strips configure each layer's render settings
// (aggregation, metric, normalization, etc).

type RidesFilter = 'mounted' | 'pocket' | 'all';

// Visibility flags for every layer the map renders. Independent
// checkboxes in the legend toggle these.
type VisibleLayers = {
  bumps: boolean;
  brakeCells: boolean;
  brakeEvents: boolean;
  closeCells: boolean;
  closeEvents: boolean;
  halo: boolean;
};

const DEFAULT_VISIBLE: VisibleLayers = {
  bumps: true,
  brakeCells: false,
  brakeEvents: false,
  closeCells: false,
  closeEvents: false,
  halo: false,
};

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

// MapLibre source + layer IDs. One per renderable item.
const SRC_BUMPS = 'bumps';
const SRC_BRAKE_CELLS = 'brake-cells';
const SRC_CLOSE_CELLS = 'close-call-cells';
const SRC_BRAKE_EVENTS = 'brake-events';
const SRC_CLOSE_EVENTS = 'close-call-events';
const SRC_HALO = 'coverage-halo';

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

// Build the bumpiness raster URL. Default is fill-style; pass
// style='halo' for the halo-only backdrop.
function bumpsTileUrl(
  rides: RidesFilter,
  mode: TileMode,
  percentile: TilePercentile,
  agg: TileBumpAgg,
  style: 'fill' | 'halo' = 'fill',
): string {
  const params: string[] = [`rides=${rides}`];
  if (mode !== 'all') params.push(`mode=${mode}`);
  if (percentile !== 'all') params.push(`percentile=${percentile}`);
  if (agg !== 'avg') params.push(`agg=${agg}`);
  if (style === 'halo') params.push('style=halo');
  return `/api/tiles/user/{z}/{x}/{y}?${params.join('&')}`;
}

function brakesTileUrl(
  rides: RidesFilter,
  mode: TileMode,
  percentile: TilePercentile,
  metric: IncidentMetric,
  norm: IncidentNorm,
): string {
  const params: string[] = [`rides=${rides}`];
  if (mode !== 'all') params.push(`mode=${mode}`);
  if (percentile !== 'all') params.push(`percentile=${percentile}`);
  if (metric !== 'count') params.push(`metric=${metric}`);
  if (norm !== 'raw') params.push(`norm=${norm}`);
  return `/api/tiles/user/brakes/{z}/{x}/{y}?${params.join('&')}`;
}

function closeCallsTileUrl(
  rides: RidesFilter,
  mode: TileMode,
  percentile: TilePercentile,
  norm: IncidentNorm,
): string {
  const params: string[] = [`rides=${rides}`];
  if (mode !== 'all') params.push(`mode=${mode}`);
  if (percentile !== 'all') params.push(`percentile=${percentile}`);
  if (norm !== 'raw') params.push(`norm=${norm}`);
  return `/api/tiles/user/close-calls/{z}/{x}/{y}?${params.join('&')}`;
}

// Marker palette for the two event types. Brakes are deep red,
// close calls are amber — visually distinct when both are layered.
const BRAKE_MARKER_COLOR = '#dc2626';
const CLOSE_CALL_MARKER_COLOR = '#f59e0b';

// Circle-paint expression shared by both event layers. Only the
// color differs.
function markerPaint(color: string): maplibregl.CircleLayerSpecification['paint'] {
  return {
    'circle-radius': [
      'interpolate',
      ['linear'],
      ['zoom'],
      10, 3,
      15, 6,
      18, 10,
    ],
    'circle-color': color,
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1.5,
    'circle-opacity': 0.85,
  };
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

  const [visible, setVisible] = useState<VisibleLayers>(DEFAULT_VISIBLE);
  const [rides, setRides] = useState<RidesFilter>('mounted');
  const [mode, setMode] = useState<TileMode>('all');
  const [percentile, setPercentile] = useState<TilePercentile>('all');
  const [bumpAgg, setBumpAgg] = useState<TileBumpAgg>('avg');
  const [metric, setMetric] = useState<IncidentMetric>('count');
  const [norm, setNorm] = useState<IncidentNorm>('raw');

  // Event counts shown in caption when those layers are visible.
  const [brakeEventsCount, setBrakeEventsCount] = useState<number | null>(null);
  const [brakeEventsTruncated, setBrakeEventsTruncated] = useState(false);
  const [closeEventsCount, setCloseEventsCount] = useState<number | null>(null);
  const [closeEventsTruncated, setCloseEventsTruncated] = useState(false);

  // SSR-safe rides hydration on mount.
  useEffect(() => {
    setRides(readStoredRides());
  }, []);

  function selectRides(next: RidesFilter) {
    setRides(next);
    try {
      localStorage.setItem(STORE_RIDES, next);
    } catch {}
  }

  function toggleLayer<K extends keyof VisibleLayers>(key: K) {
    setVisible((v) => ({ ...v, [key]: !v[key] }));
  }

  // Map construction (mount only). All sources/layers registered up
  // front with visibility='none'; the visibility effect toggles them
  // based on the `visible` record.
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
      // Three raster cell layers (one per data source).
      map.addSource(SRC_BUMPS, {
        type: 'raster',
        tiles: [bumpsTileUrl(rides, mode, percentile, bumpAgg)],
        tileSize: 256,
        attribution: 'Your bump data',
      });
      map.addLayer({ id: SRC_BUMPS, type: 'raster', source: SRC_BUMPS, layout: { visibility: 'visible' } });

      map.addSource(SRC_BRAKE_CELLS, {
        type: 'raster',
        tiles: [brakesTileUrl(rides, mode, percentile, metric, norm)],
        tileSize: 256,
        attribution: 'Your brake events',
      });
      map.addLayer({ id: SRC_BRAKE_CELLS, type: 'raster', source: SRC_BRAKE_CELLS, layout: { visibility: 'none' } });

      map.addSource(SRC_CLOSE_CELLS, {
        type: 'raster',
        tiles: [closeCallsTileUrl(rides, mode, percentile, norm)],
        tileSize: 256,
        attribution: 'Your close calls',
      });
      map.addLayer({ id: SRC_CLOSE_CELLS, type: 'raster', source: SRC_CLOSE_CELLS, layout: { visibility: 'none' } });

      // Coverage halo backdrop — translucent purple halo over every
      // cell the user has visited. Independent toggle so the user
      // can pull it up for context any time.
      map.addSource(SRC_HALO, {
        type: 'raster',
        tiles: [bumpsTileUrl(rides, mode, 'all', 'avg', 'halo')],
        tileSize: 256,
      });
      map.addLayer({
        id: SRC_HALO,
        type: 'raster',
        source: SRC_HALO,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.25 },
      });

      // Two GeoJSON event sources — independent so brake and close-
      // call markers can be on simultaneously with distinct colors.
      map.addSource(SRC_BRAKE_EVENTS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: SRC_BRAKE_EVENTS,
        type: 'circle',
        source: SRC_BRAKE_EVENTS,
        layout: { visibility: 'none' },
        paint: markerPaint(BRAKE_MARKER_COLOR),
      });

      map.addSource(SRC_CLOSE_EVENTS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: SRC_CLOSE_EVENTS,
        type: 'circle',
        source: SRC_CLOSE_EVENTS,
        layout: { visibility: 'none' },
        paint: markerPaint(CLOSE_CALL_MARKER_COLOR),
      });
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
    // Initial URLs are baked in once; the retile effect handles
    // subsequent config changes via setTiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minLat, maxLat, minLon, maxLon]);

  // Visibility effect — applies `visible` to every layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const setVis = (id: string, on: boolean) => {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
        }
      };
      setVis(SRC_BUMPS, visible.bumps);
      setVis(SRC_BRAKE_CELLS, visible.brakeCells);
      setVis(SRC_CLOSE_CELLS, visible.closeCells);
      setVis(SRC_BRAKE_EVENTS, visible.brakeEvents);
      setVis(SRC_CLOSE_EVENTS, visible.closeEvents);
      setVis(SRC_HALO, visible.halo);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [visible]);

  // Retile effect — pushes URL changes to every raster source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const setTiles = (id: string, url: string) => {
        const src = map.getSource(id);
        if (src && src.type === 'raster') {
          (src as maplibregl.RasterTileSource).setTiles([url]);
        }
      };
      setTiles(SRC_BUMPS, bumpsTileUrl(rides, mode, percentile, bumpAgg));
      setTiles(SRC_BRAKE_CELLS, brakesTileUrl(rides, mode, percentile, metric, norm));
      setTiles(SRC_CLOSE_CELLS, closeCallsTileUrl(rides, mode, percentile, norm));
      // Halo URL ignores percentile + agg by design — it's a "where
      // have I been" backdrop, scoped only by rides + time window.
      setTiles(SRC_HALO, bumpsTileUrl(rides, mode, 'all', 'avg', 'halo'));
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [rides, mode, percentile, bumpAgg, metric, norm]);

  // Generic events fetcher hook — re-runs whenever the layer
  // becomes visible OR when rides/mode change. moveend triggers
  // re-fetch while the layer is visible.
  useEventsFetch({
    mapRef,
    sourceId: SRC_BRAKE_EVENTS,
    endpoint: '/api/me/brakes/events',
    visible: visible.brakeEvents,
    rides,
    mode,
    setCount: setBrakeEventsCount,
    setTruncated: setBrakeEventsTruncated,
  });
  useEventsFetch({
    mapRef,
    sourceId: SRC_CLOSE_EVENTS,
    endpoint: '/api/me/close-calls/events',
    visible: visible.closeEvents,
    rides,
    mode,
    setCount: setCloseEventsCount,
    setTruncated: setCloseEventsTruncated,
  });

  // Caption beneath the tab strips. Events counts take priority,
  // then percentile / mode / rides explainers fall through.
  const captionParts: string[] = [];
  if (visible.brakeEvents && brakeEventsCount !== null) {
    captionParts.push(
      `${brakeEventsCount.toLocaleString()} brake event${brakeEventsCount === 1 ? '' : 's'}${brakeEventsTruncated ? '*' : ''}`,
    );
  }
  if (visible.closeEvents && closeEventsCount !== null) {
    captionParts.push(
      `${closeEventsCount.toLocaleString()} close-call${closeEventsCount === 1 ? '' : 's'}${closeEventsTruncated ? '*' : ''}`,
    );
  }
  const eventsCaption = captionParts.length
    ? `Showing ${captionParts.join(' · ')} in viewport.${brakeEventsTruncated || closeEventsTruncated ? ' * capped — zoom in for the full set.' : ''}`
    : null;

  const fallbackCaption =
    percentile !== 'all'
      ? PERCENTILE_HELP[percentile]
      : mode !== 'all'
        ? MODE_HELP[mode]
        : RIDES_HELP[rides];
  const caption = eventsCaption ?? fallbackCaption;

  // Conditional tab strips — only show settings relevant to a
  // currently-visible layer. Keeps the chrome quiet when the user
  // only has one layer up.
  const showBumpAgg = visible.bumps;
  const showMetric = visible.brakeCells;
  const showNorm = visible.brakeCells || visible.closeCells;

  const legendItems: ReadonlyArray<LegendItem> = [
    {
      id: 'bumps',
      label: 'Bumpiness',
      visible: visible.bumps,
      onToggle: () => toggleLayer('bumps'),
      swatch: <ColorSquareSwatch from="#00cc00" to="#ff7700" />,
    },
    {
      id: 'brakeCells',
      label: 'Brake cells',
      visible: visible.brakeCells,
      onToggle: () => toggleLayer('brakeCells'),
      swatch: <ColorSquareSwatch from="#ffbb00" to="#aa00dd" />,
    },
    {
      id: 'brakeEvents',
      label: 'Brake events',
      visible: visible.brakeEvents,
      onToggle: () => toggleLayer('brakeEvents'),
      swatch: <CircleMarkerSwatch color={BRAKE_MARKER_COLOR} />,
    },
    {
      id: 'closeCells',
      label: 'Close-call cells',
      visible: visible.closeCells,
      onToggle: () => toggleLayer('closeCells'),
      swatch: <ColorSquareSwatch from="#ffbb00" to="#aa00dd" />,
    },
    {
      id: 'closeEvents',
      label: 'Close-call events',
      visible: visible.closeEvents,
      onToggle: () => toggleLayer('closeEvents'),
      swatch: <CircleMarkerSwatch color={CLOSE_CALL_MARKER_COLOR} />,
    },
    {
      id: 'halo',
      label: 'Visited cells',
      hint: 'halo',
      visible: visible.halo,
      onToggle: () => toggleLayer('halo'),
      swatch: <HaloSwatch />,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
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
        {showBumpAgg && (
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
        {showMetric && (
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
        {showNorm && (
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
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[640px] w-full overflow-hidden rounded-lg border border-border"
        />
        <MapLegend items={legendItems} />
      </div>
    </div>
  );
}

// Shared events-fetch effect. Single source/endpoint per call —
// brakes and close-calls each get their own invocation.
function useEventsFetch({
  mapRef,
  sourceId,
  endpoint,
  visible,
  rides,
  mode,
  setCount,
  setTruncated,
}: {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  sourceId: string;
  endpoint: string;
  visible: boolean;
  rides: RidesFilter;
  mode: TileMode;
  setCount: (n: number | null) => void;
  setTruncated: (b: boolean) => void;
}) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!visible) {
      setCount(null);
      setTruncated(false);
      return;
    }

    let cancelled = false;
    async function refresh() {
      if (!map) return;
      const b = map.getBounds();
      const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
      const params: string[] = [`bbox=${encodeURIComponent(bbox)}`, `rides=${rides}`];
      if (mode === '3mo') params.push('mode=3mo');
      try {
        const res = await fetch(`${endpoint}?${params.join('&')}`, {
          credentials: 'same-origin',
        });
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as GeoJSON.FeatureCollection;
        const src = map.getSource(sourceId);
        if (src && 'setData' in src) {
          (src as maplibregl.GeoJSONSource).setData(json);
        }
        setCount(json.features.length);
        setTruncated(res.headers.get('X-Truncated') === 'true');
      } catch (err) {
        if (!cancelled) console.error(`events fetch failed (${sourceId})`, err);
      }
    }

    refresh();
    const onMoveEnd = () => refresh();
    map.on('moveend', onMoveEnd);
    return () => {
      cancelled = true;
      map.off('moveend', onMoveEnd);
    };
  }, [mapRef, sourceId, endpoint, visible, rides, mode, setCount, setTruncated]);
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
