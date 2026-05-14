export const GAME = {
  startTimeMs: 30_000,
  maxTimeMs: 45_000,
  // Time deltas per outcome
  rewardMsPerHit: 1_400,
  fastRewardMsExtra: 600, // applied if solved fast
  penaltyMs: 3_000,
  // Speed-Bonus: unter dieser Zeit gilt eine Antwort als "fast"
  fastThresholdMs: 1_800,
  // Score
  basePoints: 10,
  fastBonus: 8, // extra points if fast
  comboTiers: [
    { combo: 0, mult: 1 },
    { combo: 5, mult: 2 },
    { combo: 10, mult: 3 },
    { combo: 20, mult: 5 },
    { combo: 35, mult: 8 },
  ],
  // Tick rate of timer
  tickMs: 50,
};

export function multForCombo(combo: number): number {
  let m = 1;
  for (const tier of GAME.comboTiers) {
    if (combo >= tier.combo) m = tier.mult;
  }
  return m;
}

export function pointsFor({
  combo,
  fast,
  level,
}: {
  combo: number;
  fast: boolean;
  level: number;
}): number {
  const base = GAME.basePoints + (level - 1) * 2;
  const bonus = fast ? GAME.fastBonus : 0;
  return (base + bonus) * multForCombo(combo);
}

export interface HighScore {
  score: number;
  solved: number;
  bestCombo: number;
  date: string; // ISO
}

const HS_KEY = "denis.mathrush.highscore.v1";

export function loadHighScore(): HighScore | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as HighScore;
  } catch {
    return null;
  }
}

export function saveHighScore(hs: HighScore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HS_KEY, JSON.stringify(hs));
  } catch {
    // ignore
  }
}
