export type Op = "+" | "−" | "×" | "÷";

export interface Problem {
  a: number;
  b: number;
  op: Op;
  answer: number;
  text: string;
}

export type Rng = () => number;

// mulberry32 — tiny, seedable, good enough for game-side determinism.
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(str: string): number {
  // xfnv1a — deterministic 32-bit hash for arbitrary strings.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function rand(r: Rng, min: number, max: number): number {
  return Math.floor(r() * (max - min + 1)) + min;
}

// Difficulty tiers driven by player level (1..N).
// Each tier defines allowed ops and ranges.
interface Tier {
  ops: Op[];
  range: (r: Rng) => { a: number; b: number; op: Op };
}

function addSub(r: Rng, maxA: number, maxB: number): { a: number; b: number; op: Op } {
  const op: Op = r() < 0.5 ? "+" : "−";
  const a = rand(r, 2, maxA);
  const b = rand(r, 2, Math.min(maxB, a)); // keep − non-negative
  return { a, b, op };
}

function mul(r: Rng, maxA: number, maxB: number): { a: number; b: number; op: Op } {
  return { a: rand(r, 2, maxA), b: rand(r, 2, maxB), op: "×" };
}

function div(r: Rng, maxAns: number, maxB: number): { a: number; b: number; op: Op } {
  const b = rand(r, 2, maxB);
  const ans = rand(r, 2, maxAns);
  return { a: b * ans, b, op: "÷" };
}

const tiers: Tier[] = [
  { ops: ["+", "−"], range: (r) => addSub(r, 20, 12) },
  { ops: ["+", "−"], range: (r) => addSub(r, 40, 25) },
  {
    ops: ["+", "−", "×"],
    range: (r) => (r() < 0.65 ? addSub(r, 60, 40) : mul(r, 10, 10)),
  },
  {
    ops: ["+", "−", "×", "÷"],
    range: (r) => {
      const x = r();
      if (x < 0.45) return addSub(r, 80, 60);
      if (x < 0.8) return mul(r, 12, 10);
      return div(r, 10, 9);
    },
  },
  {
    ops: ["+", "−", "×", "÷"],
    range: (r) => {
      const x = r();
      if (x < 0.4) return addSub(r, 120, 80);
      if (x < 0.75) return mul(r, 15, 12);
      return div(r, 12, 11);
    },
  },
  {
    ops: ["+", "−", "×", "÷"],
    range: (r) => {
      const x = r();
      if (x < 0.35) return addSub(r, 200, 140);
      if (x < 0.75) return mul(r, 19, 14);
      return div(r, 15, 13);
    },
  },
  {
    ops: ["+", "−", "×", "÷"],
    range: (r) => {
      const x = r();
      if (x < 0.3) return addSub(r, 350, 250);
      if (x < 0.7) return mul(r, 25, 18);
      return div(r, 20, 17);
    },
  },
];

export function levelFromSolved(solved: number): number {
  return Math.min(tiers.length, Math.floor(solved / 8) + 1);
}

export function generate(level: number, last?: Problem, rng?: Rng): Problem {
  const r: Rng = rng ?? Math.random;
  const tier = tiers[Math.min(tiers.length, Math.max(1, level)) - 1];
  for (let i = 0; i < 6; i++) {
    const { a, b, op } = tier.range(r);
    const answer = compute(a, b, op);
    const text = `${a} ${op} ${b}`;
    if (!last || last.text !== text) {
      return { a, b, op, answer, text };
    }
  }
  const { a, b, op } = tier.range(r);
  return { a, b, op, answer: compute(a, b, op), text: `${a} ${op} ${b}` };
}

function compute(a: number, b: number, op: Op): number {
  switch (op) {
    case "+": return a + b;
    case "−": return a - b;
    case "×": return a * b;
    case "÷": return a / b;
  }
}

export function generateChoices(problem: Problem, rng?: Rng): number[] {
  const r: Rng = rng ?? Math.random;
  const { a, b, op, answer } = problem;
  const candidates: number[] = [];

  switch (op) {
    case "+":
      candidates.push(a - b, b - a, answer + 1, answer - 1, answer + 10, answer - 10, a * b);
      break;
    case "−":
      candidates.push(a + b, b - a, answer + 1, answer - 1, answer + 10, answer - 10);
      break;
    case "×":
      candidates.push(a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b, a + b, answer + 1, answer - 1);
      break;
    case "÷":
      candidates.push(answer + 1, answer - 1, answer * 2, Math.floor(answer / 2), a - b, a + b);
      break;
  }

  const set = new Set<number>([answer]);
  for (const c of candidates) {
    if (set.size >= 4) break;
    if (c < 0) continue;
    if (c === answer) continue;
    set.add(c);
  }
  let bump = 2;
  while (set.size < 4 && bump < 50) {
    const c = answer + (r() < 0.5 ? -bump : bump);
    if (c >= 0 && !set.has(c)) set.add(c);
    bump++;
  }

  const arr = [...set];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
