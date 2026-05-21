-- Timestamp indexes for the public-map view-mode tile queries.
--
-- /api/tiles/public/{layer}/{z}/{x}/{y} now accepts ?mode= with three
-- values:
--   all      — every event / ride-point ever recorded (default)
--   3mo      — restrict to the last 3 calendar months
--   last10   — keep only the 10 most recent events / points per cell
--
-- For 3mo we add a single-column timestamp index per source. For
-- last10 the query uses a windowed row_number ordered by timestamp
-- DESC partitioned by (ix, iy); the per-table timestamp index is the
-- same backing index in both cases.
--
-- ride_points already has a primary key on (ride_uuid, idx) but no
-- timestamp index. We add one because the bumpiness 3mo + last10
-- modes scan ride_points by lat/lon bbox then filter / order by
-- timestamp.

CREATE INDEX brake_events_timestamp_idx
  ON brake_events (timestamp DESC);

CREATE INDEX close_call_events_timestamp_idx
  ON close_call_events (timestamp DESC);

CREATE INDEX ride_points_timestamp_idx
  ON ride_points (timestamp DESC);

-- ride_points has no spatial index yet — the bumpiness 3mo / last10
-- modes scan by lat/lon bbox. At our scale this is fine; if it gets
-- slow we'll add a (longitude, latitude) B-tree (or PostGIS GiST).
CREATE INDEX ride_points_loc_idx
  ON ride_points (longitude, latitude);
