// Client-seitige User-Persistenz. Nickname + Token nach Signup in
// localStorage, von dort lesen wir bei jeder Score-Submission.
// Bei Token-Verlust (localStorage leer) muss man sich neu anlegen.

export interface User {
  nickname: string;
  token: string;
}

const KEY = "denis.mathrush.user.v1";

export function loadUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User>;
    if (typeof parsed.nickname !== "string" || typeof parsed.token !== "string") return null;
    return { nickname: parsed.nickname, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveUser(u: User): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {
    /* full quota / inkognito */
  }
}

export function clearUser(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

export async function createUser(nickname: string): Promise<User> {
  const r = await fetch("/api/user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `http_${r.status}`);
  }
  const u = (await r.json()) as User;
  saveUser(u);
  return u;
}

export async function submitScore(
  user: User,
  score: number,
  solved: number,
  bestCombo: number,
): Promise<{ rank: number; best: number } | null> {
  if (score <= 0) return null;
  try {
    const r = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...user, score, solved, bestCombo }),
    });
    if (!r.ok) return null;
    return (await r.json()) as { rank: number; best: number };
  } catch {
    return null;
  }
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  solved: number;
  bestCombo: number;
  playedAt: number;
}

export async function fetchLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  try {
    const r = await fetch(`/api/leaderboard?limit=${limit}`, { cache: "no-store" });
    if (!r.ok) return [];
    const data = (await r.json()) as { entries: LeaderboardEntry[] };
    return data.entries ?? [];
  } catch {
    return [];
  }
}
