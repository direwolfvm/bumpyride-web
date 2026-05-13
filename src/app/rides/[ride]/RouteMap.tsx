'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyleForCurrentTheme } from '@/lib/map-style';

// Mirrors the iOS bumpiness colour stops so the route on the web looks like
// the route on the device. Kept in sync with src/lib/tile-renderer.ts.
const LINE_COLOR: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['get', 'bumpiness'],
  0.0, '#00cc00',
  0.5, '#ffbb00',
  1.0, '#ff7700',
  1.5, '#dd2222',
  2.0, '#aa00dd',
];

export type Sample = {
  lat: number;
  lon: number;
  bumpiness: number;
  tSec: number;
};

export function RouteMap({ samples }: { samples: Sample[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || samples.length === 0) return;

    const features = [] as GeoJSON.Feature<GeoJSON.LineString>[];
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
      if (i === 0) continue;
      const prev = samples[i - 1];
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [prev.lon, prev.lat],
            [p.lon, p.lat],
          ],
        },
        properties: { bumpiness: (prev.bumpiness + p.bumpiness) / 2 },
      });
    }

    const map = new maplibregl.Map({
      container: el,
      style: basemapStyleForCurrentTheme(),
      bounds: [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      fitBoundsOptions: { padding: 40, maxZoom: 16 },
    });

    map.on('load', () => {
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': LINE_COLOR, 'line-width': 4 },
      });
    });

    return () => map.remove();
  }, [samples]);

  return (
    <div
      ref={containerRef}
      className="h-[480px] w-full overflow-hidden rounded-lg border border-border"
    />
  );
}
