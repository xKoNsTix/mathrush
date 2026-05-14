"use client";

import { useEffect, useState } from "react";
import { fetchLeaderboard, type LeaderboardEntry } from "@/lib/user";

interface Props {
  /** Nickname des aktuellen Users zum Hervorheben. */
  highlight?: string;
  /** Bump-Counter — wenn er hochgeht, lädt das Leaderboard neu. */
  refreshKey?: number;
  limit?: number;
}

export function Leaderboard({ highlight, refreshKey = 0, limit = 10 }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancel = false;
    fetchLeaderboard(limit).then((e) => {
      if (!cancel) setEntries(e);
    });
    return () => {
      cancel = true;
    };
  }, [refreshKey, limit]);

  // Wrapper mit fester min-height — verhindert Vertical-Shift wenn die
  // Liste vom Loading-State in die geladenen Einträge übergeht.
  if (entries === null) {
    return (
      <div className="flex min-h-[18rem] w-full max-w-sm items-start justify-center pt-4 text-xs uppercase tracking-[0.22em] text-muted">
        Leaderboard lädt…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex min-h-[18rem] w-full max-w-sm items-start justify-center pt-4 text-center text-xs uppercase tracking-[0.22em] text-muted">
        Noch keine Scores — sei der Erste.
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-2 text-center text-[10px] uppercase tracking-[0.32em] text-muted">
        Leaderboard
      </div>
      <ol className="space-y-1.5">
        {entries.map((e) => {
          const me =
            highlight && e.nickname.toLowerCase() === highlight.toLowerCase();
          return (
            <li
              key={e.rank}
              className={
                "flex items-baseline gap-3 rounded-xl border px-3 py-2 font-mono text-sm tabular-nums " +
                (me
                  ? "border-accent/60 bg-accent/10 text-ink"
                  : "border-ink/15 bg-paper/60 text-ink")
              }
            >
              <span className="w-6 shrink-0 text-right text-xs text-muted">
                {e.rank}.
              </span>
              <span className={"flex-1 truncate " + (me ? "font-bold" : "")}>{e.nickname}</span>
              <span className="font-bold">{e.score}</span>
              <span className="hidden w-12 shrink-0 text-right text-[10px] text-muted sm:inline">
                C{e.bestCombo}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
