-- Scores become FINAL at the moment they are awarded.
--
-- Until now a ride's tiers were recomputed from scratch every time the
-- ride was re-scored (re-upload, trim/split, sharing opt-in). The tier
-- ladder depends on OTHER users' rows — "first ever" means nobody else
-- had the cell; the 3-point refresh means nobody else measured it
-- recently — so a recompute silently re-decided old rides against a
-- world that had moved on:
--
--   * a new rider joining and backfilling old rides could demote your
--     10-point cells to 5, because their (earlier) rides now appear in
--     the "before your ride" window;
--   * a rider leaving freed cells up, promoting someone else's 5 to 10.
--
-- Your score could therefore change because of someone else's actions.
-- From here on, a (ride, cell) row is written once and never
-- re-tiered; see src/lib/scoring.ts.
--
-- Opting out of sharing now WITHDRAWS rows instead of deleting them,
-- so opting back in restores exactly the points originally awarded
-- rather than re-deriving them against the current world. Withdrawn
-- rows count for nothing while withdrawn: not the owner's total, and
-- not other riders' tier checks (their data is not public, so a rider
-- measuring that cell really is the first public measurement).
ALTER TABLE score_events ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;

-- Tier checks and the score cache all filter on active rows, so index
-- for that. Partial index keeps it small — withdrawn rows are rare.
CREATE INDEX IF NOT EXISTS score_events_active_cell_idx
  ON score_events (ix, iy) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS score_events_active_user_cell_idx
  ON score_events (user_id, ix, iy) WHERE withdrawn_at IS NULL;
