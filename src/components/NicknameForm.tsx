"use client";

import { useState } from "react";
import { createUser, type User } from "@/lib/user";

interface Props {
  onCreated: (u: User) => void;
  onSkip?: () => void;
}

export function NicknameForm({ onCreated, onSkip }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (busy) return;
    setBusy(true);
    try {
      const u = await createUser(name.trim());
      onCreated(u);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "nickname_taken") setErr("Der Name ist schon vergeben.");
      else if (msg === "invalid_nickname") setErr("2–20 Zeichen, ohne Sonderzeichen.");
      else setErr("Hat nicht funktioniert. Nochmal probieren.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col items-center gap-3">
      <label className="text-xs uppercase tracking-[0.22em] text-muted">Dein Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={20}
        placeholder="z.B. Denis"
        // text-2xl = 24px → iOS zoomt nicht beim Fokus (Trigger ist <16px).
        className="w-full touch-manipulation rounded-2xl border-2 border-ink/80 bg-paper px-5 py-3 text-center font-mono text-2xl font-bold tabular-nums shadow-hard outline-none placeholder:text-ink/25 focus:border-accent"
        aria-label="Nickname"
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="submit"
          disabled={busy || name.trim().length < 2}
          className="touch-manipulation rounded-2xl bg-ink px-5 py-3 text-sm font-bold text-paper shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hardsm disabled:opacity-40"
        >
          {busy ? "…" : "Speichern"}
        </button>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="touch-manipulation rounded-2xl border-2 border-ink/30 bg-paper px-4 py-3 text-sm font-bold text-ink/70 hover:border-ink/60 hover:text-ink"
          >
            Anonym spielen
          </button>
        )}
      </div>
      {err && <p className="font-mono text-xs text-bad">{err}</p>}
      <p className="text-center text-[11px] text-muted">
        Kein Passwort — wir merken uns dich auf diesem Gerät.
      </p>
    </form>
  );
}
