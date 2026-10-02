// Colours shared between the tile renderer (server, draws the PNG) and
// the map legend (client, draws the swatch).
//
// This module exists so the client can import a colour without pulling
// in lib/tile-renderer.ts, which depends on @napi-rs/canvas — a native
// Node binary that cannot be bundled for the browser. Keep this file
// free of imports.

// Flat fill for "others' visited cells" on the personal bump map:
// public coverage the rider has not been to themselves.
//
// Blue is the one hue this map had left. Everything else is spoken
// for: green -> yellow -> orange -> red -> purple is the bumpiness
// ramp, yellow -> purple the incident ramp, purple again the halo for
// cells YOU have visited, amber close calls, cyan logged events. A
// saturated blue sits far from the warm ramp, is clearly not the
// magenta-leaning purple next to it, and is nothing like the grey of
// the basemap — which the first attempt at this colour was, so it
// disappeared into the map.
export const OTHERS_CELL_FILL = 'rgba(29, 111, 224, 0.72)';
