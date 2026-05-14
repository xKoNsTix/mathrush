"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { generate, generateChoices, levelFromSolved, type Problem } from "@/lib/problems";
import {
  GAME,
  multForCombo,
  pointsFor,
  loadHighScore,
  saveHighScore,
  type HighScore,
} from "@/lib/game";
import { playCorrect, playWrong, playComboMilestone, unlockAudio } from "@/lib/sound";
import { tapHaptic, comboHaptic, wrongHaptic } from "@/lib/haptics";
import {
  loadUser,
  clearUser,
  submitScore,
  type User,
} from "@/lib/user";
import { NicknameForm } from "./NicknameForm";
import { Leaderboard } from "./Leaderboard";

// Linke Hand auf der Home-Row: A=Pinky, S=Ring, D=Middle, F=Index. Auf
// Mobile gibt's keine Tastatur; die Reihenfolge der Buttons (0..3) bleibt
// gleich, das Layout ändert sich (4× breit vs 2×2 grid).
const KEYS = ["A", "S", "D", "F"] as const;
type KeyLabel = (typeof KEYS)[number];

const COMBO_MILESTONES = new Set([5, 10, 15, 20, 30, 50]);

type Phase = "idle" | "playing" | "over";

interface Flash {
  id: number;
  kind: "good" | "bad";
}

export default function MathRush() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [choices, setChoices] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [solved, setSolved] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [timeMs, setTimeMs] = useState(GAME.startTimeMs);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [shake, setShake] = useState(0);
  const [highScore, setHighScore] = useState<HighScore | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [boardKey, setBoardKey] = useState(0);
  const [lastRank, setLastRank] = useState<number | null>(null);
  const [floaters, setFloaters] = useState<
    {
      id: number;
      text: string;
      tone: "good" | "bad" | "combo" | "time";
      stackOffset: number;
    }[]
  >([]);

  const startTsRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const flashIdRef = useRef(0);
  const floaterIdRef = useRef(0);

  const level = useMemo(() => levelFromSolved(solved), [solved]);
  const mult = multForCombo(combo);

  useEffect(() => {
    setHighScore(loadHighScore());
    setUser(loadUser());
  }, []);

  const newProblem = useCallback(
    (prev?: Problem | null) => {
      const lvl = levelFromSolved(solved);
      const p = generate(lvl, prev ?? undefined);
      setProblem(p);
      setChoices(generateChoices(p));
      startTsRef.current = performance.now();
    },
    [solved]
  );

  const startGame = useCallback(() => {
    unlockAudio();
    setScore(0);
    setSolved(0);
    setCombo(0);
    setBestCombo(0);
    setTimeMs(GAME.startTimeMs);
    setFlash(null);
    setFloaters([]);
    setPhase("playing");
    const lvl = 1;
    const p = generate(lvl);
    setProblem(p);
    setChoices(generateChoices(p));
    startTsRef.current = performance.now();
    lastTickRef.current = performance.now();
  }, []);

  const endGame = useCallback(() => {
    setPhase("over");
    setFloaters([]);
    setLastRank(null);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setScore((finalScore) => {
      setBestCombo((bc) => {
        setSolved((sl) => {
          const candidate: HighScore = {
            score: finalScore,
            solved: sl,
            bestCombo: bc,
            date: new Date().toISOString(),
          };
          const prev = loadHighScore();
          if (!prev || candidate.score > prev.score) {
            saveHighScore(candidate);
            setHighScore(candidate);
          }
          if (user && finalScore > 0) {
            void submitScore(user, finalScore, sl, bc).then((r) => {
              if (r) {
                setLastRank(r.rank);
                setBoardKey((k) => k + 1);
              }
            });
          }
          return sl;
        });
        return bc;
      });
      return finalScore;
    });
  }, [user]);

  useEffect(() => {
    if (phase !== "playing") return;
    const loop = (t: number) => {
      const delta = t - lastTickRef.current;
      lastTickRef.current = t;
      setTimeMs((prev) => {
        const next = prev - delta;
        if (next <= 0) {
          rafRef.current = null;
          queueMicrotask(() => endGame());
          return 0;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    lastTickRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [phase, endGame]);

  const pushFloater = useCallback(
    (text: string, tone: "good" | "bad" | "combo" | "time", stackOffset = 0) => {
      const id = ++floaterIdRef.current;
      setFloaters((arr) => [...arr, { id, text, tone, stackOffset }]);
      window.setTimeout(() => {
        setFloaters((arr) => arr.filter((f) => f.id !== id));
      }, 900);
    },
    []
  );

  const submit = useCallback(
    (guess: number) => {
      if (phase !== "playing" || !problem) return;

      tapHaptic();

      const elapsed = performance.now() - startTsRef.current;
      const correct = Math.abs(guess - problem.answer) < 1e-9;

      const flashKind: "good" | "bad" = correct ? "good" : "bad";
      flashIdRef.current += 1;
      setFlash({ id: flashIdRef.current, kind: flashKind });

      if (correct) {
        const fast = elapsed <= GAME.fastThresholdMs;
        const earned = pointsFor({ combo: combo + 1, fast, level });
        const timeReward = GAME.rewardMsPerHit + (fast ? GAME.fastRewardMsExtra : 0);
        playCorrect(combo + 1);
        setScore((s) => s + earned);
        setSolved((s) => s + 1);
        setCombo((c) => {
          const next = c + 1;
          setBestCombo((b) => (next > b ? next : b));
          if (COMBO_MILESTONES.has(next)) {
            pushFloater(`COMBO ×${multForCombo(next)}`, "combo", -32);
            playComboMilestone(next);
            comboHaptic();
          }
          return next;
        });
        setTimeMs((t) => Math.min(GAME.maxTimeMs, t + timeReward));
        pushFloater(`+${earned}${fast ? " ⚡" : ""}`, "good", 0);
        pushFloater(`+${(timeReward / 1000).toFixed(1)}s`, "time", 32);
        newProblem(problem);
      } else {
        playWrong();
        wrongHaptic();
        setCombo(0);
        setTimeMs((t) => Math.max(0, t - GAME.penaltyMs));
        setShake((n) => n + 1);
        pushFloater(`−${(GAME.penaltyMs / 1000).toFixed(0)}s`, "bad", 0);
      }
    },
    [phase, problem, combo, level, newProblem, pushFloater]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === "idle" || phase === "over") {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startGame();
        }
        return;
      }
      if (phase === "playing") {
        if (e.key === "Escape") {
          endGame();
          return;
        }
        const upper = e.key.toUpperCase() as KeyLabel;
        const idx = KEYS.indexOf(upper);
        if (idx >= 0 && idx < choices.length) {
          e.preventDefault();
          submit(choices[idx]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, startGame, endGame, submit, choices]);

  const timePct = Math.max(0, Math.min(1, timeMs / GAME.maxTimeMs));
  const timeLow = timeMs < 5_000;

  return (
    <main
      className={
        "relative flex min-h-dvh w-full flex-col " +
        (flash?.kind === "good" ? "flash-good" : "") +
        (flash?.kind === "bad" ? " flash-bad" : "")
      }
      style={{
        paddingTop: "max(env(safe-area-inset-top), 0.5rem)",
        paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)",
        paddingLeft: "max(env(safe-area-inset-left), 1rem)",
        paddingRight: "max(env(safe-area-inset-right), 1rem)",
      }}
      key={flash?.id ?? "stage"}
    >
      {phase === "playing" && (
        <PlayingScreen
          problem={problem!}
          choices={choices}
          onPick={submit}
          shakeNonce={shake}
          score={score}
          combo={combo}
          mult={mult}
          level={level}
          timeMs={timeMs}
          timePct={timePct}
          timeLow={timeLow}
          floaters={floaters}
          onQuit={endGame}
        />
      )}

      {phase === "idle" && (
        <IdleScreen
          highScore={highScore}
          onStart={startGame}
          user={user}
          onUserChange={setUser}
          boardKey={boardKey}
        />
      )}

      {phase === "over" && (
        <OverScreen
          score={score}
          solved={solved}
          bestCombo={bestCombo}
          highScore={highScore}
          onRestart={startGame}
          user={user}
          rank={lastRank}
          boardKey={boardKey}
        />
      )}
    </main>
  );
}

// --------- Idle ---------

function IdleScreen({
  highScore,
  onStart,
  user,
  onUserChange,
  boardKey,
}: {
  highScore: HighScore | null;
  onStart: () => void;
  user: User | null;
  onUserChange: (u: User | null) => void;
  boardKey: number;
}) {
  const [pickingName, setPickingName] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);

  function logout() {
    clearUser();
    onUserChange(null);
    setPickingName(true);
  }

  // Wenn extern (z.B. nach Logout) der User wegfällt und kein Picker offen,
  // beim ersten Mount auch nicht aufzwingen — bleibt unsichtbar bis User
  // selbst "Name" tappt.
  if (pickingName) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between pb-4">
          <button
            onClick={() => setPickingName(false)}
            className="touch-manipulation text-xs uppercase tracking-[0.22em] text-muted active:text-ink"
          >
            ← Zurück
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Name anlegen
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <NicknameForm
            onCreated={(u) => {
              onUserChange(u);
              setPickingName(false);
            }}
            onSkip={() => setPickingName(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Top bar — user pill + small kbd hint on desktop only */}
      <div className="flex items-center justify-between pb-2">
        <button
          onClick={() => setPickingName(true)}
          className="touch-manipulation rounded-full border border-ink/20 bg-paper px-3 py-1.5 text-xs font-bold text-ink active:translate-y-[1px]"
        >
          {user ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {user.nickname}
            </span>
          ) : (
            <span className="text-ink/60">Name anlegen</span>
          )}
        </button>
        {user && (
          <button
            onClick={logout}
            className="touch-manipulation text-[10px] uppercase tracking-[0.22em] text-muted active:text-ink"
          >
            Wechseln
          </button>
        )}
      </div>

      {/* Logo block — centered, hero-but-not-marketing */}
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="font-display text-6xl font-bold leading-[0.95] tracking-tight sm:text-7xl">
          Math<br />
          <span className="text-accent">Rush</span>
        </h1>
        {highScore && (
          <div className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-muted">
            Best <span className="font-bold text-ink">{highScore.score}</span>
            <span className="mx-2 text-ink/30">·</span>
            Combo <span className="font-bold text-ink">{highScore.bestCombo}</span>
          </div>
        )}
      </div>

      {/* Bottom action stack — thumb zone */}
      <div className="flex flex-col items-stretch gap-3 pt-4">
        <button
          onClick={onStart}
          className="touch-manipulation rounded-2xl bg-ink py-5 text-xl font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
        >
          Start
        </button>
        <Link
          href="/leaderboard"
          className="touch-manipulation rounded-2xl border-2 border-ink/15 bg-paper py-3 text-center text-sm font-bold uppercase tracking-[0.18em] text-ink/70 active:border-ink/40 active:text-ink"
        >
          Leaderboard
        </Link>
        <button
          onClick={() => setBoardOpen(true)}
          className="touch-manipulation text-center text-[10px] uppercase tracking-[0.22em] text-muted active:text-ink"
        >
          Quick view
        </button>
      </div>

      <BoardSheet
        open={boardOpen}
        onClose={() => setBoardOpen(false)}
        highlight={user?.nickname}
        boardKey={boardKey}
      />
    </div>
  );
}

// --------- Playing ---------

function PlayingScreen({
  problem,
  choices,
  onPick,
  shakeNonce,
  score,
  combo,
  mult,
  level,
  timeMs,
  timePct,
  timeLow,
  floaters,
  onQuit,
}: {
  problem: Problem;
  choices: number[];
  onPick: (guess: number) => void;
  shakeNonce: number;
  score: number;
  combo: number;
  mult: number;
  level: number;
  timeMs: number;
  timePct: number;
  timeLow: boolean;
  floaters: {
    id: number;
    text: string;
    tone: "good" | "bad" | "combo" | "time";
    stackOffset: number;
  }[];
  onQuit: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      {/* Compact HUD bar */}
      <div className="flex items-center justify-between pb-2">
        <button
          onClick={onQuit}
          className="touch-manipulation rounded-full border border-ink/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-muted active:text-ink"
          aria-label="Runde beenden"
        >
          ✕
        </button>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Lvl {level}
        </div>
      </div>

      {/* Time bar — wide, prominent */}
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full border border-ink/15 bg-ink/5">
        <div
          className={
            "h-full transition-[width] duration-[60ms] linear " +
            (timeLow ? "bg-bad" : "bg-accent")
          }
          style={{ width: `${timePct * 100}%` }}
        />
      </div>

      {/* Score / combo strip */}
      <div className="mt-3 grid grid-cols-3 gap-2 font-mono tabular-nums">
        <HudStat label="Score" value={score.toString()} accent />
        <HudStat
          label="Combo"
          value={combo === 0 ? "–" : `${combo}×${mult}`}
          highlight={combo >= 5}
        />
        <HudStat
          label="Time"
          value={(timeMs / 1000).toFixed(1) + "s"}
          warn={timeLow}
        />
      </div>

      {/* Problem — fills available space, big */}
      <div className="relative flex flex-1 items-center justify-center py-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-2">
          <AnimatePresence>
            {floaters.map((f) => (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 10 + f.stackOffset, scale: 0.9 }}
                animate={{ opacity: 1, y: -20 + f.stackOffset, scale: 1 }}
                exit={{ opacity: 0, y: -40 + f.stackOffset }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                className={
                  "absolute font-mono font-bold tracking-wide " +
                  (f.tone === "combo"
                    ? "text-2xl text-accent"
                    : f.tone === "bad"
                    ? "text-2xl text-bad"
                    : f.tone === "time"
                    ? "text-lg text-good/80"
                    : "text-2xl text-good")
                }
              >
                {f.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <AnimatePresence mode="popLayout">
          <motion.div
            key={problem.text}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="font-mono text-6xl font-bold tabular-nums tracking-tight sm:text-7xl"
          >
            {problem.text}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Answer grid — 2×2 on phone (thumb-friendly), 4× on desktop */}
      <div
        key={shakeNonce}
        className="shake grid grid-cols-2 gap-3 pb-2 sm:grid-cols-4"
      >
        {KEYS.map((keyLabel, i) => (
          <ChoiceButton
            key={`${problem.text}-${i}`}
            keyLabel={keyLabel}
            value={choices[i]}
            onClick={() => onPick(choices[i])}
          />
        ))}
      </div>
    </div>
  );
}

function HudStat({
  label,
  value,
  accent,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border px-3 py-2 " +
        (warn
          ? "border-bad/50 text-bad"
          : highlight
          ? "border-accent/60 text-ink"
          : "border-ink/10 text-ink")
      }
    >
      <div className="text-[9px] uppercase tracking-[0.2em] text-muted">{label}</div>
      <div
        className={
          "mt-0.5 text-lg font-bold tabular-nums " + (accent ? "text-accent" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}

function ChoiceButton({
  keyLabel,
  value,
  onClick,
}: {
  keyLabel: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[88px] touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl border-2 border-ink/80 bg-paper px-2 py-4 shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm sm:min-h-[96px]"
      aria-label={`Antwort ${keyLabel}: ${value}`}
    >
      <span className="font-mono text-4xl font-bold tabular-nums leading-none sm:text-5xl">
        {value}
      </span>
      <span className="hidden h-6 w-6 items-center justify-center rounded-md bg-ink font-mono text-[10px] font-bold text-paper sm:flex">
        {keyLabel}
      </span>
    </button>
  );
}

// --------- Over ---------

function OverScreen({
  score,
  solved,
  bestCombo,
  highScore,
  onRestart,
  user,
  rank,
  boardKey,
}: {
  score: number;
  solved: number;
  bestCombo: number;
  highScore: HighScore | null;
  onRestart: () => void;
  user: User | null;
  rank: number | null;
  boardKey: number;
}) {
  const isNewBest = highScore?.score === score && score > 0;
  return (
    <div className="flex flex-1 flex-col">
      <div className="pt-4 text-center">
        <div className="text-[11px] uppercase tracking-[0.32em] text-muted">
          {isNewBest ? "Neuer Highscore" : "Runde vorbei"}
        </div>
        <div className="mt-1 font-mono text-7xl font-bold text-ink tabular-nums">
          {score}
        </div>
        <div className="mt-2 flex min-h-[1.5rem] items-center justify-center text-center">
          {user && rank !== null && score > 0 && (
            <div className="font-mono text-sm">
              <span className="text-muted">Platz </span>
              <span className="font-bold text-accent">#{rank}</span>
            </div>
          )}
          {!user && score > 0 && (
            <div className="max-w-xs text-[11px] text-muted">
              Anonym gespielt — Score nicht im Leaderboard.
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 font-mono tabular-nums">
        <HudStat label="Gelöst" value={solved.toString()} />
        <HudStat label="Combo" value={bestCombo.toString()} />
        <HudStat label="Best" value={(highScore?.score ?? 0).toString()} />
      </div>

      {/* Leaderboard auf Over-Screen direkt sichtbar — natürlicher Moment
          ihn anzuschauen. */}
      <div className="mt-6 flex flex-1 justify-center overflow-auto">
        <Leaderboard highlight={user?.nickname} refreshKey={boardKey} />
      </div>

      <button
        onClick={onRestart}
        className="mt-4 touch-manipulation rounded-2xl bg-accent py-5 text-xl font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
      >
        Nochmal
      </button>
    </div>
  );
}

// --------- Leaderboard sheet ---------

function BoardSheet({
  open,
  onClose,
  highlight,
  boardKey,
}: {
  open: boolean;
  onClose: () => void;
  highlight?: string;
  boardKey: number;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-ink/30"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] rounded-t-3xl border-t-2 border-ink/15 bg-paper px-4 pt-3"
            style={{
              paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
            }}
          >
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="mx-auto block h-1.5 w-12 rounded-full bg-ink/20"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.22em] text-muted">
                Leaderboard
              </span>
              <button
                onClick={onClose}
                className="touch-manipulation text-[10px] uppercase tracking-[0.22em] text-muted active:text-ink"
              >
                Fertig
              </button>
            </div>
            <div className="mt-3 flex justify-center overflow-auto pb-2">
              <Leaderboard highlight={highlight} refreshKey={boardKey} limit={20} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
