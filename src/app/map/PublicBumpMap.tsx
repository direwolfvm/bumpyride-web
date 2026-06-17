'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyleForCurrentTheme } from '@/lib/map-style';
import {
  CircleMarkerSwatch,
  ColorSquareSwatch,
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

// Public bump map. Multi-layer model controlled by a floating
// legend overlay; tab strips configure each layer's render
// settings. Mirror of PrivateBumpMap minus the rides filter.

type VisibleLayers = {
  bumps: boolean;
  brakeCells: boolean;
  brakeEvents: boolean;
  closeCells: boolean;
  closeEvents: boolean;
};

const DEFAULT_VISIBLE: VisibleLayers = {
  bumps: true,
  brakeCells: false,
  brakeEvents: false,
  closeCells: false,
  closeEvents: false,
};

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

const SRC_BUMPS = 'bumps';
const SRC_BRAKE_CELLS = 'brake-cells';
const SRC_CLOSE_CELLS = 'close-call-cells';
const SRC_BRAKE_EVENTS = 'brake-events';
const SRC_CLOSE_EVENTS = 'close-call-events';

const BRAKE_MARKER_COLOR = '#dc2626';
const CLOSE_CALL_MARKER_COLOR = '#f59e0b';

function bumpsTileUrl(
  mode: TileMode,
  percentile: TilePercentile,
  agg: TileBumpAgg,
): string {
  const params: string[] = [];
  if (mode !== 'all') params.push(`mode=${mode}`);
  if (percentile !== 'all') params.push(`percentile=${percentile}`);
  if (agg !== 'avg') params.push(`agg=${agg}`);
  const base = '/api/tiles/public/{z}/{x}/{y}';
  return params.length === 0 ? base : `${base}?${params.join('&')}`;
}

function brakesTileUrl(
  mode: TileMode,
  percentile: TilePercentile,
  metric: IncidentMetric,
  norm: IncidentNorm,
): string {
  const params: string[] = [];
  if (mode !== 'all') params.push(`mode=${mode}`);
  if (percentile !== 'all') params.push(`percentile=${percentile}`);
  if (metric !== 'count') params.push(`metric=${metric}`);
  if (norm !== 'raw') params.push(`norm=${norm}`);
  const base = '/api/tiles/public/brakes/{z}/{x}/{y}';
  return params.length === 0 ? base : `${base}?${params.join('&')}`;
}

function closeCallsTileUrl(
  mode: TileMode,
  percentile: TilePercentile,
  norm: IncidentNorm,
): string {
  const params: string[] = [];
  if (mode !== 'all') params.push(`mode=${mode}`);
  if (percentile !== 'all') params.push(`percentile=${percentile}`);
  if (norm !== 'raw') params.push(`norm=${norm}`);
  const base = '/api/tiles/public/close-calls/{z}/{x}/{y}';
  return params.length === 0 ? base : `${base}?${params.join('&')}`;
}

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

  const [visible, setVisible] = useState<VisibleLayers>(DEFAULT_VISIBLE);
  const [mode, setMode] = useState<TileMode>('all');
  const [percentile, setPercentile] = useState<TilePercentile>('all');
  const [bumpAgg, setBumpAgg] = useState<TileBumpAgg>('avg');
  const [metric, setMetric] = useState<IncidentMetric>('count');
  const [norm, setNorm] = useState<IncidentNorm>('raw');

  const [brakeEventsCount, setBrakeEventsCount] = useState<number | null>(null);
  const [brakeEventsTruncated, setBrakeEventsTruncated] = useState(false);
  const [closeEventsCount, setCloseEventsCount] = useState<number | null>(null);
  const [closeEventsTruncated, setCloseEventsTruncated] = useState(false);

  function toggleLayer<K extends keyof VisibleLayers>(key: K) {
    setVisible((v) => ({ ...v, [key]: !v[key] }));
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
      map.addSource(SRC_BUMPS, {
        type: 'raster',
        tiles: [bumpsTileUrl(mode, percentile, bumpAgg)],
        tileSize: 256,
        attribution: 'Bump data: consenting BumpyRide users',
      });
      map.addLayer({ id: SRC_BUMPS, type: 'raster', source: SRC_BUMPS, layout: { visibility: 'visible' } });

      map.addSource(SRC_BRAKE_CELLS, {
        type: 'raster',
        tiles: [brakesTileUrl(mode, percentile, metric, norm)],
        tileSize: 256,
        attribution: 'Brake data: consenting BumpyRide users',
      });
      map.addLayer({ id: SRC_BRAKE_CELLS, type: 'raster', source: SRC_BRAKE_CELLS, layout: { visibility: 'none' } });

      map.addSource(SRC_CLOSE_CELLS, {
        type: 'raster',
        tiles: [closeCallsTileUrl(mode, percentile, norm)],
        tileSize: 256,
        attribution: 'Close-call data: consenting BumpyRide users',
      });
      map.addLayer({ id: SRC_CLOSE_CELLS, type: 'raster', source: SRC_CLOSE_CELLS, layout: { visibility: 'none' } });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minLat, maxLat, minLon, maxLon]);

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
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [visible]);

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
      setTiles(SRC_BUMPS, bumpsTileUrl(mode, percentile, bumpAgg));
      setTiles(SRC_BRAKE_CELLS, brakesTileUrl(mode, percentile, metric, norm));
      setTiles(SRC_CLOSE_CELLS, closeCallsTileUrl(mode, percentile, norm));
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [mode, percentile, bumpAgg, metric, norm]);

  // Events fetchers — independent per source.
  useEventsFetch({
    mapRef,
    sourceId: SRC_BRAKE_EVENTS,
    endpoint: '/api/public/brakes/events',
    visible: visible.brakeEvents,
    mode,
    setCount: setBrakeEventsCount,
    setTruncated: setBrakeEventsTruncated,
  });
  useEventsFetch({
    mapRef,
    sourceId: SRC_CLOSE_EVENTS,
    endpoint: '/api/public/close-calls/events',
    visible: visible.closeEvents,
    mode,
    setCount: setCloseEventsCount,
    setTruncated: setCloseEventsTruncated,
  });

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
    percentile === 'all' ? MODE_DESCRIPTIONS[mode] : PERCENTILE_DESCRIPTIONS[percentile];
  const caption = eventsCaption ?? fallbackCaption;

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
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Strip
          ariaLabel="View mode"
          values={TILE_MODES.map((m) => ({
            id: m,
            label: MODE_LABELS[m],
            help: MODE_DESCRIPTIONS[m],
          }))}
          current={mode}
          onChange={(v) => setMode(v as TileMode)}
        />
        <Strip
          ariaLabel="Percentile"
          values={TILE_PERCENTILES.map((p) => ({
            id: p,
            label: PERCENTILE_LABELS[p],
            help: PERCENTILE_DESCRIPTIONS[p],
          }))}
          current={percentile}
          onChange={(v) => setPercentile(v as TilePercentile)}
        />
        {showBumpAgg && (
          <Strip
            ariaLabel="Aggregation"
            values={TILE_BUMP_AGGS.map((a) => ({
              id: a,
              label: BUMP_AGG_LABELS[a],
              help: BUMP_AGG_DESCRIPTIONS[a],
            }))}
            current={bumpAgg}
            onChange={(v) => setBumpAgg(v as TileBumpAgg)}
          />
        )}
        {showMetric && (
          <Strip
            ariaLabel="Metric"
            values={INCIDENT_METRICS.map((m) => ({
              id: m,
              label: INCIDENT_METRIC_LABELS[m],
              help: INCIDENT_METRIC_DESCRIPTIONS[m],
            }))}
            current={metric}
            onChange={(v) => setMetric(v as IncidentMetric)}
          />
        )}
        {showNorm && (
          <Strip
            ariaLabel="Normalization"
            values={INCIDENT_NORMS.map((n) => ({
              id: n,
              label: INCIDENT_NORM_LABELS[n],
              help: INCIDENT_NORM_DESCRIPTIONS[n],
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

function useEventsFetch({
  mapRef,
  sourceId,
  endpoint,
  visible,
  mode,
  setCount,
  setTruncated,
}: {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  sourceId: string;
  endpoint: string;
  visible: boolean;
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
      const params: string[] = [`bbox=${encodeURIComponent(bbox)}`];
      if (mode === '3mo') params.push('mode=3mo');
      try {
        const res = await fetch(`${endpoint}?${params.join('&')}`);
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
  }, [mapRef, sourceId, endpoint, visible, mode, setCount, setTruncated]);
}

function Strip({
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
