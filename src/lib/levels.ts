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

// Thresholds were originally 1/1000th of these — every level was
// reachable in a few rides, so anyone actively riding hit 'Legend'
// fast. Multiplied by 1000 so the ladder fits the actual scale of
// long-running rider activity: hundreds of thousands of cells over
// months and months of commuting before the top.
export const LEVELS: ReadonlyArray<Level> = [
  { index: 1,  name: 'Just Rolling',           threshold: 0 },
  { index: 2,  name: 'Saddle Stretcher',       threshold: 25_000 },
  { index: 3,  name: 'Sidewalk Surveyor',      threshold: 75_000 },
  { index: 4,  name: 'Bike Lane Native',       threshold: 150_000 },
  { index: 5,  name: 'Crosstown Cruiser',      threshold: 275_000 },
  { index: 6,  name: 'Greenway Geographer',    threshold: 450_000 },
  { index: 7,  name: 'Pothole Patroller',      threshold: 700_000 },
  { index: 8,  name: 'Bump Bookkeeper',        threshold: 1_050_000 },
  { index: 9,  name: 'Tarmac Topographer',     threshold: 1_500_000 },
  { index: 10, name: 'Asphalt Archivist',      threshold: 2_100_000 },
  { index: 11, name: 'Drain Detective',        threshold: 2_900_000 },
  { index: 12, name: 'Manhole Mapper',         threshold: 4_000_000 },
  { index: 13, name: 'Cobble Cartographer',    threshold: 5_500_000 },
  { index: 14, name: 'Speed Bump Sage',        threshold: 7_500_000 },
  { index: 15, name: 'Velo Cartographer',      threshold: 10_500_000 },
  { index: 16, name: 'Roadie Royalty',         threshold: 15_000_000 },
  { index: 17, name: 'Saddle Savant',          threshold: 22_000_000 },
  { index: 18, name: 'King of the Curbstone',  threshold: 32_000_000 },
  { index: 19, name: 'Yellow Jersey',          threshold: 47_000_000 },
  { index: 20, name: 'BumpyRide Legend',       threshold: 70_000_000 },
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
