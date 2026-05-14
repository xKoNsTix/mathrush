import { randomBytes } from "node:crypto";
import { db } from "./db";

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  solved: number;
  bestCombo: number;
  playedAt: number;
}

const NICK_RE = /^[A-Za-z0-9_\-. ]{2,20}$/;

export function isValidNickname(n: unknown): n is string {
  return typeof n === "string" && NICK_RE.test(n.trim()) && n.trim().length >= 2;
}

/** Erstellt einen User mit eindeutigem Nickname und generiertem Token.
 *  Wirft "TAKEN" wenn der Name schon vergeben ist. */
export function createUser(nicknameRaw: string): { nickname: string; token: string } {
  const nickname = nicknameRaw.trim();
  if (!isValidNickname(nickname)) {
    throw new Error("INVALID_NICKNAME");
  }
  const token = randomBytes(24).toString("hex");
  try {
    db()
      .prepare("INSERT INTO users (nickname, token, created_at) VALUES (?, ?, ?)")
      .run(nickname, token, Date.now());
    return { nickname, token };
  } catch (err) {
    // SQLite UNIQUE constraint = "SQLITE_CONSTRAINT_UNIQUE"
    const code = (err as { code?: string }).code;
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT") {
      throw new Error("TAKEN");
    }
    throw err;
  }
}

/** Prüft Token zum Nickname. Liefert user_id oder null. */
function validateToken(nickname: string, token: string): number | null {
  const row = db()
    .prepare("SELECT id, token FROM users WHERE nickname = ? COLLATE NOCASE")
    .get(nickname) as { id: number; token: string } | undefined;
  if (!row) return null;
  if (row.token !== token) return null;
  return row.id;
}

interface SubmitInput {
  nickname: string;
  token: string;
  score: number;
  solved: number;
  bestCombo: number;
}

/** Plausibilitätsbereich für einen einzelnen Run. Server-seitig
 *  capped — wir trauen dem Client nicht blind. */
function sanityCheck(s: SubmitInput): boolean {
  if (!Number.isInteger(s.score) || s.score < 0 || s.score > 100_000) return false;
  if (!Number.isInteger(s.solved) || s.solved < 0 || s.solved > 1_000) return false;
  if (!Number.isInteger(s.bestCombo) || s.bestCombo < 0 || s.bestCombo > 200) return false;
  return true;
}

export function submitScore(input: SubmitInput): { rank: number; best: number } {
  if (!sanityCheck(input)) throw new Error("INVALID_PAYLOAD");
  const userId = validateToken(input.nickname, input.token);
  if (userId === null) throw new Error("UNAUTHORIZED");

  db()
    .prepare(
      "INSERT INTO scores (user_id, score, solved, best_combo, played_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(userId, input.score, input.solved, input.bestCombo, Date.now());

  // Aktueller Best des Users + sein Leaderboard-Rang berechnen
  const best = (db()
    .prepare("SELECT MAX(score) AS best FROM scores WHERE user_id = ?")
    .get(userId) as { best: number }).best;

  const better = (db()
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT user_id, MAX(score) AS s FROM scores GROUP BY user_id
       ) WHERE s > ?`
    )
    .get(best) as { c: number }).c;

  return { rank: better + 1, best };
}

export function getTopScores(limit = 10): LeaderboardEntry[] {
  // Pro User der beste Score; Tie-Break = frühestes played_at.
  const rows = db()
    .prepare(
      `SELECT u.nickname, s.score, s.solved, s.best_combo AS bestCombo, s.played_at AS playedAt
         FROM scores s
         JOIN users u ON u.id = s.user_id
         JOIN (
           SELECT user_id, MAX(score) AS top FROM scores GROUP BY user_id
         ) m ON m.user_id = s.user_id AND m.top = s.score
         GROUP BY s.user_id
         ORDER BY s.score DESC, s.played_at ASC
         LIMIT ?`
    )
    .all(limit) as Omit<LeaderboardEntry, "rank">[];

  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}
