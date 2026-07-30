-- Ride editing (trim / split) support. See
-- bumpy-ride/docs/RIDE_EDIT_WEB_HANDOFF.md.
--
-- edited_at: stamped by iOS on every user content edit (trim, split,
-- rename) and by the server on web-side edits. NULL = never edited.
-- Drives the multi-client conflict rule on POST /api/sync/ride: an
-- incoming payload whose editedAt is older than the stored value
-- (null counts as older than any timestamp) is rejected with 409 so
-- a stale iOS re-upload can't clobber a fresher web edit.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
