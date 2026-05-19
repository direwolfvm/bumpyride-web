-- Indexes for the public brake-map and close-call-map tile queries.
-- Each tile route scans events by lat/lon bbox, joins to rides + users
-- for the privacy gate, groups by cell, and counts distinct contributors.
-- Without these indexes a tile request seq-scans the whole event table.
--
-- We don't precompute per-cell aggregates (cf. bump_cells) because
-- incident events are sparse (0–10 per ride) — direct scan + group is
-- fast enough at our scale. If query plans degrade later, the tile
-- query is small enough to materialize into a sidecar table.

CREATE INDEX brake_events_loc_idx
  ON brake_events (longitude, latitude);

CREATE INDEX close_call_events_loc_idx
  ON close_call_events (longitude, latitude);
