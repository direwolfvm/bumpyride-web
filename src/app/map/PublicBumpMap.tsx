'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyleForCurrentTheme } from '@/lib/map-style';

type LayerId = 'bumps' | 'brakes' | 'close-calls';

const LAYERS: ReadonlyArray<{
  id: LayerId;
  label: string;
  tiles: string;
  attribution: string;
}> = [
  {
    id: 'bumps',
    label: 'Bumpiness',
    tiles: '/api/tiles/public/{z}/{x}/{y}',
    attribution: 'Bump data: consenting BumpyRide users',
  },
  {
    id: 'brakes',
    label: 'Hard brakes',
    tiles: '/api/tiles/public/brakes/{z}/{x}/{y}',
    attribution: 'Brake data: consenting BumpyRide users',
  },
  {
    id: 'close-calls',
    label: 'Close calls',
    tiles: '/api/tiles/public/close-calls/{z}/{x}/{y}',
    attribution: 'Close-call data: consenting BumpyRide users',
  },
];

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
          tiles: [l.tiles],
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
  }, [minLat, maxLat, minLon, maxLon]);

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

  return (
    <div>
      <div
        role="tablist"
        aria-label="Map layer"
        className="mb-3 inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface"
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
        ref={containerRef}
        className="h-[640px] w-full overflow-hidden rounded-lg border border-border"
      />
    </div>
  );
}
