-- Phase 6: per-rider pocket-mode calibration.
--
-- Pocket-mode rides systematically underread bumpiness (clothing + body act
-- as a mechanical low-pass filter). The iOS app computes a per-rider scalar
-- `pocketGain` from cells where the rider has data in both modes, then
-- applies it to pocket samples before they enter aggregates. This migration
-- adds the storage; /api/me/calibration (GET/PUT) reads + writes; the
-- aggregation paths (POST /api/sync/ride, PATCH /api/me/sharing, GET
-- /api/tiles/user/...) apply the gain to pocket samples when
-- `pocket_confidence >= 3`.
--
-- See bumpyride/docs/CALIBRATION.md for the full contract.
--
-- The clamp [0.5, 5.0] is enforced on write at the API layer; we don't
-- repeat the constraint here to keep migrations free of policy values
-- that may evolve.

ALTER TABLE users
    ADD COLUMN pocket_gain            DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    ADD COLUMN pocket_confidence      INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN pocket_calibration_at  TIMESTAMPTZ;
