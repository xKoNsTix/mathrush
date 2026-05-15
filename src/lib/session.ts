// Multiplayer "fetz session": ephemeral, channel-based.
//
// One lead, N players. Lead picks the number of rounds. Each round is a
// full MathRush game where every player gets the SAME problems (driven by
// a seed broadcast at round start). Highest summed score wins.
//
// Transport: Supabase Realtime broadcast + presence. No DB rows — when
// everyone leaves, the channel evaporates. Falls back to a clear error if
// Supabase isn't configured (multiplayer requires connectivity).

import type {
  RealtimeChannel,
  RealtimePresenceState,
} from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type SessionPhase =
  | "lobby"
  | "countdown"
  | "playing"
  | "between"
  | "finished";

export interface Player {
  id: string; // device token
  nickname: string;
  isLead: boolean;
}

export interface RoundResult {
  round: number;
  scores: Record<string, number>; // player id → score this round
}

export interface SessionState {
  code: string;
  phase: SessionPhase;
  totalRounds: number;
  currentRound: number; // 1-based once playing; 0 in lobby
  startsAt: number | null; // ms epoch, set during countdown / playing
  seed: number; // for current round
  players: Player[]; // sorted, lead first
  liveScores: Record<string, number>; // playerId → current round live score
  roundResults: RoundResult[];
  totals: Record<string, number>; // playerId → cumulative score
  leadId: string;
}

type Listener = (state: SessionState) => void;

const CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY34679"; // no ambiguous chars

function makeCode(len = 4): string {
  let out = "";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  }
  return out;
}

function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function channelName(code: string): string {
  return `mathrush-session-${code}`;
}

interface InitOptions {
  code: string;
  asLead: boolean;
  totalRounds?: number; // only when creating
  self: { id: string; nickname: string };
}

export interface SessionHandle {
  getState(): SessionState;
  subscribe(fn: Listener): () => void;
  setTotalRounds(n: number): void; // lead only
  startRound(): void; // lead only
  reportLiveScore(score: number): void;
  reportRoundDone(payload: { score: number; solved: number; bestCombo: number }): void;
  leave(): Promise<void>;
}

export class SessionError extends Error {
  constructor(public reason: "no_backend" | "join_timeout" | "session_not_found" | "unknown", msg?: string) {
    super(msg ?? reason);
  }
}

async function init({ code, asLead, totalRounds, self }: InitOptions): Promise<SessionHandle> {
  const client = supabase();
  if (!client) throw new SessionError("no_backend", "Multiplayer needs Supabase configured.");

  const state: SessionState = {
    code,
    phase: "lobby",
    totalRounds: totalRounds ?? 5,
    currentRound: 0,
    startsAt: null,
    seed: 0,
    players: [],
    liveScores: {},
    roundResults: [],
    totals: {},
    leadId: asLead ? self.id : "",
  };

  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l({ ...state, players: [...state.players] }));

  const channel: RealtimeChannel = client.channel(channelName(code), {
    config: {
      broadcast: { self: false, ack: false },
      presence: { key: self.id },
    },
  });

  function rebuildPlayersFromPresence(p: RealtimePresenceState) {
    const flat: Player[] = [];
    for (const key of Object.keys(p)) {
      const metas = p[key] as Array<{ nickname?: string; isLead?: boolean }>;
      if (!metas?.length) continue;
      const meta = metas[0];
      flat.push({
        id: key,
        nickname: meta.nickname ?? "Player",
        isLead: !!meta.isLead,
      });
    }
    // Lead first, then alphabetical
    flat.sort((a, b) => {
      if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;
      return a.nickname.localeCompare(b.nickname);
    });
    state.players = flat;
    const leadFromPresence = flat.find((x) => x.isLead);
    if (leadFromPresence) state.leadId = leadFromPresence.id;
  }

  channel.on("presence", { event: "sync" }, () => {
    rebuildPlayersFromPresence(channel.presenceState());
    emit();
  });

  channel.on("broadcast", { event: "config" }, ({ payload }) => {
    if (typeof payload?.totalRounds === "number") {
      state.totalRounds = payload.totalRounds;
      emit();
    }
  });

  channel.on("broadcast", { event: "start_round" }, ({ payload }) => {
    const round = payload?.round as number;
    const seed = payload?.seed as number;
    const startsAt = payload?.startsAt as number;
    if (typeof round !== "number" || typeof seed !== "number") return;
    state.currentRound = round;
    state.seed = seed;
    state.startsAt = startsAt;
    state.phase = "countdown";
    state.liveScores = {};
    emit();
  });

  channel.on("broadcast", { event: "live_score" }, ({ payload }) => {
    const id = payload?.id as string;
    const score = payload?.score as number;
    if (!id || typeof score !== "number") return;
    state.liveScores = { ...state.liveScores, [id]: score };
    emit();
  });

  channel.on("broadcast", { event: "round_done" }, ({ payload }) => {
    const id = payload?.id as string;
    const round = payload?.round as number;
    const score = payload?.score as number;
    if (!id || typeof round !== "number" || typeof score !== "number") return;

    let entry = state.roundResults.find((r) => r.round === round);
    if (!entry) {
      entry = { round, scores: {} };
      state.roundResults.push(entry);
      state.roundResults.sort((a, b) => a.round - b.round);
    }
    entry.scores[id] = score;
    state.totals = { ...state.totals, [id]: (state.totals[id] ?? 0) + score };

    // If every active player reported, advance to between/finished.
    const activeIds = state.players.map((p) => p.id);
    const allDone = activeIds.every((pid) => entry!.scores[pid] !== undefined);
    if (allDone) {
      state.phase = round >= state.totalRounds ? "finished" : "between";
    }
    emit();
  });

  channel.on("broadcast", { event: "end_session" }, () => {
    state.phase = "finished";
    emit();
  });

  await new Promise<void>((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new SessionError("join_timeout", "Couldn't reach session."));
      }
    }, 8000);

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ nickname: self.nickname, isLead: asLead });
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve();
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(new SessionError("unknown", `channel ${status}`));
        }
      }
    });
  });

  // After subscription, the lead pushes initial config so joiners
  // arriving later catch the round count.
  if (asLead) {
    channel.send({
      type: "broadcast",
      event: "config",
      payload: { totalRounds: state.totalRounds },
    });
  }

  const handle: SessionHandle = {
    getState: () => ({ ...state, players: [...state.players] }),
    subscribe(fn) {
      listeners.add(fn);
      fn(handle.getState());
      return () => listeners.delete(fn);
    },
    setTotalRounds(n: number) {
      if (state.leadId !== self.id) return;
      state.totalRounds = Math.max(1, Math.min(20, Math.floor(n)));
      channel.send({
        type: "broadcast",
        event: "config",
        payload: { totalRounds: state.totalRounds },
      });
      emit();
    },
    startRound() {
      if (state.leadId !== self.id) return;
      if (state.phase !== "lobby" && state.phase !== "between") return;
      const round = state.currentRound + 1;
      if (round > state.totalRounds) return;
      const seed = (crypto.getRandomValues(new Uint32Array(1))[0] ^ Date.now()) >>> 0;
      const startsAt = Date.now() + 3500; // 3.5s countdown
      channel.send({
        type: "broadcast",
        event: "start_round",
        payload: { round, seed, startsAt },
      });
      // Apply locally too (broadcast self:false).
      state.currentRound = round;
      state.seed = seed;
      state.startsAt = startsAt;
      state.phase = "countdown";
      state.liveScores = {};
      emit();
    },
    reportLiveScore(score: number) {
      channel.send({
        type: "broadcast",
        event: "live_score",
        payload: { id: self.id, score },
      });
      state.liveScores = { ...state.liveScores, [self.id]: score };
      emit();
    },
    reportRoundDone({ score, solved, bestCombo }) {
      const round = state.currentRound;
      channel.send({
        type: "broadcast",
        event: "round_done",
        payload: { id: self.id, round, score, solved, bestCombo },
      });
      // Apply locally.
      let entry = state.roundResults.find((r) => r.round === round);
      if (!entry) {
        entry = { round, scores: {} };
        state.roundResults.push(entry);
        state.roundResults.sort((a, b) => a.round - b.round);
      }
      if (entry.scores[self.id] === undefined) {
        entry.scores[self.id] = score;
        state.totals = { ...state.totals, [self.id]: (state.totals[self.id] ?? 0) + score };
      }
      const activeIds = state.players.map((p) => p.id);
      const allDone = activeIds.every((pid) => entry!.scores[pid] !== undefined);
      if (allDone) {
        state.phase = round >= state.totalRounds ? "finished" : "between";
      }
      emit();
    },
    async leave() {
      try {
        await channel.untrack();
      } catch {
        /* noop */
      }
      try {
        await client.removeChannel(channel);
      } catch {
        /* noop */
      }
      listeners.clear();
    },
  };

  return handle;
}

export async function createSession(opts: {
  self: { id: string; nickname: string };
  totalRounds: number;
}): Promise<SessionHandle> {
  const code = makeCode(4);
  return init({ code, asLead: true, totalRounds: opts.totalRounds, self: opts.self });
}

export async function joinSession(opts: {
  self: { id: string; nickname: string };
  code: string;
}): Promise<SessionHandle> {
  const code = normalizeCode(opts.code);
  if (code.length < 3) throw new SessionError("session_not_found", "Code too short.");
  return init({ code, asLead: false, self: opts.self });
}

export { normalizeCode };
