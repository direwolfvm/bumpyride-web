import { createCanvas } from '@napi-rs/canvas';
import { CELL_LAT_DEG, CELL_LON_DEG, cellOrigin } from './bump-grid';

// Server-side bump-tile renderer. Port of the iOS BumpMapTileOverlay.swift
// rendering pipeline — same two-pass glow + colored-cell layout so tiles
// from the web map match the iOS look.

export const TILE_SIZE = 256;

// Padding (in tile pixels) added around the tile bbox when querying cells,
// so that glow halos from cells just outside the tile edge are still drawn.
// Matches the iOS `maxGlowRadiusPx` constant.
export const GLOW_RADIUS_PX = 22;

// Bumpiness → color ramp. Mirrors the default thresholds in
// BumpyRide/AppSettings.swift. Values are in g (1 g = 9.81 m/s²).
const COLOR_STOPS: ReadonlyArray<{ value: number; rgb: readonly [number, number, number] }> = [
  { value: 0.0, rgb: [0, 204, 0] },     // green
  { value: 0.5, rgb: [255, 187, 0] },   // yellow
  { value: 1.0, rgb: [255, 119, 0] },   // orange
  { value: 1.5, rgb: [221, 34, 34] },   // red
  { value: 2.0, rgb: [170, 0, 221] },   // purple
];

// Per-cell alpha applied at fill time so the basemap shows through, matching
// the iOS app's `tileFillAlpha = 0.78`. The MapLibre raster layer keeps
// `raster-opacity: 1.0` so the in-tile alpha is the only attenuation —
// otherwise the glow halo gets crushed below visibility.
const CELL_FILL_ALPHA = 0.78;

// Two-layer purple halo matching the iOS BumpMapTileOverlay exactly:
//   outer  = UIColor(red: 0.55, green: 0.18, blue: 0.95, alpha: 0.78), blur 22
//   inner  = UIColor(red: 0.85, green: 0.50, blue: 1.00, alpha: 1.00), blur 7
const GLOW_OUTER_COLOR = 'rgba(140, 46, 242, 0.78)';
const GLOW_OUTER_BLUR = 22;
const GLOW_INNER_COLOR = 'rgba(217, 128, 255, 1.0)';
const GLOW_INNER_BLUR = 7;

function colorFor(value: number): string {
  const first = COLOR_STOPS[0];
  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  if (value <= first.value) return rgba(first.rgb);
  if (value >= last.value) return rgba(last.rgb);
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (value <= b.value) {
      const t = (value - a.value) / (b.value - a.value);
      return rgba([
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ]);
    }
  }
  return rgba([128, 128, 128]);
}

function rgba(c: readonly [number, number, number]): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${CELL_FILL_ALPHA})`;
}

// Web Mercator. Tile (z, x, y) → lon/lat of NW + SE corners.
function tileToBbox(z: number, x: number, y: number) {
  const n = Math.pow(2, z);
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { west, east, north, south };
}

function lonLatToTilePx(
  z: number,
  tileX: number,
  tileY: number,
  lon: number,
  lat: number,
) {
  const n = Math.pow(2, z);
  const fx = ((lon + 180) / 360) * n;
  const fy =
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
    n;
  return { x: (fx - tileX) * TILE_SIZE, y: (fy - tileY) * TILE_SIZE };
}

/**
 * Lat/lon range to query for cells whose rect (or glow halo) might appear in
 * this tile. The tile bbox is widened by `GLOW_RADIUS_PX` worth of degrees
 * so cells just outside the edge still get their halos drawn.
 */
export function tileQueryBbox(z: number, x: number, y: number) {
  const bbox = tileToBbox(z, x, y);
  // Pixel-to-degree conversion at the tile center (web mercator is nearly
  // uniform within a single tile, so this is plenty accurate).
  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLon = (bbox.west + bbox.east) / 2;
  const dLon = 0.001;
  const dLat = 0.001;
  const p0 = lonLatToTilePx(z, x, y, centerLon, centerLat);
  const pLon = lonLatToTilePx(z, x, y, centerLon + dLon, centerLat);
  const pLat = lonLatToTilePx(z, x, y, centerLon, centerLat + dLat);
  const degPerPxLon = dLon / Math.abs(pLon.x - p0.x);
  const degPerPxLat = dLat / Math.abs(pLat.y - p0.y);
  const padLon = GLOW_RADIUS_PX * degPerPxLon;
  const padLat = GLOW_RADIUS_PX * degPerPxLat;
  return {
    west: bbox.west - padLon,
    east: bbox.east + padLon,
    south: bbox.south - padLat,
    north: bbox.north + padLat,
  };
}

export type Cell = { ix: number; iy: number; sum: number; count: number };

const EMPTY_TILE = createCanvas(TILE_SIZE, TILE_SIZE).toBuffer('image/png');

export function emptyTilePng(): Buffer {
  return EMPTY_TILE;
}

export function renderTile(
  z: number,
  x: number,
  y: number,
  cells: Cell[],
): Buffer {
  if (cells.length === 0) return EMPTY_TILE;

  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d');

  // Precompute each cell's pixel rect on this tile. When the natural cell
  // size falls below 1 px (low zoom), enforce a 1 px floor centred on the
  // cell's geometric centre — matching iOS — so the rect doesn't drift
  // toward one corner as zoom changes.
  type Rect = { px: number; py: number; w: number; h: number; avg: number };
  const rects: Rect[] = [];
  for (const c of cells) {
    if (c.count <= 0) continue;
    const origin = cellOrigin(c.ix, c.iy);
    const tl = lonLatToTilePx(
      z,
      x,
      y,
      origin.lon,
      origin.lat + CELL_LAT_DEG,
    );
    const br = lonLatToTilePx(
      z,
      x,
      y,
      origin.lon + CELL_LON_DEG,
      origin.lat,
    );
    const cx = (tl.x + br.x) / 2;
    const cy = (tl.y + br.y) / 2;
    const w = Math.max(1, br.x - tl.x);
    const h = Math.max(1, br.y - tl.y);
    rects.push({
      px: cx - w / 2,
      py: cy - h / 2,
      w,
      h,
      avg: c.sum / c.count,
    });
  }
  if (rects.length === 0) return EMPTY_TILE;

  // Pass 1 — glow. Two shadow passes (wide soft aura + tight bright core)
  // on a single path containing every cell rect, matching the iOS look.
  ctx.save();
  ctx.shadowColor = GLOW_OUTER_COLOR;
  ctx.shadowBlur = GLOW_OUTER_BLUR;
  ctx.fillStyle = GLOW_OUTER_COLOR;
  ctx.beginPath();
  for (const r of rects) ctx.rect(r.px, r.py, r.w, r.h);
  ctx.fill();
  ctx.shadowColor = GLOW_INNER_COLOR;
  ctx.shadowBlur = GLOW_INNER_BLUR;
  ctx.fillStyle = GLOW_INNER_COLOR;
  ctx.beginPath();
  for (const r of rects) ctx.rect(r.px, r.py, r.w, r.h);
  ctx.fill();
  ctx.restore();

  // Pass 2 — colored cells. clearRect under each footprint first so the
  // halo we just painted under the rect doesn't tint the cell colour, then
  // fill with the bumpiness-mapped colour. This is the HTML5 equivalent of
  // iOS's `.copy` blendMode-per-fill behaviour.
  for (const r of rects) {
    ctx.clearRect(r.px, r.py, r.w, r.h);
    ctx.fillStyle = colorFor(r.avg);
    ctx.fillRect(r.px, r.py, r.w, r.h);
  }

  return canvas.toBuffer('image/png');
}

// ---------------------------------------------------------------------------
// Incident tiles — brake events and close-call events.
//
// Renders one filled CELL per cell (same 20 ft grid as the bumpiness
// layer, same glow halo) with a count-based color ramp. Discrete
// thresholds mirror the iOS BrakeMapTileOverlay color scheme.
//
//   0 events    → green   (cell has bump coverage; no incidents)
//   1 event     → yellow
//   2–3 events  → orange
//   4–5 events  → red
//   6+ events   → purple
//
// The green-for-0 tier matters because the brake/close-call tile
// routes now LEFT JOIN against bump_cells (or the user's coverage)
// — a cell with bump data but no events shows green so the layer is
// visually complete and comparable to the bumpiness layer cell-for-
// cell. Earlier circle-based renders skipped 0-count cells entirely.
// ---------------------------------------------------------------------------

export type IncidentCell = { ix: number; iy: number; count: number };

const INCIDENT_CELL_ALPHA = 0.78;

function incidentColor(count: number): string {
  if (count >= 6) return `rgba(170, 0, 221, ${INCIDENT_CELL_ALPHA})`;  // purple
  if (count >= 4) return `rgba(221, 34, 34, ${INCIDENT_CELL_ALPHA})`;  // red
  if (count >= 2) return `rgba(255, 119, 0, ${INCIDENT_CELL_ALPHA})`;  // orange
  if (count >= 1) return `rgba(255, 187, 0, ${INCIDENT_CELL_ALPHA})`;  // yellow
  return `rgba(0, 204, 0, ${INCIDENT_CELL_ALPHA})`;                     // green (count = 0)
}

export function renderIncidentTile(
  z: number,
  x: number,
  y: number,
  cells: IncidentCell[],
): Buffer {
  if (cells.length === 0) return EMPTY_TILE;

  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d');

  // Same cell-rect layout as the bumpiness renderTile path — keep
  // the 1 px floor for low-zoom so a single sub-pixel cell still
  // shows up rather than getting anti-aliased into invisibility.
  type Rect = { px: number; py: number; w: number; h: number; count: number };
  const rects: Rect[] = [];
  for (const c of cells) {
    const origin = cellOrigin(c.ix, c.iy);
    const tl = lonLatToTilePx(z, x, y, origin.lon, origin.lat + CELL_LAT_DEG);
    const br = lonLatToTilePx(z, x, y, origin.lon + CELL_LON_DEG, origin.lat);
    const cx = (tl.x + br.x) / 2;
    const cy = (tl.y + br.y) / 2;
    const w = Math.max(1, br.x - tl.x);
    const h = Math.max(1, br.y - tl.y);
    rects.push({
      px: cx - w / 2,
      py: cy - h / 2,
      w,
      h,
      count: c.count,
    });
  }
  if (rects.length === 0) return EMPTY_TILE;

  // Glow pass — identical to renderTile. The purple-glow halo makes
  // sparse data visible at any zoom and visually ties the incident
  // layers to the bumpiness layer.
  ctx.save();
  ctx.shadowColor = GLOW_OUTER_COLOR;
  ctx.shadowBlur = GLOW_OUTER_BLUR;
  ctx.fillStyle = GLOW_OUTER_COLOR;
  ctx.beginPath();
  for (const r of rects) ctx.rect(r.px, r.py, r.w, r.h);
  ctx.fill();
  ctx.shadowColor = GLOW_INNER_COLOR;
  ctx.shadowBlur = GLOW_INNER_BLUR;
  ctx.fillStyle = GLOW_INNER_COLOR;
  ctx.beginPath();
  for (const r of rects) ctx.rect(r.px, r.py, r.w, r.h);
  ctx.fill();
  ctx.restore();

  // Colored-cells pass. clearRect first so the halo doesn't tint
  // the fill (matches renderTile's behaviour).
  for (const r of rects) {
    ctx.clearRect(r.px, r.py, r.w, r.h);
    ctx.fillStyle = incidentColor(r.count);
    ctx.fillRect(r.px, r.py, r.w, r.h);
  }

  return canvas.toBuffer('image/png');
}
