"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { tapHaptic, comboHaptic, testHaptic, isHapticsApiAvailable } from "@/lib/haptics";
import {
  loadUser,
  clearUser,
  submitScore,
  type User,
} from "@/lib/user";
import { NicknameForm } from "./NicknameForm";
import { Leaderboard } from "./Leaderboard";

// Linke Hand auf der Home-Row: A=Pinky, S=Ring, D=Middle, F=Index (mit
// Tast-Markierung). Antworten erscheinen in horizontaler Reihe in der
// Reihenfolge der Tasten — die Finger zeigen direkt drauf, keine
// räumliche Übersetzung im Kopf nötig.
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
      /** Vertikaler Offset in px — bei mehreren Floatern im selben Tick
       *  damit sie sich nicht überlappen (Punkte=0, Zeit=+32, Combo=-32). */
      stackOffset: number;
    }[]
  >([]);

  const startTsRef = useRef<number>(0); // when current problem appeared
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const flashIdRef = useRef(0);
  const floaterIdRef = useRef(0);

  const level = useMemo(() => levelFromSolved(solved), [solved]);
  const mult = multForCombo(combo);

  // Load highscore + user on mount
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
    // iOS Safari: erst hier (in einem User-Gesture-Handler) darf AudioContext
    // freigeschaltet werden — sonst bleibt der erste Sound stumm.
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
    // Snapshot via Setter-Callbacks ziehen, damit kein veraltetes State
    // einfriert (endGame ist useCallback ohne Deps auf score/solved/bc).
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
          // Server-Submit nur wenn User existiert UND Score > 0.
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

  // Timer loop (rAF, drift-free)
  useEffect(() => {
    if (phase !== "playing") return;
    const loop = (t: number) => {
      const delta = t - lastTickRef.current;
      lastTickRef.current = t;
      setTimeMs((prev) => {
        const next = prev - delta;
        if (next <= 0) {
          rafRef.current = null;
          // schedule end after state flush
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

      // Haptik bei jedem Tastendruck (Android = native vibrate, iOS = no-op
      // wenn nicht unterstützt). Bewusst VOR der correct-Auswertung damit
      // sich Touch und Feedback ohne Lag verbinden.
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
        setCombo(0);
        setTimeMs((t) => Math.max(0, t - GAME.penaltyMs));
        setShake((n) => n + 1);
        pushFloater(`−${(GAME.penaltyMs / 1000).toFixed(0)}s`, "bad", 0);
      }
    },
    [phase, problem, combo, level, newProblem, pushFloater]
  );

  // Keyboard handling
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === "idle") {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startGame();
        }
        return;
      }
      if (phase === "over") {
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
        // A/S/D/F (Home-Row links) → Index 0..3, gleiche Reihenfolge wie
        // die horizontale Antwortreihe.
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
      className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-4 sm:px-6 sm:pt-6"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
      }}
    >
      {/* Brand */}
      <header className="flex items-center justify-between text-sm uppercase tracking-[0.18em] text-muted">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          <span className="font-mono">denis.pxlfrg.com</span>
        </div>
        <div className="font-mono text-ink/60">math · rush</div>
      </header>

      {/* HUD */}
      <section className="mt-6 grid grid-cols-2 gap-2 sm:mt-10 sm:grid-cols-4 sm:gap-4">
        <Stat label="Score" value={score.toString()} mono accent />
        <Stat
          label="Combo"
          value={combo === 0 ? "–" : `${combo}  ×${mult}`}
          mono
          highlight={combo >= 5}
        />
        <Stat label="Level" value={level.toString()} mono />
        <Stat
          label="Time"
          value={(timeMs / 1000).toFixed(1) + "s"}
          mono
          warn={phase === "playing" && timeLow}
        />
      </section>

      {/* Time bar */}
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full border border-ink/15 bg-ink/5">
        <div
          className={
            "h-full transition-[width] duration-[60ms] linear " +
            (timeLow ? "bg-bad" : "bg-accent")
          }
          style={{ width: `${timePct * 100}%` }}
        />
      </div>

      {/* Stage — idle/playing zentriert, over oben anliegend damit
          nachträglich eintreffende Daten (Rang, Leaderboard) keine
          Reflow-Sprünge im Center auslösen. */}
      <section
        key={flash?.id ?? "stage"}
        className={
          "relative mt-6 flex flex-1 flex-col items-center overflow-auto rounded-3xl border border-ink/15 bg-white/60 px-3 py-6 backdrop-blur sm:mt-10 sm:px-6 sm:py-12 " +
          (phase === "over" ? "justify-start " : "justify-center ") +
          (flash?.kind === "good" ? "flash-good" : "") +
          (flash?.kind === "bad" ? " flash-bad" : "")
        }
      >
        {/* Floaters — alle absolut auf gleicher Mittel-Position, vertikal
            via stackOffset versetzt damit Punkte/Zeit/Combo nicht
            überlappen. */}
        <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
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

        {phase === "idle" && (
          <IdleScreen
            highScore={highScore}
            onStart={startGame}
            user={user}
            onUserChange={setUser}
            boardKey={boardKey}
          />
        )}
        {phase === "playing" && problem && (
          <PlayingScreen
            key={shake}
            problem={problem}
            choices={choices}
            onPick={submit}
            shakeNonce={shake}
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
      </section>

      {/* Footer hint */}
      <footer className="mt-6 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted">
        <div className="font-mono">
          {phase === "playing" ? (
            <>
              <span className="hidden sm:inline">
                <Kbd>A</Kbd> <Kbd>S</Kbd> <Kbd>D</Kbd> <Kbd>F</Kbd> wählen · <Kbd>Esc</Kbd> aufgeben
              </span>
              <span className="sm:hidden">Antippen zum Wählen</span>
            </>
          ) : (
            <>
              <span className="hidden sm:inline">
                <Kbd>Enter</Kbd> {phase === "over" ? "nochmal" : "starten"}
              </span>
              <span className="sm:hidden">{phase === "over" ? "Tap Nochmal" : "Tap Start"}</span>
            </>
          )}
        </div>
        <div className="font-mono text-ink/40">v1</div>
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  mono,
  accent,
  warn,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
  warn?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border bg-white/60 px-3 py-2 sm:px-4 sm:py-3 " +
        (warn
          ? "border-bad/50 text-bad"
          : highlight
          ? "border-accent/60 text-ink"
          : "border-ink/15 text-ink")
      }
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted">{label}</div>
      <div
        className={
          (mono ? "font-mono " : "") +
          "mt-0.5 text-xl font-bold tabular-nums sm:mt-1 sm:text-2xl " +
          (accent ? "text-accent" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-1 inline-block rounded border border-ink/30 bg-white px-1.5 py-0.5 text-[10px] font-bold text-ink shadow-hardsm">
      {children}
    </span>
  );
}

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
  const [pickingName, setPickingName] = useState(!user);
  // Wenn extern (z.B. nach Logout) der User wegfällt, automatisch Picker zeigen.
  useEffect(() => {
    if (!user) setPickingName(true);
  }, [user]);

  function logout() {
    clearUser();
    onUserChange(null);
  }

  return (
    <div className="flex w-full flex-col items-center text-center">
      <div className="text-xs uppercase tracking-[0.32em] text-muted">Mental math, on speed</div>
      <h1 className="mt-2 text-5xl font-bold sm:mt-3 sm:text-7xl">
        Math <span className="text-accent">Rush</span>
      </h1>

      {user && !pickingName ? (
        <div className="mt-4 inline-flex items-center gap-3 text-sm">
          <span className="text-muted">Spieler:</span>
          <span className="font-mono font-bold text-ink">{user.nickname}</span>
          <button
            onClick={logout}
            className="text-[11px] uppercase tracking-[0.18em] text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            wechseln
          </button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-4">
          <p className="max-w-md text-sm text-ink/70">
            Damit dein Score aufs Leaderboard kommt: leg einen Namen an.
          </p>
          <NicknameForm
            onCreated={(u) => {
              onUserChange(u);
              setPickingName(false);
            }}
            onSkip={() => setPickingName(false)}
          />
        </div>
      )}

      {!pickingName && (
        <>
          <p className="mt-6 max-w-md text-base text-ink/70">
            Linke Hand auf <Kbd>A</Kbd> <Kbd>S</Kbd> <Kbd>D</Kbd> <Kbd>F</Kbd> ruhen lassen —
            die Tasten zeigen direkt auf die 4 Antworten. Schnelle Treffer schenken Zeit,
            Combo bringt Sound und Multiplikator.
          </p>
          <button
            onClick={onStart}
            className="mt-6 touch-manipulation rounded-2xl bg-ink px-8 py-4 text-lg font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
          >
            Start  ↵
          </button>
          {highScore && (
            <div className="mt-6 font-mono text-sm text-muted">
              Highscore <span className="text-ink">{highScore.score}</span> · {highScore.solved}{" "}
              Aufgaben · Combo {highScore.bestCombo}
            </div>
          )}
          <div className="mt-8 flex justify-center">
            <Leaderboard highlight={user?.nickname} refreshKey={boardKey} />
          </div>
          <HapticTest />
        </>
      )}
    </div>
  );
}

/** Kleine Diagnose-Zeile auf dem Idle-Screen: zeigt ob die Web Vibration
 *  API überhaupt im Browser ist, und ein Test-Button um's am Gerät zu
 *  prüfen. Auf iOS Safari hilft das User zu verstehen warum der
 *  Tastendruck-Puls evtl. nicht zu spüren ist. */
function HapticTest() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [tested, setTested] = useState(false);
  useEffect(() => {
    setSupported(isHapticsApiAvailable());
  }, []);
  if (supported === null) return null;

  return (
    <div className="mt-6 flex flex-col items-center gap-1 text-center">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Haptik</div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">
          {supported ? "Browser-Support: ✓" : "Browser-Support: ✗"}
        </span>
        {supported && (
          <button
            type="button"
            onClick={() => {
              testHaptic();
              setTested(true);
            }}
            className="touch-manipulation rounded-md border border-ink/30 bg-paper px-2 py-1 text-[11px] font-bold text-ink hover:border-ink/60"
          >
            {tested ? "Nochmal" : "Test"}
          </button>
        )}
      </div>
      {!supported && (
        <p className="max-w-xs text-[10px] text-muted">
          iOS Safari hat erst ab 18.4 partielle Vibrations-Unterstützung —
          und auch nur wenn unter Bedienungshilfen → Berühren → Vibration aktiv ist.
        </p>
      )}
    </div>
  );
}

function PlayingScreen({
  problem,
  choices,
  onPick,
  shakeNonce,
}: {
  problem: Problem;
  choices: number[];
  onPick: (guess: number) => void;
  shakeNonce: number;
}) {
  return (
    <div className="flex w-full flex-col items-center">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={problem.text}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="font-mono text-5xl font-bold tabular-nums tracking-tight sm:text-7xl"
        >
          {problem.text}
        </motion.div>
      </AnimatePresence>

      {/* Horizontale 4er-Reihe direkt unter der Aufgabe — 1 vertikaler
          Augensprung, dann linear scannen. Reihenfolge = KEYS (ASDF). */}
      <div
        key={shakeNonce}
        className="shake mt-6 grid w-full max-w-3xl grid-cols-4 gap-1.5 sm:mt-10 sm:gap-3"
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
      // touch-manipulation: kein Double-Tap-Zoom + entfernt 300ms-Tap-Delay
      // auf älterem iOS Safari. Min-height = großzügiges Touch-Target.
      className="group flex min-h-[72px] touch-manipulation flex-col items-center justify-center gap-2 rounded-2xl border-2 border-ink/80 bg-paper px-2 py-4 shadow-hard transition-transform hover:-translate-y-[1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm sm:min-h-[96px] sm:gap-3 sm:py-6"
      aria-label={`Antwort ${keyLabel}: ${value}`}
    >
      <span className="font-mono text-[2rem] font-bold tabular-nums leading-none sm:text-5xl">
        {value}
      </span>
      {/* Key-Badge nur Desktop — auf Mobile gibt's keine Tastatur. */}
      <span className="hidden h-7 w-7 items-center justify-center rounded-md bg-ink font-mono text-xs font-bold text-paper sm:flex">
        {keyLabel}
      </span>
    </button>
  );
}

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
    <div className="flex w-full flex-col items-center text-center">
      <div className="text-xs uppercase tracking-[0.32em] text-muted">
        {isNewBest ? "Neuer Highscore" : "Runde vorbei"}
      </div>
      <div className="mt-2 font-mono text-7xl font-bold text-ink tabular-nums">{score}</div>

      {/* Slot mit Reserve-Höhe — Rang kommt asynchron rein, soll keinen
          Layout-Shift unter sich erzeugen. */}
      <div className="mt-3 flex min-h-[2rem] items-center justify-center text-center">
        {user && rank !== null && score > 0 && (
          <div className="font-mono text-sm">
            <span className="text-muted">Leaderboard-Platz: </span>
            <span className="font-bold text-accent">#{rank}</span>
          </div>
        )}
        {!user && score > 0 && (
          <div className="max-w-xs text-xs text-muted">
            Anonym gespielt — Score landet nicht im Leaderboard.
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-12 gap-y-3 font-mono text-sm">
        <div className="text-muted">Gelöst</div>
        <div className="text-ink tabular-nums">{solved}</div>
        <div className="text-muted">Beste Combo</div>
        <div className="text-ink tabular-nums">{bestCombo}</div>
        {highScore && (
          <>
            <div className="text-muted">Highscore</div>
            <div className="text-ink tabular-nums">{highScore.score}</div>
          </>
        )}
      </div>
      <button
        onClick={onRestart}
        className="mt-8 touch-manipulation rounded-2xl bg-accent px-8 py-4 text-lg font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
      >
        Nochmal  ↵
      </button>
      <div className="mt-8 flex justify-center">
        <Leaderboard highlight={user?.nickname} refreshKey={boardKey} />
      </div>
    </div>
  );
}
