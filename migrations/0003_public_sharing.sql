-- Phase 4: public aggregated bump-map opt-in.
--
-- Public sharing is OFF BY DEFAULT. The `bump_cells` table is the global
-- aggregate used by the anonymous /map; it now reflects contributions from
-- consenting users only. Truncating here enforces the new default — every
-- pre-migration aggregate point was contributed without an opt-in choice
-- and must be discarded under the new policy. As users toggle their
-- sharing on, /api/me/sharing backfills their points into this table.

ALTER TABLE users
    ADD COLUMN share_to_public_map BOOLEAN NOT NULL DEFAULT FALSE;

TRUNCATE bump_cells;
