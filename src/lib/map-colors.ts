// Colours shared between the tile renderer (server, draws the PNG) and
// the map legend (client, draws the swatch).
//
// This module exists so the client can import a colour without pulling
// in lib/tile-renderer.ts, which depends on @napi-rs/canvas — a native
// Node binary that cannot be bundled for the browser. Keep this file
// free of imports.

// Flat fill for "others' visited cells" on the personal bump map:
// public coverage the rider has not been to themselves. Deliberately
// desaturated so it reads as backdrop rather than as a measurement,
// and clearly distinct from the purple halo that already means "cells
// YOU have visited" on the same map.
export const OTHERS_CELL_FILL = 'rgba(125, 150, 185, 0.55)';
