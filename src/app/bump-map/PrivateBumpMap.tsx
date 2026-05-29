'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyleForCurrentTheme } from '@/lib/map-style';
import { type TilePercentile } from '@/lib/tile-mode';

// Three-option filter, mirroring the iOS Bump Map's segmented control.
//   all      every ride
//   mounted  pocket_mode IS DISTINCT FROM TRUE  (mounted + legacy null)
//   pocket   pocket_mode = TRUE
// Default is `mounted` (matches iOS default).
type Mode = 'all' | 'mounted' | 'pocket';
const DEFAULT_MODE: Mode = 'mounted';

// Persisted in localStorage per-browser. Matches iOS's UserDefaults
// per-device persistence — different browsers / devices keep
// independent filter states.
const STORAGE_KEY = 'bumpmap.mode';

function readStoredMode(): Mode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'all' || v === 'mounted' || v === 'pocket') return v;
  } catch {}
  return DEFAULT_MODE;
}

const TILE_BASE = '/api/tiles/user/{z}/{x}/{y}';
function tileUrl(m: Mode, p: TilePercentile): string {
  // The server defaults to mounted too, but pass the param explicitly
  // either way so the URL is unambiguous in network logs.
  const params = [`mode=${m}`];
  if (p !== 'all') params.push(`percentile=${p}`);
  return `${TILE_BASE}?${params.join('&')}`;
}

const CAPTION: Record<Mode, string> = {
  all: 'Showing all your synced rides.',
  mounted:
    'Showing rides with the phone mounted on the bike (and legacy rides whose mode wasn’t recorded).',
  pocket: 'Showing rides recorded with the phone in your pocket.',
};

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
  // The default in SSR / first paint matches DEFAULT_MODE; we promote
  // to the user's stored preference on mount.
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  // Best/worst-10% percentile filter. Defaults to All cells — the
  // historical behaviour. Not persisted because it's a transient
  // "what does my map look like at the extremes" question, not a
  // long-term preference.
  const [percentile, setPercentile] = useState<TilePercentile>('all');

  useEffect(() => {
    setMode(readStoredMode());
  }, []);

  // Mode is read inside the map's `load` callback (which fires after this
  // effect's sync body returns) — store it on a ref so the callback always
  // sees the latest value even if the user toggled before load completes.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const percentileRef = useRef(percentile);
  percentileRef.current = percentile;

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
      map.addSource('bump', {
        type: 'raster',
        tiles: [tileUrl(modeRef.current, percentileRef.current)],
        tileSize: 256,
      });
      map.addLayer({
        id: 'bump',
        type: 'raster',
        source: 'bump',
        // The tile renderer already bakes per-cell alpha + the purple glow
        // into the PNG; an extra raster-opacity here would dilute the glow.
      });
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [minLat, maxLat, minLon, maxLon]);

  // When the mode/percentile toggle flips, just swap the source's
  // tile URLs — MapLibre re-fetches visible tiles in place rather
  // than reflowing the whole map.
  useEffect(() => {
    const src = mapRef.current?.getSource('bump');
    if (!src) return;
    (src as maplibregl.RasterTileSource).setTiles([
      tileUrl(mode, percentile),
    ]);
  }, [mode, percentile]);

  function selectMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  const percentileCaption =
    percentile === 'top10'
      ? 'Highlighting your smoothest 10% of cells.'
      : percentile === 'bottom10'
        ? 'Highlighting your roughest 10% of cells.'
        : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-text-muted">
          {percentileCaption ?? CAPTION[mode]}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={mode}
            onChange={selectMode}
            options={[
              { value: 'all', label: 'All' },
              { value: 'mounted', label: 'Mounted' },
              { value: 'pocket', label: 'Pocket' },
            ]}
          />
          <Segmented
            value={percentile}
            onChange={setPercentile}
            options={[
              { value: 'all', label: 'All cells' },
              { value: 'top10', label: 'Best 10%' },
              { value: 'bottom10', label: 'Worst 10%' },
            ]}
          />
        </div>
      </div>
      <div
        ref={containerRef}
        className="h-[640px] w-full overflow-hidden rounded-lg border border-border"
      />
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex rounded-md border border-border bg-surface p-0.5 text-sm"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`rounded px-3 py-1.5 transition ${
              active
                ? 'bg-accent-soft text-accent'
                : 'text-text-muted hover:text-text'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
