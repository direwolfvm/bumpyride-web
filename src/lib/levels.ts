// Twenty named tiers for the cell-discovery scoring ladder. Early
// levels intentionally come quickly so a new user feels progress;
// later ones stretch out so the leaderboard tail has somewhere to go.
//
// Thresholds are the *minimum* total points needed to reach that
// level. Level 1 has threshold 0 so every signed-in rider with
// sharing on starts there.
//
// Names lean on cycling jargon and on the data-collection nature of
// the app (you're literally mapping pavement), with a slight
// progression from "just rolling" through "knows every road" up to
// "legend" at the top.

export type Level = {
  index: number; // 1-based, 1..20
  name: string;
  threshold: number; // total_points required to unlock
};

// Fourth re-scale. The 20M top from the previous pass was still
// optimistic given how brake / close-call cells dilute the score
// in practice; compressing to 10M brings the legend tier within
// reach for a dedicated rider over a season or two without
// trivializing the climb. Same curve shape, same name list, all
// numbers rounded to friendly values.
export const LEVELS: ReadonlyArray<Level> = [
  { index: 1,  name: 'Just Rolling',           threshold: 0 },
  { index: 2,  name: 'Saddle Stretcher',       threshold: 4_000 },
  { index: 3,  name: 'Sidewalk Surveyor',      threshold: 10_000 },
  { index: 4,  name: 'Bike Lane Native',       threshold: 20_000 },
  { index: 5,  name: 'Crosstown Cruiser',      threshold: 40_000 },
  { index: 6,  name: 'Greenway Geographer',    threshold: 65_000 },
  { index: 7,  name: 'Pothole Patroller',      threshold: 100_000 },
  { index: 8,  name: 'Bump Bookkeeper',        threshold: 150_000 },
  { index: 9,  name: 'Tarmac Topographer',     threshold: 200_000 },
  { index: 10, name: 'Asphalt Archivist',      threshold: 300_000 },
  { index: 11, name: 'Drain Detective',        threshold: 400_000 },
  { index: 12, name: 'Manhole Mapper',         threshold: 600_000 },
  { index: 13, name: 'Cobble Cartographer',    threshold: 800_000 },
  { index: 14, name: 'Speed Bump Sage',        threshold: 1_100_000 },
  { index: 15, name: 'Velo Cartographer',      threshold: 1_500_000 },
  { index: 16, name: 'Roadie Royalty',         threshold: 2_200_000 },
  { index: 17, name: 'Saddle Savant',          threshold: 3_200_000 },
  { index: 18, name: 'King of the Curbstone',  threshold: 4_500_000 },
  { index: 19, name: 'Yellow Jersey',          threshold: 6_500_000 },
  { index: 20, name: 'BumpyRide Legend',       threshold: 10_000_000 },
];

/**
 * Resolve a total-points number into the current level + the next
 * threshold (or null if maxed out). Used by the /score page and the
 * /api/me/score endpoint.
 */
export function levelFor(totalPoints: number): {
  level: Level;
  nextThreshold: number | null;
  progress: number; // 0..1 toward next level; 1 if maxed
} {
  let levelIdx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalPoints >= LEVELS[i].threshold) levelIdx = i;
    else break;
  }
  const level = LEVELS[levelIdx];
  const next = LEVELS[levelIdx + 1] ?? null;
  if (!next) {
    return { level, nextThreshold: null, progress: 1 };
  }
  const span = next.threshold - level.threshold;
  const into = totalPoints - level.threshold;
  return {
    level,
    nextThreshold: next.threshold,
    progress: span > 0 ? Math.min(1, into / span) : 0,
  };
}
