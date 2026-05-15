"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  createSession,
  joinSession,
  normalizeCode,
  SessionError,
  type SessionHandle,
  type SessionState,
} from "@/lib/session";
import {
  createRng,
  generate,
  generateChoices,
  levelFromSolved,
  type Problem,
  type Rng,
} from "@/lib/problems";
import {
  GAME,
  multForCombo,
  pointsFor,
} from "@/lib/game";
import { playCorrect, playWrong, playComboMilestone, unlockAudio } from "@/lib/sound";
import { tapHaptic, comboHaptic, wrongHaptic } from "@/lib/haptics";
import { submitScore, type User } from "@/lib/user";
import { PlayingScreen } from "./MathRush";

type MpView = "entry" | "creating" | "joining" | "in_session";

interface MultiplayerProps {
  user: User | null;
  onExit: () => void;
}

const COMBO_MILESTONES = new Set([5, 10, 15, 20, 30, 50]);

export default function Multiplayer({ user, onExit }: MultiplayerProps) {
  const [view, setView] = useState<MpView>("entry");
  const [handle, setHandle] = useState<SessionHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      handle?.leave().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  const selfId = user?.token ?? null;
  const selfNickname = user?.nickname ?? "Guest";

  async function doCreate(rounds: number) {
    if (!selfId) {
      setError("Please pick a name first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const h = await createSession({
        self: { id: selfId, nickname: selfNickname },
        totalRounds: rounds,
      });
      setHandle(h);
      setView("in_session");
    } catch (e) {
      setError(e instanceof SessionError ? e.message : "Couldn't create session.");
    } finally {
      setBusy(false);
    }
  }

  async function doJoin(rawCode: string) {
    if (!selfId) {
      setError("Please pick a name first.");
      return;
    }
    const code = normalizeCode(rawCode);
    if (code.length < 3) {
      setError("Enter the session code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const h = await joinSession({
        self: { id: selfId, nickname: selfNickname },
        code,
      });
      setHandle(h);
      setView("in_session");
    } catch (e) {
      setError(e instanceof SessionError ? e.message : "Couldn't join session.");
    } finally {
      setBusy(false);
    }
  }

  async function leaveAndExit() {
    if (handle) await handle.leave().catch(() => {});
    setHandle(null);
    onExit();
  }

  if (!user) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar onBack={onExit} label="Party Mode" />
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <div className="font-display text-3xl font-bold">Name needed</div>
            <p className="mt-3 text-sm text-muted">
              Party mode needs a nickname so everyone can tell who's who.
              Tap "Name anlegen" back on the main menu.
            </p>
            <button
              onClick={onExit}
              className="mt-6 touch-manipulation rounded-2xl bg-ink px-6 py-3 text-sm font-bold uppercase tracking-[0.2em] text-paper shadow-hard active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "in_session" && handle) {
    return (
      <SessionRunner
        handle={handle}
        selfId={selfId!}
        user={user}
        onExit={leaveAndExit}
      />
    );
  }

  if (view === "creating") {
    return (
      <CreateView
        onBack={() => {
          setError(null);
          setView("entry");
        }}
        onCreate={doCreate}
        busy={busy}
        error={error}
      />
    );
  }

  if (view === "joining") {
    return (
      <JoinView
        onBack={() => {
          setError(null);
          setView("entry");
        }}
        onJoin={doJoin}
        busy={busy}
        error={error}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar onBack={onExit} label="Party Mode" />
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="font-display text-5xl font-bold leading-[0.95]">
          Fetz <span className="text-accent">together</span>
        </div>
        <p className="mt-4 max-w-xs text-sm text-muted">
          Same problems, same clock, everyone races. Highest sum wins.
        </p>
      </div>
      <div className="flex flex-col gap-3 pt-2">
        <button
          onClick={() => setView("creating")}
          className="touch-manipulation rounded-2xl bg-ink py-5 text-xl font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
        >
          Create session
        </button>
        <button
          onClick={() => setView("joining")}
          className="touch-manipulation rounded-2xl border-2 border-ink/80 bg-paper py-4 text-lg font-bold text-ink shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
        >
          Join with code
        </button>
      </div>
    </div>
  );
}

function TopBar({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="flex items-center justify-between pb-2">
      <button
        onClick={onBack}
        className="touch-manipulation text-xs uppercase tracking-[0.22em] text-muted active:text-ink"
      >
        ← Back
      </button>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </span>
    </div>
  );
}

function CreateView({
  onBack,
  onCreate,
  busy,
  error,
}: {
  onBack: () => void;
  onCreate: (rounds: number) => void;
  busy: boolean;
  error: string | null;
}) {
  const [rounds, setRounds] = useState(5);
  const presets = [3, 5, 7, 10];
  return (
    <div className="flex flex-1 flex-col">
      <TopBar onBack={onBack} label="New session" />
      <div className="flex flex-1 flex-col justify-center">
        <div className="text-center">
          <div className="font-display text-3xl font-bold">How many rounds?</div>
          <p className="mt-2 text-xs uppercase tracking-[0.22em] text-muted">
            You set the pace as session lead
          </p>
        </div>
        <div className="mt-8 grid grid-cols-4 gap-3">
          {presets.map((n) => (
            <button
              key={n}
              onClick={() => setRounds(n)}
              className={
                "touch-manipulation rounded-2xl border-2 py-5 text-2xl font-bold shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm " +
                (rounds === n
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/30 bg-paper text-ink")
              }
            >
              {n}
            </button>
          ))}
        </div>
        {error && (
          <div className="mt-5 text-center text-sm text-bad">{error}</div>
        )}
      </div>
      <button
        onClick={() => onCreate(rounds)}
        disabled={busy}
        className="touch-manipulation rounded-2xl bg-accent py-5 text-xl font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm disabled:opacity-60"
      >
        {busy ? "Starting…" : "Create"}
      </button>
    </div>
  );
}

function JoinView({
  onBack,
  onJoin,
  busy,
  error,
}: {
  onBack: () => void;
  onJoin: (code: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [code, setCode] = useState("");
  return (
    <div className="flex flex-1 flex-col">
      <TopBar onBack={onBack} label="Join session" />
      <div className="flex flex-1 flex-col justify-center">
        <div className="text-center">
          <div className="font-display text-3xl font-bold">Enter code</div>
          <p className="mt-2 text-xs uppercase tracking-[0.22em] text-muted">
            Ask your session lead
          </p>
        </div>
        <input
          value={code}
          autoFocus
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="mt-8 w-full rounded-2xl border-2 border-ink/30 bg-paper py-5 text-center font-mono text-4xl font-bold uppercase tracking-[0.5em] text-ink focus:border-ink focus:outline-none"
          placeholder="––––"
        />
        {error && (
          <div className="mt-5 text-center text-sm text-bad">{error}</div>
        )}
      </div>
      <button
        onClick={() => onJoin(code)}
        disabled={busy}
        className="touch-manipulation rounded-2xl bg-ink py-5 text-xl font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm disabled:opacity-60"
      >
        {busy ? "Joining…" : "Join"}
      </button>
    </div>
  );
}

// -------------- Session runner --------------

function SessionRunner({
  handle,
  selfId,
  user,
  onExit,
}: {
  handle: SessionHandle;
  selfId: string;
  user: User;
  onExit: () => void;
}) {
  const [state, setState] = useState<SessionState>(() => handle.getState());

  useEffect(() => handle.subscribe(setState), [handle]);

  const isLead = state.leadId === selfId;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between pb-2">
        <button
          onClick={onExit}
          className="touch-manipulation text-xs uppercase tracking-[0.22em] text-muted active:text-ink"
        >
          ← Leave
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Code <span className="font-bold text-ink tracking-[0.3em]">{state.code}</span>
        </span>
      </div>

      {state.phase === "lobby" && (
        <Lobby state={state} isLead={isLead} handle={handle} />
      )}

      {(state.phase === "countdown" || state.phase === "playing") && (
        <RoundView state={state} selfId={selfId} user={user} handle={handle} />
      )}

      {state.phase === "between" && (
        <BetweenRounds state={state} isLead={isLead} handle={handle} selfId={selfId} />
      )}

      {state.phase === "finished" && (
        <FinalBoard state={state} selfId={selfId} onExit={onExit} />
      )}
    </div>
  );
}

function Lobby({
  state,
  isLead,
  handle,
}: {
  state: SessionState;
  isLead: boolean;
  handle: SessionHandle;
}) {
  const presets = [3, 5, 7, 10];
  return (
    <div className="flex flex-1 flex-col">
      <div className="pt-4 text-center">
        <div className="text-[11px] uppercase tracking-[0.32em] text-muted">
          Session code — share it
        </div>
        <div className="mt-1 font-mono text-6xl font-bold tracking-[0.3em] text-ink">
          {state.code}
        </div>
      </div>

      <div className="mt-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-muted">
          Players ({state.players.length})
        </div>
        <ul className="mt-2 divide-y divide-ink/10 rounded-2xl border border-ink/15 bg-paper">
          {state.players.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <span className="flex items-center gap-2">
                <span
                  className={
                    "inline-block h-1.5 w-1.5 rounded-full " +
                    (p.isLead ? "bg-accent" : "bg-ink/40")
                  }
                />
                <span className="font-bold text-ink">{p.nickname}</span>
              </span>
              {p.isLead && (
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-accent">
                  Lead
                </span>
              )}
            </li>
          ))}
          {state.players.length === 0 && (
            <li className="px-4 py-3 text-center text-sm text-muted">
              Waiting…
            </li>
          )}
        </ul>
      </div>

      <div className="mt-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-muted">
          Rounds {isLead ? "" : "(set by lead)"}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {presets.map((n) => (
            <button
              key={n}
              disabled={!isLead}
              onClick={() => handle.setTotalRounds(n)}
              className={
                "touch-manipulation rounded-xl border-2 py-3 font-bold shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm disabled:opacity-60 " +
                (state.totalRounds === n
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/30 bg-paper text-ink")
              }
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1" />

      {isLead ? (
        <button
          disabled={state.players.length < 1}
          onClick={() => handle.startRound()}
          className="touch-manipulation rounded-2xl bg-accent py-5 text-xl font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm disabled:opacity-50"
        >
          Start round 1
        </button>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-ink/20 py-5 text-center text-sm uppercase tracking-[0.22em] text-muted">
          Waiting for lead…
        </div>
      )}
    </div>
  );
}

function BetweenRounds({
  state,
  isLead,
  handle,
  selfId,
}: {
  state: SessionState;
  isLead: boolean;
  handle: SessionHandle;
  selfId: string;
}) {
  const lastRound = state.roundResults[state.roundResults.length - 1];
  const sorted = useMemo(() => {
    return [...state.players].sort(
      (a, b) => (state.totals[b.id] ?? 0) - (state.totals[a.id] ?? 0)
    );
  }, [state]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="pt-4 text-center">
        <div className="text-[11px] uppercase tracking-[0.32em] text-muted">
          Round {state.currentRound} done
        </div>
        <div className="mt-1 font-display text-3xl font-bold">
          {state.currentRound} / {state.totalRounds}
        </div>
      </div>

      <ul className="mt-6 divide-y divide-ink/10 rounded-2xl border border-ink/15 bg-paper">
        {sorted.map((p, i) => {
          const roundScore = lastRound?.scores[p.id] ?? 0;
          const total = state.totals[p.id] ?? 0;
          return (
            <li
              key={p.id}
              className={
                "flex items-center justify-between px-4 py-3 " +
                (p.id === selfId ? "bg-accent/10" : "")
              }
            >
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted">#{i + 1}</span>
                <span className="font-bold text-ink">{p.nickname}</span>
              </span>
              <span className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-muted">
                  +{roundScore}
                </span>
                <span className="font-mono text-lg font-bold tabular-nums text-ink">
                  {total}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex-1" />

      {isLead ? (
        <button
          onClick={() => handle.startRound()}
          className="touch-manipulation rounded-2xl bg-accent py-5 text-xl font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
        >
          Start round {state.currentRound + 1}
        </button>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-ink/20 py-5 text-center text-sm uppercase tracking-[0.22em] text-muted">
          Waiting for lead…
        </div>
      )}
    </div>
  );
}

function FinalBoard({
  state,
  selfId,
  onExit,
}: {
  state: SessionState;
  selfId: string;
  onExit: () => void;
}) {
  const sorted = useMemo(() => {
    return [...state.players].sort(
      (a, b) => (state.totals[b.id] ?? 0) - (state.totals[a.id] ?? 0)
    );
  }, [state]);
  const winner = sorted[0];

  return (
    <div className="flex flex-1 flex-col">
      <div className="pt-4 text-center">
        <div className="text-[11px] uppercase tracking-[0.32em] text-muted">
          Session over
        </div>
        {winner && (
          <>
            <div className="mt-2 font-display text-2xl font-bold">
              <span className="text-accent">{winner.nickname}</span> wins
            </div>
            <div className="mt-1 font-mono text-5xl font-bold tabular-nums">
              {state.totals[winner.id] ?? 0}
            </div>
          </>
        )}
      </div>

      <ul className="mt-6 divide-y divide-ink/10 rounded-2xl border border-ink/15 bg-paper">
        {sorted.map((p, i) => {
          const total = state.totals[p.id] ?? 0;
          return (
            <li
              key={p.id}
              className={
                "flex items-center justify-between px-4 py-3 " +
                (p.id === selfId ? "bg-accent/10" : "")
              }
            >
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted">#{i + 1}</span>
                <span className="font-bold text-ink">{p.nickname}</span>
              </span>
              <span className="font-mono text-lg font-bold tabular-nums text-ink">
                {total}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex-1" />

      <button
        onClick={onExit}
        className="touch-manipulation rounded-2xl bg-ink py-5 text-xl font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm"
      >
        Back to menu
      </button>
    </div>
  );
}

// -------------- Round playing (with seeded RNG) --------------

interface RoundProps {
  state: SessionState;
  selfId: string;
  user: User;
  handle: SessionHandle;
}

interface Floater {
  id: number;
  text: string;
  tone: "good" | "bad" | "combo" | "time";
  stackOffset: number;
}

function RoundView({ state, selfId, user, handle }: RoundProps) {
  // Local game state — mirrors solo MathRush but uses session seed and
  // reports back to the session when done.
  const round = state.currentRound;
  const seed = state.seed;
  const startsAt = state.startsAt ?? 0;

  const rngRef = useRef<Rng>(createRng(seed));
  const [phase, setPhase] = useState<"countdown" | "playing" | "done">(
    "countdown"
  );
  const [problem, setProblem] = useState<Problem | null>(null);
  const [choices, setChoices] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [solved, setSolved] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [timeMs, setTimeMs] = useState(GAME.startTimeMs);
  const [shake, setShake] = useState(0);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [countdownTick, setCountdownTick] = useState(0);

  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const startTsRef = useRef<number>(0);
  const liveSendRef = useRef<number>(0);
  const reportedRef = useRef(false);
  const floaterIdRef = useRef(0);

  const level = useMemo(() => levelFromSolved(solved), [solved]);
  const mult = multForCombo(combo);

  // Reset on new round.
  useEffect(() => {
    rngRef.current = createRng(seed);
    setPhase("countdown");
    setScore(0);
    setSolved(0);
    setCombo(0);
    setBestCombo(0);
    setTimeMs(GAME.startTimeMs);
    setFloaters([]);
    reportedRef.current = false;
    liveSendRef.current = 0;
    const p = generate(1, undefined, rngRef.current);
    setProblem(p);
    setChoices(generateChoices(p, rngRef.current));
  }, [round, seed]);

  // Countdown ticker.
  useEffect(() => {
    if (phase !== "countdown") return;
    const id = window.setInterval(() => {
      const remaining = startsAt - Date.now();
      setCountdownTick((t) => t + 1);
      if (remaining <= 0) {
        setPhase("playing");
        unlockAudio();
        startTsRef.current = performance.now();
        lastTickRef.current = performance.now();
        window.clearInterval(id);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, startsAt]);

  const pushFloater = useCallback(
    (text: string, tone: Floater["tone"], stackOffset = 0) => {
      const id = ++floaterIdRef.current;
      setFloaters((arr) => [...arr, { id, text, tone, stackOffset }]);
      window.setTimeout(() => {
        setFloaters((arr) => arr.filter((f) => f.id !== id));
      }, 900);
    },
    []
  );

  const finishRound = useCallback(
    (finalScore: number, finalSolved: number, finalBest: number) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      handle.reportRoundDone({
        score: finalScore,
        solved: finalSolved,
        bestCombo: finalBest,
      });
      // Per-round score also flows into the global leaderboard.
      if (finalScore > 0) {
        void submitScore(user, finalScore, finalSolved, finalBest).catch(
          () => null
        );
      }
      setPhase("done");
    },
    [handle, user]
  );

  // Game loop.
  useEffect(() => {
    if (phase !== "playing") return;
    const loop = (t: number) => {
      const delta = t - lastTickRef.current;
      lastTickRef.current = t;
      setTimeMs((prev) => {
        const next = prev - delta;
        if (next <= 0) {
          rafRef.current = null;
          queueMicrotask(() => {
            setScore((s) => {
              setSolved((sl) => {
                setBestCombo((bc) => {
                  finishRound(s, sl, bc);
                  return bc;
                });
                return sl;
              });
              return s;
            });
          });
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
  }, [phase, finishRound]);

  const submit = useCallback(
    (guess: number) => {
      if (phase !== "playing" || !problem) return;
      tapHaptic();

      const elapsed = performance.now() - startTsRef.current;
      const correct = Math.abs(guess - problem.answer) < 1e-9;

      if (correct) {
        const fast = elapsed <= GAME.fastThresholdMs;
        const earned = pointsFor({ combo: combo + 1, fast, level });
        const timeReward =
          GAME.rewardMsPerHit + (fast ? GAME.fastRewardMsExtra : 0);
        playCorrect(combo + 1);
        const nextScore = score + earned;
        setScore(nextScore);
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

        const prev = problem;
        const p = generate(levelFromSolved(solved + 1), prev, rngRef.current);
        setProblem(p);
        setChoices(generateChoices(p, rngRef.current));
        startTsRef.current = performance.now();

        // Throttled live broadcast.
        const now = performance.now();
        if (now - liveSendRef.current > 500) {
          liveSendRef.current = now;
          handle.reportLiveScore(nextScore);
        }
      } else {
        playWrong();
        wrongHaptic();
        setCombo(0);
        setTimeMs((t) => Math.max(0, t - GAME.penaltyMs));
        setShake((n) => n + 1);
        pushFloater(`−${(GAME.penaltyMs / 1000).toFixed(0)}s`, "bad", 0);
      }
    },
    [phase, problem, combo, level, score, solved, handle, pushFloater]
  );

  // Keyboard support.
  useEffect(() => {
    const KEYS = ["A", "S", "D", "F"];
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "playing") return;
      const idx = KEYS.indexOf(e.key.toUpperCase());
      if (idx >= 0 && idx < choices.length) {
        e.preventDefault();
        submit(choices[idx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, choices, submit]);

  // Countdown screen.
  if (phase === "countdown") {
    const remaining = Math.max(0, startsAt - Date.now());
    const num = Math.ceil(remaining / 1000);
    void countdownTick; // bind to state so React re-renders on tick
    return (
      <div className="flex flex-1 flex-col">
        <div className="pt-4 text-center">
          <div className="text-[11px] uppercase tracking-[0.32em] text-muted">
            Round {state.currentRound} / {state.totalRounds}
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={num}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="font-display text-[10rem] font-bold leading-none text-accent"
            >
              {num > 0 ? num : "Go!"}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-[0.32em] text-muted">
            Waiting for others…
          </div>
          <div className="mt-2 font-mono text-5xl font-bold tabular-nums">
            {score}
          </div>
        </div>
      </div>
    );
  }

  // Playing — reuse solo PlayingScreen with a live opponent strip on top.
  const timePct = Math.max(0, Math.min(1, timeMs / GAME.maxTimeMs));
  const timeLow = timeMs < 5_000;

  return (
    <>
      <OpponentStrip state={state} selfId={selfId} myScore={score} />
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
        onQuit={() =>
          finishRound(
            score,
            solved,
            Math.max(bestCombo, combo)
          )
        }
      />
    </>
  );
}

function OpponentStrip({
  state,
  selfId,
  myScore,
}: {
  state: SessionState;
  selfId: string;
  myScore: number;
}) {
  // Show top opponents' live scores. Self is shown via the main HUD.
  const others = state.players.filter((p) => p.id !== selfId);
  if (others.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pb-1 pt-1">
      {others.map((p) => {
        const s = state.liveScores[p.id] ?? 0;
        const ahead = s > myScore;
        return (
          <span
            key={p.id}
            className={
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] tabular-nums " +
              (ahead
                ? "border-bad/50 bg-bad/10 text-bad"
                : "border-ink/15 bg-paper text-ink/70")
            }
          >
            <span className="font-bold">{p.nickname}</span>
            <span>{s}</span>
          </span>
        );
      })}
    </div>
  );
}
