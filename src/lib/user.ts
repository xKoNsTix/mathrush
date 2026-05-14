// Hybrid persistence: local-first, with optional Supabase sync.
//
// - Users (nickname + token) live only in localStorage; this gives every
//   device its own identity without a signup flow.
// - Scores are saved locally AND pushed to Supabase (best-effort). When
//   Supabase isn't configured or the network is down, we fall back to
//   showing the local leaderboard so the app still works offline.

import { supabase } from "./supabase";

export interface User {
  nickname: string;
  token: string;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  solved: number;
  bestCombo: number;
  playedAt: number;
}

interface ScoreRow {
  nickname: string;
  score: number;
  solved: number;
  bestCombo: number;
  playedAt: number;
}

const USER_KEY = "denis.mathrush.user.v1";
const USERS_KEY = "denis.mathrush.users.v1";
const SCORES_KEY = "denis.mathrush.scores.v1";

const NICK_RE = /^[A-Za-z0-9_\-. ]{2,20}$/;

function isValidNickname(n: string): boolean {
  return NICK_RE.test(n) && n.trim().length >= 2;
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function loadUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User>;
    if (typeof parsed.nickname !== "string" || typeof parsed.token !== "string") return null;
    return { nickname: parsed.nickname, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveUser(u: User): void {
  writeJSON(USER_KEY, u);
}

export function clearUser(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* noop */
  }
}

function loadUsers(): User[] {
  return readJSON<User[]>(USERS_KEY, []);
}

function saveUsers(users: User[]): void {
  writeJSON(USERS_KEY, users);
}

export async function createUser(nicknameRaw: string): Promise<User> {
  const nickname = nicknameRaw.trim();
  if (!isValidNickname(nickname)) {
    throw new Error("invalid_nickname");
  }
  const users = loadUsers();
  const takenLocally = users.some(
    (u) => u.nickname.toLowerCase() === nickname.toLowerCase()
  );
  if (takenLocally) throw new Error("nickname_taken");

  const user: User = { nickname, token: randomToken() };
  users.push(user);
  saveUsers(users);
  saveUser(user);
  return user;
}

function loadScores(): ScoreRow[] {
  return readJSON<ScoreRow[]>(SCORES_KEY, []);
}

function saveScores(rows: ScoreRow[]): void {
  writeJSON(SCORES_KEY, rows);
}

function sanityCheck(score: number, solved: number, bestCombo: number): boolean {
  if (!Number.isInteger(score) || score < 0 || score > 100_000) return false;
  if (!Number.isInteger(solved) || solved < 0 || solved > 1_000) return false;
  if (!Number.isInteger(bestCombo) || bestCombo < 0 || bestCombo > 200) return false;
  return true;
}

async function pushToSupabase(
  user: User,
  score: number,
  solved: number,
  bestCombo: number,
): Promise<{ rank: number; best: number } | null> {
  const client = supabase();
  if (!client) return null;
  const { error } = await client.from("scores").insert({
    nickname: user.nickname,
    device_token: user.token,
    score,
    solved,
    best_combo: bestCombo,
  });
  if (error) return null;

  // Pull the user's best + rank from the dedup'd leaderboard view.
  const { data, error: lbError } = await client
    .from("leaderboard")
    .select("nickname, score")
    .order("score", { ascending: false })
    .limit(500);
  if (lbError || !data) return null;

  const myRow = data.find(
    (r) => (r.nickname as string).toLowerCase() === user.nickname.toLowerCase()
  );
  if (!myRow) return null;
  const myBest = myRow.score as number;
  const rank = data.findIndex(
    (r) => (r.nickname as string).toLowerCase() === user.nickname.toLowerCase()
  ) + 1;
  return { rank, best: myBest };
}

function computeLocalRank(
  user: User,
): { rank: number; best: number } {
  const rows = loadScores();
  const myBest = rows
    .filter((r) => r.nickname.toLowerCase() === user.nickname.toLowerCase())
    .reduce((m, r) => Math.max(m, r.score), 0);
  const bestsByUser = new Map<string, number>();
  for (const r of rows) {
    const k = r.nickname.toLowerCase();
    bestsByUser.set(k, Math.max(bestsByUser.get(k) ?? 0, r.score));
  }
  let better = 0;
  for (const v of bestsByUser.values()) {
    if (v > myBest) better++;
  }
  return { rank: better + 1, best: myBest };
}

export async function submitScore(
  user: User,
  score: number,
  solved: number,
  bestCombo: number,
): Promise<{ rank: number; best: number } | null> {
  if (score <= 0) return null;
  if (!sanityCheck(score, solved, bestCombo)) return null;

  // Token check against the local users registry — prevents tab-juggle
  // grief, not a real anti-cheat mechanism.
  const users = loadUsers();
  const known = users.find(
    (u) => u.nickname.toLowerCase() === user.nickname.toLowerCase()
  );
  if (!known || known.token !== user.token) return null;

  // Always persist locally first.
  const rows = loadScores();
  rows.push({
    nickname: known.nickname,
    score,
    solved,
    bestCombo,
    playedAt: Date.now(),
  });
  saveScores(rows);

  // Try server. If it fails / not configured, return the local rank.
  const remote = await pushToSupabase(known, score, solved, bestCombo).catch(
    () => null
  );
  if (remote) return remote;
  return computeLocalRank(known);
}

function entriesFromRemote(
  rows: Array<{
    nickname: string;
    score: number;
    solved: number;
    best_combo: number;
    played_at: string;
  }>,
): LeaderboardEntry[] {
  return rows.map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    score: r.score,
    solved: r.solved,
    bestCombo: r.best_combo,
    playedAt: Date.parse(r.played_at),
  }));
}

function entriesFromLocal(limit: number): LeaderboardEntry[] {
  const rows = loadScores();
  if (rows.length === 0) return [];
  const bestRow = new Map<string, ScoreRow>();
  for (const r of rows) {
    const key = r.nickname.toLowerCase();
    const cur = bestRow.get(key);
    if (
      !cur ||
      r.score > cur.score ||
      (r.score === cur.score && r.playedAt < cur.playedAt)
    ) {
      bestRow.set(key, r);
    }
  }
  const sorted = [...bestRow.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.playedAt - b.playedAt;
  });
  return sorted.slice(0, limit).map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    score: r.score,
    solved: r.solved,
    bestCombo: r.bestCombo,
    playedAt: r.playedAt,
  }));
}

export async function fetchLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const client = supabase();
  if (client) {
    try {
      const { data, error } = await client
        .from("leaderboard")
        .select("nickname, score, solved, best_combo, played_at")
        .order("score", { ascending: false })
        .limit(limit);
      if (!error && data) return entriesFromRemote(data);
    } catch {
      /* network — fall through to local */
    }
  }
  return entriesFromLocal(limit);
}
