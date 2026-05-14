import Database from "better-sqlite3";
import path from "node:path";

// SQLite-Singleton — better-sqlite3 ist synchron und schnell genug
// für das Volumen hier. DB-File liegt in /data/, das Verzeichnis muss
// für www-data schreibbar sein (vom Deploy aus angelegt).
//
// Schema-Init läuft idempotent bei jedem Modul-Load. NOCASE auf
// nickname → "Denis" und "denis" gelten als gleich.

const DB_PATH = path.join(process.cwd(), "data", "mathrush.db");

let cached: Database.Database | null = null;

export function db(): Database.Database {
  if (cached) return cached;
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
      token TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      solved INTEGER NOT NULL,
      best_combo INTEGER NOT NULL,
      played_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scores_user_score
      ON scores(user_id, score DESC);
  `);
  cached = d;
  return d;
}
