"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchLeaderboard, loadUser, type LeaderboardEntry } from "@/lib/user";

const PAGE_SIZE = 50;

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const u = loadUser();
    setMe(u?.nickname ?? null);
  }, []);

  useEffect(() => {
    let cancel = false;
    setEntries(null);
    fetchLeaderboard(PAGE_SIZE).then((e) => {
      if (!cancel) setEntries(e);
    });
    return () => {
      cancel = true;
    };
  }, [refreshKey]);

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col"
      style={{
        paddingTop: "max(env(safe-area-inset-top), 1rem)",
        paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
        paddingLeft: "max(env(safe-area-inset-left), 1rem)",
        paddingRight: "max(env(safe-area-inset-right), 1rem)",
      }}
    >
      <header className="flex items-center justify-between pb-4">
        <Link
          href="/"
          className="touch-manipulation text-xs uppercase tracking-[0.22em] text-muted active:text-ink"
        >
          ← Math Rush
        </Link>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="touch-manipulation text-[10px] uppercase tracking-[0.22em] text-muted active:text-ink"
          aria-label="Reload"
        >
          Reload
        </button>
      </header>

      <div className="text-center">
        <h1 className="font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl">
          Leader<span className="text-accent">board</span>
        </h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Top {PAGE_SIZE} · global · best run per player
        </p>
      </div>

      <section className="mt-8 flex-1">
        {entries === null && (
          <div className="flex min-h-[20rem] items-start justify-center pt-8 text-xs uppercase tracking-[0.22em] text-muted">
            Loading…
          </div>
        )}

        {entries && entries.length === 0 && (
          <div className="flex min-h-[20rem] items-start justify-center pt-8 text-center text-xs uppercase tracking-[0.22em] text-muted">
            No scores yet — be the first.
          </div>
        )}

        {entries && entries.length > 0 && (
          <>
            <Podium entries={entries.slice(0, 3)} me={me} />
            {entries.length > 3 && (
              <ol className="mt-6 space-y-1.5">
                {entries.slice(3).map((e) => (
                  <Row key={e.rank} entry={e} me={me} />
                ))}
              </ol>
            )}
          </>
        )}
      </section>

      <footer className="mt-8 flex justify-center pt-2">
        <Link
          href="/"
          className="touch-manipulation rounded-2xl bg-ink px-6 py-3 text-sm font-bold uppercase tracking-[0.18em] text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
        >
          Play
        </Link>
      </footer>
    </main>
  );
}

function Podium({
  entries,
  me,
}: {
  entries: LeaderboardEntry[];
  me: string | null;
}) {
  return (
    <ol className="space-y-2">
      {entries.map((e) => {
        const isMe = me && e.nickname.toLowerCase() === me.toLowerCase();
        const accent =
          e.rank === 1
            ? "border-accent bg-accent/15"
            : e.rank === 2
            ? "border-ink/40 bg-ink/[0.04]"
            : "border-ink/30 bg-ink/[0.03]";
        return (
          <li
            key={e.rank}
            className={
              "flex items-center gap-3 rounded-2xl border-2 px-4 py-3 font-mono tabular-nums shadow-hardsm " +
              accent +
              (isMe ? " ring-2 ring-accent/60 ring-offset-2 ring-offset-paper" : "")
            }
          >
            <span className="w-8 text-center font-display text-2xl font-bold text-ink">
              {e.rank}
            </span>
            <div className="flex-1 min-w-0">
              <div
                className={
                  "truncate text-base font-bold text-ink " + (isMe ? "underline" : "")
                }
              >
                {e.nickname}
              </div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted">
                {e.solved} solved · combo {e.bestCombo}
              </div>
            </div>
            <div className="text-right">
              <div className="font-display text-3xl font-bold tabular-nums text-ink">
                {e.score}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ entry: e, me }: { entry: LeaderboardEntry; me: string | null }) {
  const isMe = me && e.nickname.toLowerCase() === me.toLowerCase();
  return (
    <li
      className={
        "flex items-baseline gap-3 rounded-xl border px-3 py-2 font-mono text-sm tabular-nums " +
        (isMe
          ? "border-accent/60 bg-accent/10 text-ink"
          : "border-ink/15 bg-paper/60 text-ink")
      }
    >
      <span className="w-8 shrink-0 text-right text-xs text-muted">{e.rank}.</span>
      <span className={"flex-1 truncate " + (isMe ? "font-bold" : "")}>
        {e.nickname}
      </span>
      <span className="hidden w-16 shrink-0 text-right text-[10px] text-muted sm:inline">
        {e.solved} solved
      </span>
      <span className="hidden w-14 shrink-0 text-right text-[10px] text-muted sm:inline">
        C{e.bestCombo}
      </span>
      <span className="w-14 shrink-0 text-right font-bold">{e.score}</span>
    </li>
  );
}
