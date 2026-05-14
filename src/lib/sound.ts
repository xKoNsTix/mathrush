// Mini-Sound-Engine via Web Audio API — keine externen Assets, alles
// per Oszillator synthetisiert. Master-Gain bewusst niedrig (~0.08)
// und kurze Hüllkurven, damit's nicht aufdringlich wird.
//
// AudioContext muss nach User-Gesture erstellt/resumed werden — wir
// bauen ihn lazy beim ersten Aufruf, und `resume()` wird best-effort
// versucht. Wenn der Browser das blockiert, schluckt die Funktion
// stillschweigend (kein Game-Break).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** iOS Safari hat einen AudioContext nur dann „echt laufend", wenn der
 *  erste resume()/Spielton aus einem User-Gesture-Handler kommt. Call
 *  diesen Hook im onClick des Start-Buttons — spielt einen unhörbaren
 *  Ton, der die Audio-Pipeline freischaltet für den Rest der Session. */
export function unlockAudio(): void {
  const env = getCtx();
  if (!env) return;
  try {
    const t0 = env.ctx.currentTime;
    const osc = env.ctx.createOscillator();
    const g = env.ctx.createGain();
    g.gain.value = 0.0001;
    osc.connect(g).connect(env.master);
    osc.start(t0);
    osc.stop(t0 + 0.02);
  } catch {
    /* noop */
  }
}

function getCtx(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  return master ? { ctx, master } : null;
}

interface ToneOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  /** Wenn gesetzt, glidet die Frequenz auf diesen Wert (Pitch-Bend). */
  toFreq?: number;
}

function tone({ freq, dur, type = "sine", gain = 0.45, delay = 0, toFreq }: ToneOpts): void {
  const env = getCtx();
  if (!env) return;
  const t0 = env.ctx.currentTime + delay;
  const osc = env.ctx.createOscillator();
  const g = env.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (toFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), t0 + dur);
  }
  // Snappy Attack + smoother Release, keine Klicks dank ramp ab 0.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(env.master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Korrekte Antwort — Chord eskaliert mit Combo:
 *   combo 1   → Grundton
 *   combo 3+  → + große Terz
 *   combo 6+  → + reine Quinte
 *   combo 12+ → + Oktave drüber (Triangle für Glanz)
 *  Grundton transponiert mit Combo nach oben (max 1 Oktave). */
export function playCorrect(combo: number): void {
  const semitone = Math.min(12, Math.floor(combo / 4));
  const base = 523.25 * Math.pow(2, semitone / 12); // C5 = 523.25 Hz
  const major3 = base * Math.pow(2, 4 / 12);
  const fifth  = base * Math.pow(2, 7 / 12);
  const octave = base * 2;

  tone({ freq: base, dur: 0.22, type: "sine", gain: 0.5 });
  if (combo >= 3)  tone({ freq: major3, dur: 0.22, type: "sine", gain: 0.35, delay: 0.015 });
  if (combo >= 6)  tone({ freq: fifth,  dur: 0.24, type: "sine", gain: 0.3,  delay: 0.03 });
  if (combo >= 12) tone({ freq: octave, dur: 0.28, type: "triangle", gain: 0.2, delay: 0.045 });
}

/** Falsche Antwort — sanfter Abfall-Ton, kein harsches Buzzern. */
export function playWrong(): void {
  tone({ freq: 280, toFreq: 130, dur: 0.32, type: "sine", gain: 0.35 });
}

/** Combo-Meilenstein-Fanfare (5er, 10er, 20er …). Aufsteigendes
 *  Arpeggio C-E-G-C plus ein heller Sparkle-Ton oben drauf. Basis-Höhe
 *  klettert mit dem Combo-Level mit, damit jeder neue Meilenstein
 *  klanglich „höher" sitzt als der davor. */
export function playComboMilestone(combo: number): void {
  const semitone = Math.min(12, Math.floor(combo / 6));
  const base = 523.25 * Math.pow(2, semitone / 12);
  const intervals = [0, 4, 7, 12]; // Dur-Dreiklang + Oktave
  intervals.forEach((semi, i) => {
    const freq = base * Math.pow(2, semi / 12);
    tone({ freq, dur: 0.14, type: "triangle", gain: 0.4, delay: i * 0.055 });
  });
  // Sparkle: zwei Oktaven + Quint über Basis, leise drüberglitzern
  tone({
    freq: base * Math.pow(2, 19 / 12),
    dur: 0.32,
    type: "sine",
    gain: 0.22,
    delay: intervals.length * 0.055 + 0.03,
  });
}
