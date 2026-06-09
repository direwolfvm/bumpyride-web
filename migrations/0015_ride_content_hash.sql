-- iOS v1.7 H5 sync-checksum optimisation.
-- See bumpyride/docs/SYNC_CHECKSUM_WEB_HANDOFF.md.
--
-- When a ride is uploaded, the server now hashes the raw request
-- body (SHA-256 of the JSON wire bytes) and stores it here. The
-- new POST /api/sync/ride/check endpoint takes (rideId, hash) and
-- returns {exists, hashMatches} so the iOS client can skip
-- re-uploading rides the server already has byte-for-byte.
--
-- Nullable because:
--   - rides synced before this column existed have no hash.
--   - rides that come in via a future upload path that can't
--     present a raw body wouldn't be able to populate it either.
-- For "no hash on file" rides, the check endpoint reports
-- {exists: true, hashMatches: false}, which makes iOS upload
-- normally — the hash gets back-filled on that next upload.

ALTER TABLE rides
  ADD COLUMN content_hash TEXT;
